#!/usr/bin/env python3
"""Automate the one-time GitHub setup for a newly derived scraper repo.

Replaces the old workflow where setup.py/setup.js only PRINTED the `gh`
commands for Mihai to copy/paste by hand. This actually runs them:
  1. set the two required topics + homepage + description
  2. enable GitHub Pages (serving /docs on main)
  3. apply branch protection (no force-push, no branch deletion; direct
     pushes to main still allowed -- this fleet doesn't use PRs)

Safe to re-run (idempotent): topics/homepage/description are just set,
protection is a PUT (overwrites), and "pages already enabled" is treated
as success, not an error.

Usage:
    python tools/setup_repo.py --repo betfair-scraper-py --company "Betfair Romania Development SRL"
    python tools/setup_repo.py --repo betfair-scraper-py --company "..." --dry-run

    # or, to also register it in fleet.json and regenerate SCRAPERS.md:
    python tools/setup_repo.py --repo betfair-scraper-py --company "..." --cif 22201773 \\
        --brand Betfair --lang py --register
"""
from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
FLEET_JSON = ROOT / "fleet.json"
DEFAULT_OWNER = "TheTatu13"


def run(cmd: list[str], dry_run: bool, allow_fail_msg: str | None = None) -> bool:
    print(f"  $ {' '.join(cmd)}")
    if dry_run:
        return True
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.stdout.strip():
        print("    " + result.stdout.strip().replace("\n", "\n    "))
    if result.returncode != 0:
        stderr = result.stderr.strip()
        if allow_fail_msg and allow_fail_msg.lower() in stderr.lower():
            print(f"    (already done: {stderr})")
            return True
        print("    " + stderr.replace("\n", "\n    "))
        return False
    return True


def set_topics_and_metadata(owner: str, repo: str, company: str, dry_run: bool) -> bool:
    homepage = f"https://{owner.lower()}.github.io/{repo}/"
    cmd = [
        "gh", "repo", "edit", f"{owner}/{repo}",
        "--add-topic", "job-seeker-ro-spider",
        "--add-topic", "peviitor-ro",
        "--homepage", homepage,
        "--description", f"Scraper pentru {company} - peViitor.ro",
    ]
    return run(cmd, dry_run)


def enable_pages(owner: str, repo: str, dry_run: bool) -> bool:
    cmd = [
        "gh", "api", "-X", "POST", f"repos/{owner}/{repo}/pages",
        "-f", "build_type=legacy",
        "-f", "source[branch]=main",
        "-f", "source[path]=/docs",
    ]
    return run(cmd, dry_run, allow_fail_msg="already enabled")


def apply_branch_protection(owner: str, repo: str, dry_run: bool) -> bool:
    cmd = [
        "gh", "api", "-X", "PUT", f"repos/{owner}/{repo}/branches/main/protection",
        "-F", "required_status_checks=null",
        "-F", "enforce_admins=false",
        "-F", "required_pull_request_reviews=null",
        "-F", "restrictions=null",
        "-F", "allow_force_pushes=false",
        "-F", "allow_deletions=false",
    ]
    return run(cmd, dry_run)


def register_in_fleet(args: argparse.Namespace, dry_run: bool) -> None:
    if dry_run:
        print(f"  (dry-run: would add {args.repo} to fleet.json and regenerate SCRAPERS.md)")
        return
    fleet = json.loads(FLEET_JSON.read_text(encoding="utf-8"))
    if any(s["repo"] == args.repo for s in fleet["scrapers"]):
        print(f"  {args.repo} already in fleet.json -- skipping registration")
        return
    fleet["scrapers"].append({
        "company": args.company.upper(),
        "brand": args.brand or args.company,
        "cif": args.cif,
        "owner": args.owner,
        "repo": args.repo,
        "local_dir": args.local_dir or args.repo,
        "language": args.lang,
        "template_version": "v1",
        "status": "active",
    })
    FLEET_JSON.write_text(json.dumps(fleet, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"  added {args.repo} to fleet.json")
    subprocess.run([sys.executable, str(ROOT / "tools" / "gen_scrapers_md.py")], check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", required=True, help="GitHub repo name, e.g. betfair-scraper-py")
    parser.add_argument("--company", required=True, help="Company display name, e.g. 'Betfair Romania Development SRL'")
    parser.add_argument("--owner", default=DEFAULT_OWNER)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--register", action="store_true", help="also add this repo to fleet.json + regenerate SCRAPERS.md")
    parser.add_argument("--cif", help="required with --register")
    parser.add_argument("--brand", help="required with --register")
    parser.add_argument("--lang", choices=["py", "js"], help="required with --register")
    parser.add_argument("--local-dir", help="local clone folder name if it differs from --repo")
    args = parser.parse_args()

    if args.register and not (args.cif and args.brand and args.lang):
        parser.error("--register requires --cif, --brand and --lang")

    print(f"Setting up {args.owner}/{args.repo}{' (dry-run)' if args.dry_run else ''}\n")

    ok = True
    print("1. Topics + homepage + description")
    ok &= set_topics_and_metadata(args.owner, args.repo, args.company, args.dry_run)
    print("2. GitHub Pages (serve /docs on main)")
    ok &= enable_pages(args.owner, args.repo, args.dry_run)
    print("3. Branch protection on main")
    ok &= apply_branch_protection(args.owner, args.repo, args.dry_run)

    if args.register:
        print("4. Register in fleet.json")
        register_in_fleet(args, args.dry_run)

    if not ok:
        print("\nSome steps failed -- see output above. Re-run once the underlying issue is fixed; every step is safe to repeat.")
        sys.exit(1)
    print("\nDone.")


if __name__ == "__main__":
    main()
