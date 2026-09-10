"""peviitor API client — all Solr access goes through api.peviitor.ro.

Mirrors the JS template's ``scraper/api.js``. Every call uses ``fetch.request``
so transient API failures retry with backoff.
"""

from __future__ import annotations

import json
import logging

from . import fetch

log = logging.getLogger("scraper.api")

API_BASE = "https://api.peviitor.ro/v1"


def pad_cif(cif: str | int) -> str:
    """Zero-pad a CIF to exactly 8 digits (peviitor API requirement)."""
    return str(cif).zfill(8)


def query_solr(cif: str | int) -> dict:
    """Return ``{"numFound": int, "docs": [...]}`` for a company CIF."""
    url = f"{API_BASE}/scraper/jobs/?cif={pad_cif(cif)}&rows=500"
    resp = fetch.get(url, label="jobs query")
    if not resp.ok:
        raise RuntimeError(f"API jobs query error: {resp.status_code} - {resp.text}")
    data = resp.json()
    return {"numFound": data.get("total", 0), "docs": data.get("data", [])}


def upsert_jobs(jobs: list[dict]) -> None:
    payload = [{**job, "cif": pad_cif(job["cif"])} for job in jobs]
    resp = fetch.post(
        f"{API_BASE}/scraper/jobs/upload/",
        label="jobs upload",
        headers={"Content-Type": "application/json"},
        data=json.dumps(payload),
    )
    if not resp.ok:
        raise RuntimeError(f"API jobs upload error: {resp.status_code} - {resp.text}")
    count = resp.json().get("count", len(jobs))
    log.info("upserted %d jobs via API", count)


def delete_job_by_url(url: str) -> None:
    resp = fetch.request(
        "DELETE",
        f"{API_BASE}/scraper/jobs/delete/",
        label="job delete",
        headers={"Content-Type": "application/json"},
        data=json.dumps({"url": url}),
    )
    if resp.status_code == 404:
        return
    if not resp.ok:
        raise RuntimeError(f"API jobs delete error: {resp.status_code} - {resp.text}")
