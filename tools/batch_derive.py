#!/usr/bin/env python3
"""Derive many scrapers from one spreadsheet -- the actual "90 companies"
entry point. Runs tools/derive_new_scraper.py once per row.

This is deliberately simple (a thin loop, not a rewrite of the pipeline)
so behavior stays identical to deriving one scraper by hand -- same code
path, same idempotency, just looped. If one company fails (bad URL,
missing CIF, gh rate limit, whatever), it's reported and the batch moves
on to the next row rather than aborting the whole run.

CSV columns (header row required; see changes/COMPANIES_EXAMPLE.csv):
  company, cif, brand, website, career, city, lang
  optional: sitemap, job_prefix, sel_article, sel_title, sel_meta, owner, repo

Usage:
    python tools/batch_derive.py --csv changes/companies.csv
    python tools/batch_derive.py --csv changes/companies.csv --dry-run
    python tools/batch_derive.py --csv changes/companies.csv --start-at 15
    python tools/batch_derive.py --csv changes/companies.csv --only-row 3
"""
from __future__ import annotations

import argparse
import csv
import json
import pathlib
import subprocess
import sys

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parents[1]
FLEET_JSON = ROOT / "fleet.json"
REQUIRED_COLUMNS = ("company", "cif", "brand", "website", "career", "city", "lang")
OPTIONAL_COLUMNS = ("sitemap", "job_prefix", "sel_article", "sel_title", "sel_meta", "owner", "repo")


def load_rows(csv_path: pathlib.Path) -> list[dict]:
    with csv_path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        missing = [c for c in REQUIRED_COLUMNS if c not in (reader.fieldnames or [])]
        if missing:
            raise SystemExit(f"CSV is missing required column(s): {', '.join(missing)}")
        return [row for row in reader if row.get("company", "").strip()]


def build_command(row: dict) -> list[str]:
    cmd = [
        sys.executable, str(ROOT / "tools" / "derive_new_scraper.py"),
        "--lang", row["lang"].strip(),
        "--company", row["company"].strip(),
        "--cif", row["cif"].strip(),
        "--brand", row["brand"].strip(),
        "--website", row["website"].strip(),
        "--career", row["career"].strip(),
        "--city", row["city"].strip(),
    ]
    for col, flag in (
        ("sitemap", "--sitemap"), ("job_prefix", "--job-prefix"),
        ("sel_article", "--sel-article"), ("sel_title", "--sel-title"), ("sel_meta", "--sel-meta"),
        ("owner", "--owner"), ("repo", "--repo"),
    ):
        value = (row.get(col) or "").strip()
        if value:
            cmd += [flag, value]
    return cmd


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--csv", required=True, type=pathlib.Path)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--start-at", type=int, default=1, help="1-based row number to start from (for resuming a big batch)")
    parser.add_argument("--only-row", type=int, help="run just this one 1-based row number, for testing a single entry")
    parser.add_argument("--skip-verify", action="store_true")
    args = parser.parse_args()

    rows = load_rows(args.csv)
    print(f"Loaded {len(rows)} companies from {args.csv}\n")

    if args.only_row:
        selected = [(args.only_row, rows[args.only_row - 1])]
    else:
        selected = list(enumerate(rows, start=1))[args.start_at - 1:]

    succeeded: list[str] = []
    failed: list[tuple[int, str, str]] = []

    for n, row in selected:
        company = row["company"].strip()
        print(f"=== [{n}/{len(rows)}] {company} ===")
        cmd = build_command(row)
        if args.dry_run:
            cmd.append("--dry-run")
        if args.skip_verify:
            cmd.append("--skip-verify")
        result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
        print(result.stdout)
        if result.returncode != 0:
            print(result.stderr)
            failed.append((n, company, result.stderr.strip().splitlines()[-1] if result.stderr.strip() else "unknown error"))
        else:
            succeeded.append(company)
        print()

    print("=" * 60)
    print(f"Done: {len(succeeded)} succeeded, {len(failed)} failed (of {len(selected)} attempted)")
    if failed:
        print("\nFailed rows (fix the CSV row and re-run with --only-row N, or resume with --start-at N):")
        for n, company, err in failed:
            print(f"  row {n}: {company} -- {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()
