"""Orchestration: fetch -> parse (self-healing) -> validate -> canary -> upsert -> diff.

Deliberately small; the interesting logic lives in the modules it calls.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from urllib.parse import urlparse

from . import api, fetch
from .config import COMPANY_CIF, OWN_URL_PREFIX, company, scraper
from .parse import parse_deadline, parse_listing, slugify
from .validate import assert_scrape_yielded_jobs, filter_valid_jobs

log = logging.getLogger("scraper.main")

_LOC_RX = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>")

# The path segment that marks an individual job permalink, derived from
# ``ownJobUrlPrefix`` (e.g. "https://site.com/jobs/" -> "/jobs/").
try:
    _JOB_PATH = urlparse(OWN_URL_PREFIX).path.rstrip("/") + "/"
except Exception:  # noqa: BLE001
    _JOB_PATH = "/"
_JOB_PERMALINK_RX = re.compile(re.escape(_JOB_PATH) + r"[^/]+/?$")

try:
    _CAREERS_SOURCE = urlparse(scraper["sources"]["listing"]).netloc or "careers-site"
except Exception:  # noqa: BLE001
    _CAREERS_SOURCE = "careers-site"


def _is_own(url: str) -> bool:
    return isinstance(url, str) and url.startswith(OWN_URL_PREFIX)


def fetch_sitemap_job_urls() -> list[dict]:
    sitemap_url = scraper["sources"]["sitemap"]
    if not sitemap_url or sitemap_url.startswith("{{"):  # not configured
        return []
    try:
        resp = fetch.get(sitemap_url, label="sitemap")
        if not resp.ok:
            log.info("sitemap returned %d", resp.status_code)
            return []
        entries = []
        for m in _LOC_RX.finditer(resp.text):
            url = m.group(1).strip()
            if not _JOB_PERMALINK_RX.search(url):
                continue
            entries.append({"url": url, "slug": url.rstrip("/").split("/")[-1]})
        log.info("sitemap: %d job permalinks", len(entries))
        return entries
    except Exception as exc:  # noqa: BLE001
        log.info("sitemap error: %s", exc)
        return []


def _match_sitemap_url(title: str, entries: list[dict]) -> str | None:
    slug = slugify(title)
    for e in entries:
        if e["slug"] == slug:
            return e["url"]
    for e in entries:
        a, b = e["slug"], slug
        if a.startswith(b) and a[len(b):len(b) + 1] == "-":
            return e["url"]
        if b.startswith(a) and b[len(a):len(a) + 1] == "-":
            return e["url"]
    return None


def scrape_careers() -> list[dict]:
    log.info("scraping %s ...", scraper["sources"]["listing"])
    entries = fetch_sitemap_job_urls()

    try:
        resp = fetch.get(scraper["sources"]["listing"], label="listing")
        resp.raise_for_status()
        items = parse_listing(resp.text)
    except Exception as exc:  # noqa: BLE001
        log.info("listing error: %s", exc)
        items = []

    jobs: list[dict] = []
    if items:
        archive = scraper["sources"]["jobArchive"]
        for item in items:
            url = _match_sitemap_url(item["title"], entries) or f"{archive}{slugify(item['title'])}/"
            jobs.append({
                "url": url,
                "title": item["title"],
                "location": scraper["defaultLocation"],
                "workmode": scraper["defaultWorkmode"],
                "expirationdate": item.get("expirationdate"),
                "source": _CAREERS_SOURCE,
            })
    elif entries:
        log.info("listing unreachable -- sitemap-only fallback (titles from slugs)")
        for e in entries:
            jobs.append({
                "url": e["url"],
                "title": e["slug"].replace("-", " ").title(),
                "location": scraper["defaultLocation"],
                "workmode": scraper["defaultWorkmode"],
                "source": _CAREERS_SOURCE,
            })

    log.info("found %d jobs on %s", len(jobs), _CAREERS_SOURCE)
    return jobs


def _to_job_model(raw: dict, cif: str, company_name: str) -> dict:
    job = {
        "url": raw["url"],
        "title": raw["title"],
        "company": company_name,
        "cif": cif,
        "location": raw.get("location") or None,
        "workmode": raw.get("workmode") or None,
        "expirationdate": raw.get("expirationdate") or None,
        "date": datetime.now(timezone.utc).isoformat(),
        "status": "scraped",
    }
    return {k: v for k, v in job.items() if v is not None}


def run(*, dry_run: bool = False) -> int:
    log.info("=== Step 1: existing jobs in SOLR ===")
    existing = api.query_solr(COMPANY_CIF)
    all_existing = {d["url"] for d in existing["docs"]}
    own_existing = {d["url"] for d in existing["docs"] if _is_own(d["url"])}
    log.info("SOLR has %d jobs for this CIF (%d ours)", existing["numFound"], len(own_existing))

    log.info("=== Step 2: scrape ===")
    raw_jobs = scrape_careers()

    assert_scrape_yielded_jobs(raw_jobs)  # canary
    valid_jobs, _ = filter_valid_jobs(raw_jobs)
    assert_scrape_yielded_jobs(valid_jobs)  # everything failed validation -> also a canary

    company_name = company["company"]
    jobs = [_to_job_model(j, COMPANY_CIF, company_name) for j in valid_jobs]

    log.info("=== Step 3: upsert ===")
    if dry_run:
        log.info("dry-run — would upsert %d jobs", len(jobs))
    else:
        api.upsert_jobs(jobs)

    scraped_urls = {j["url"] for j in jobs}
    added = sorted(scraped_urls - all_existing)
    updated = sorted(scraped_urls & all_existing)
    gone = sorted(own_existing - scraped_urls)

    log.info("=== SUMMARY ===")
    log.info("scraped this run:            %d", len(jobs))
    log.info("  new (not in SOLR before): %d", len(added))
    log.info("  updated (already in SOLR): %d", len(updated))
    log.info("  gone from site (ours):     %d%s", len(gone),
             " — kept (staleJobDeletion=false)" if gone and not scraper["staleJobDeletion"] else "")
    for u in gone[:10]:
        log.info("    - %s", u)
    return len(jobs)


if __name__ == "__main__":
    import argparse

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="run the whole flow without writing to the API")
    ns = ap.parse_args()
    run(dry_run=ns.dry_run)
