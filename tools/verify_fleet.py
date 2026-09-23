#!/usr/bin/env python3
"""Automated fleet health check -- replaces manually clicking through each
repo's CI page and each company's listing on peviitor.ro by hand.

For every ACTIVE repo in fleet.json, checks:
  1. Latest GitHub Actions run on main: status + conclusion + how long ago.
  2. Whether the company is present in peviitor.ro's public API by CIF, and
     how long ago it was last scraped (`lastScraped`).

Note: peviitor.ro's public /v1/jobs/ search endpoint does not filter by
company/cif query params (confirmed empirically -- it always returns the
whole index), so this does NOT try to count live job listings.
`lastScraped`/`scraperFile` from the /v1/firme/company/ endpoint are shown
for information only, NOT used as a pass/fail signal: that field can be
last written by an unrelated third-party aggregator scraper for the same
company (confirmed empirically on Valrom), so it isn't a reliable per-repo
freshness signal. The real pass/fail check is each repo's latest CI run.

Requires `gh` CLI authenticated (gh auth status) and outbound HTTPS.

Usage:
    python tools/verify_fleet.py
    python tools/verify_fleet.py --only betfair-scraper-py,cemacon-sa-nodejs-scraper
    python tools/verify_fleet.py --json report.json
"""
from __future__ import annotations

import argparse
import datetime
import json
import pathlib
import subprocess
import sys
import urllib.error
import urllib.request

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parents[1]
FLEET_JSON = ROOT / "fleet.json"
PEVIITOR_API = "https://api.peviitor.ro/v1/firme/company/?cif={cif}"


SCRAPE_WORKFLOW_HINTS = ("scrape", "spider")


def gh_json(args: list[str]) -> object | None:
    result = subprocess.run(["gh", *args], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return None


def latest_scrape_run(owner: str, repo: str) -> dict | None:
    runs = gh_json([
        "run", "list", "--repo", f"{owner}/{repo}", "--branch", "main",
        "--limit", "20", "--json", "workflowName,status,conclusion,createdAt,url",
    ])
    if not runs:
        return None
    scrape_runs = [r for r in runs if any(h in r["workflowName"].lower() for h in SCRAPE_WORKFLOW_HINTS)]
    return (scrape_runs or runs)[0]


def fetch_company(cif: str) -> dict | None:
    # api.peviitor.ro 403s the default Python urllib User-Agent (WAF/CDN
    # rule) -- a normal browser-ish UA is enough to get through.
    url = PEVIITOR_API.format(cif=cif)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; Brewtality-3-16-fleet-check/1.0)"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None
    data = payload.get("data") or []
    return data[0] if data else None


def days_ago(iso_date: str) -> int | None:
    try:
        dt = datetime.datetime.fromisoformat(iso_date.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    now = datetime.datetime.now(datetime.timezone.utc)
    return (now - dt).days


def check_scraper(scraper: dict) -> dict:
    owner, repo, cif = scraper["owner"], scraper["repo"], scraper.get("cif")
    result: dict = {"repo": repo, "company": scraper["company"], "problems": []}

    run = latest_scrape_run(owner, repo)
    if run is None:
        result["ci"] = "unknown (gh api call failed)"
        result["problems"].append("could not read CI runs")
    else:
        conclusion = run["conclusion"] or run["status"]
        age = days_ago(run["createdAt"])
        result["ci"] = f"{run['workflowName']}: {conclusion} ({age}d ago)" if age is not None else conclusion
        if conclusion not in ("success", "in_progress", "queued"):
            result["problems"].append(f"latest '{run['workflowName']}' run is {conclusion}")

    if cif:
        company = fetch_company(cif)
        if company is None:
            result["listing"] = "NOT FOUND on peviitor.ro"
            result["problems"].append("company missing from peviitor.ro API")
        else:
            # NOTE: lastScraped/scraperFile on this record are NOT reliably
            # attributable to *this* repo -- a company can also be tracked
            # by an unrelated third-party aggregator scraper (confirmed:
            # Valrom's record showed scraperFile="inviitor-ro-nodejs-scraper",
            # not our repo, right after our own scraper had just upserted its
            # jobs successfully). Treat this as informational only, never as
            # a pass/fail signal -- CI status above is the real health check.
            last_scraped = company.get("lastScraped")
            scraper_file = company.get("scraperFile")
            age = days_ago(last_scraped) if last_scraped else None
            bits = [f"lastScraped={last_scraped}" + (f" ({age}d ago)" if age is not None else "")]
            if scraper_file and repo not in scraper_file:
                bits.append(f"NOTE: field last written by '{scraper_file}', not this repo -- not a reliable freshness signal for us")
            result["listing"] = "listed, " + "; ".join(bits)
    else:
        result["listing"] = "n/a (no CIF on record)"

    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", help="comma-separated repo names to limit to")
    parser.add_argument("--json", type=pathlib.Path, help="also write the full report to this JSON file")
    args = parser.parse_args()

    fleet = json.loads(FLEET_JSON.read_text(encoding="utf-8"))
    active = [s for s in fleet["scrapers"] if s["status"] == "active"]
    if args.only:
        only = set(args.only.split(","))
        active = [s for s in active if s["repo"] in only]

    print(f"Checking {len(active)} active repo(s)...\n")
    results = []
    any_problems = False
    for scraper in active:
        r = check_scraper(scraper)
        results.append(r)
        flag = "[!] " if r["problems"] else "[OK] "
        if r["problems"]:
            any_problems = True
        print(f"{flag}{r['repo']}")
        print(f"    CI:      {r['ci']}")
        print(f"    Listing: {r['listing']}")
        for p in r["problems"]:
            print(f"    !! {p}")
        print()

    if args.json:
        args.json.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"Full report written to {args.json}")

    if any_problems:
        print("Some repos need attention (see !! lines above).")
        sys.exit(1)
    print("All checked repos are healthy.")


if __name__ == "__main__":
    main()
