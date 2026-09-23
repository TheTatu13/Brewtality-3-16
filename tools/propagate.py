#!/usr/bin/env python3
"""Propagate a set of file changes to every active scraper in the fleet.

This replaces the old workflow of manually copy/commit/push-ing one repo at
a time. Instead, describe the change once as a small JSON "plan" file, then
run this script -- it walks every active repo in fleet.json, copies the
files, commits and pushes.

Usage:
    python tools/propagate.py --plan changes/my-change.json
    python tools/propagate.py --plan changes/my-change.json --dry-run
    python tools/propagate.py --plan changes/my-change.json --only cemacon-sa-nodejs-scraper,betfair-scraper-py
    python tools/propagate.py --plan changes/my-change.json --no-push   # commit locally, don't push yet

Plan file format (see changes/EXAMPLE.json):
{
  "commit_message": "chore: add leftover-placeholder consistency test",
  "changes": [
    {"lang": "py", "src": "tests/consistency/test_repo.py"},
    {"lang": "js", "src": "tests/consistency/no-leftover-placeholders.test.js"}
  ]
}

"src" is relative to scraper-py/ or scraper-js/ in this template repo.
"dest" is optional and defaults to the same relative path inside the
derived repo (which is how the template's scraper-<lang>/ contents map to
a derived repo's root).
"""
from __future__ import annotations

import argparse
import json
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
PARENT = ROOT.parent  # folder containing all sibling derived-repo clones
FLEET_JSON = ROOT / "fleet.json"


def run(cmd: list[str], cwd: pathlib.Path, check: bool = True) -> subprocess.CompletedProcess:
    print(f"    $ {' '.join(cmd)}")
    result = subprocess.run(
        cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    if result.stdout.strip():
        print("      " + result.stdout.strip().replace("\n", "\n      "))
    if result.returncode != 0:
        print("      " + result.stderr.strip().replace("\n", "\n      "))
        if check:
            raise SystemExit(f"command failed: {' '.join(cmd)}")
    return result


def load_json(path: pathlib.Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def clone_url(scraper: dict) -> str:
    return f"https://github.com/{scraper['owner']}/{scraper['repo']}.git"


def ensure_repo(scraper: dict, dry_run: bool) -> pathlib.Path:
    repo_dir = PARENT / scraper["local_dir"]
    if repo_dir.exists():
        print(f"    pulling latest main into existing clone")
        if not dry_run:
            run(["git", "fetch", "origin"], cwd=repo_dir)
            run(["git", "checkout", "main"], cwd=repo_dir)
            run(["git", "pull", "--ff-only", "origin", "main"], cwd=repo_dir)
    else:
        print(f"    cloning {clone_url(scraper)} -> {repo_dir}")
        if not dry_run:
            run(["git", "clone", clone_url(scraper), str(repo_dir)], cwd=PARENT)
    return repo_dir


def apply_changes(scraper: dict, repo_dir: pathlib.Path, changes: list[dict], dry_run: bool) -> list[str]:
    lang = scraper["language"]
    touched: list[str] = []
    for change in changes:
        if change["lang"] != lang:
            continue
        src = ROOT / f"scraper-{lang}" / change["src"]
        dest_rel = change.get("dest", change["src"])
        dest = repo_dir / dest_rel
        if not src.exists():
            raise SystemExit(f"source file missing: {src}")
        print(f"    {src.relative_to(ROOT)} -> {dest.relative_to(repo_dir)}")
        touched.append(dest_rel)
        if not dry_run:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dest)
    return touched


def commit_and_push(repo_dir: pathlib.Path, touched: list[str], message: str, dry_run: bool, push: bool) -> bool:
    if dry_run:
        print("    (dry-run: skipping git add/commit/push)")
        return True
    run(["git", "add", *touched], cwd=repo_dir)
    status = run(["git", "status", "--porcelain"], cwd=repo_dir, check=False)
    if not status.stdout.strip():
        print("    nothing changed (already up to date) -- skipping commit")
        return True
    run(["git", "commit", "-m", message], cwd=repo_dir)
    if push:
        push_result = run(["git", "push", "origin", "main"], cwd=repo_dir, check=False)
        if push_result.returncode != 0:
            print(f"    !! push failed for {repo_dir.name} -- fix manually, changes are committed locally")
            return False
    else:
        print("    (--no-push: committed locally only)")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--plan", required=True, type=pathlib.Path, help="path to the change plan JSON file")
    parser.add_argument("--only", help="comma-separated repo names to limit to (default: all active repos)")
    parser.add_argument("--dry-run", action="store_true", help="show what would happen, change nothing")
    parser.add_argument("--no-push", action="store_true", help="commit locally but don't push")
    args = parser.parse_args()

    plan = load_json(args.plan)
    fleet = load_json(FLEET_JSON)
    only = set(args.only.split(",")) if args.only else None

    active = [s for s in fleet["scrapers"] if s["status"] == "active"]
    if only:
        unknown = only - {s["repo"] for s in active} - {s["local_dir"] for s in active}
        if unknown:
            print(f"WARNING: --only names not found among active repos: {unknown}")
        active = [s for s in active if s["repo"] in only or s["local_dir"] in only]

    if not active:
        raise SystemExit("no matching active repos -- nothing to do")

    print(f"Plan: {plan['commit_message']!r}")
    print(f"Targets: {len(active)} repo(s){' (dry-run)' if args.dry_run else ''}\n")

    failures: list[str] = []
    skipped: list[str] = []
    for scraper in active:
        relevant = [c for c in plan["changes"] if c["lang"] == scraper["language"]]
        if not relevant:
            skipped.append(scraper["repo"])
            continue
        print(f"== {scraper['repo']} ({scraper['language']}) ==")
        repo_dir = ensure_repo(scraper, args.dry_run)
        touched = apply_changes(scraper, repo_dir, relevant, args.dry_run)
        ok = commit_and_push(repo_dir, touched, plan["commit_message"], args.dry_run, push=not args.no_push)
        if not ok:
            failures.append(scraper["repo"])
        print()

    if skipped:
        print(f"Skipped (no matching-language changes in plan): {', '.join(skipped)}")
    if failures:
        print(f"\nFAILED to push: {', '.join(failures)} -- resolve manually (likely needs a rebase).")
        sys.exit(1)
    print("Done.")


if __name__ == "__main__":
    main()
