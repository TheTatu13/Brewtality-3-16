#!/usr/bin/env python3
"""End-to-end: derive a new scraper from the template, create its GitHub
repo, apply metadata/branch-protection, register it in the fleet, and run
a health check -- all in one command.

This is the missing link between "10 scrapers, one at a time by hand" and
"90 scrapers": setup.py/setup.js already derive a scraper from stdin
answers (they work fine piped, not just interactively -- confirmed by
reading both scripts), so this just supplies those answers automatically
and chains the rest of the one-time setup that used to be copy-pasted
`gh` commands.

Pipeline:
  1. clone a fresh copy of the template into ../<repo>/
  2. drive setup.py (py) or setup.js (js) over stdin -- no typing
  3. git add -A && commit
  4. gh repo create --public --source=. --push (or push to an existing
     empty repo, if one was already created)
  5. tools/setup_repo.py --register (topics, homepage, description, Pages,
     branch protection, fleet.json + SCRAPERS.md)
  6. tools/verify_fleet.py --only <repo> (confirm CI actually runs)

Safe to re-run: each step is skipped/adjusted if already done (see
--help on the individual scripts for their own idempotency notes).

Usage:
    python tools/derive_new_scraper.py \\
        --lang py --company "EXEMPLU SRL" --cif 12345678 --brand Exemplu \\
        --website https://exemplu.ro --career https://exemplu.ro/cariere \\
        --city Bucuresti

    python tools/derive_new_scraper.py --lang py --company "..." ... --dry-run
    python tools/derive_new_scraper.py --lang py --company "..." ... --repo custom-repo-name
"""
from __future__ import annotations

import argparse
import pathlib
import re
import subprocess
import sys
import unicodedata

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parents[1]
PARENT = ROOT.parent
TEMPLATE_URL = "https://github.com/TheTatu13/Brewtality-3-16.git"
DEFAULT_OWNER = "TheTatu13"

SUFFIX_RX = re.compile(r"\b(s\.?r\.?l\.?|s\.?a\.?|p\.?f\.?a\.?|s\.?n\.?c\.?|inc\.?|ltd\.?|llc)\b", re.I)


def slugify(s: str) -> str:
    s = SUFFIX_RX.sub("", s.lower())
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def run(cmd: list[str], cwd: pathlib.Path, dry_run: bool, input_text: str | None = None) -> subprocess.CompletedProcess | None:
    print(f"  $ {' '.join(cmd)}" + (" (piped answers)" if input_text else ""))
    if dry_run:
        return None
    result = subprocess.run(
        cmd, cwd=cwd, input=input_text, capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    if result.stdout.strip():
        print("    " + result.stdout.strip().replace("\n", "\n    "))
    if result.returncode != 0 and result.stderr.strip():
        print("    " + result.stderr.strip().replace("\n", "\n    "))
    return result


def build_answers(args: argparse.Namespace, repo: str) -> str:
    # Order must match setup.py/setup.js's prompt sequence exactly. Blank
    # lines accept that prompt's default; required prompts must never be
    # blank or the script loops forever waiting for input.
    lines = [
        args.lang,                      # JavaScript or Python?
        args.company,                   # Company legal name (required)
        args.brand or "",               # Commercial brand (default: first word)
        args.cif,                       # CIF (required)
        args.website,                   # Website (required)
        args.career,                    # Careers page (required)
        "n",                            # Try to auto-detect selector? -- always no (deterministic, no live fetch)
        args.sitemap or "",             # Job sitemap (optional)
        args.job_prefix or "",          # Job permalink prefix (default: website/jobs/)
        args.city,                      # HQ city (required)
        args.sel_article or "",         # Selector: job card (optional)
        args.sel_title or "",           # Selector: job title (optional)
        args.sel_meta or "",            # Selector: deadline/meta (optional)
        args.owner,                     # GitHub owner (required)
        repo,                           # GitHub repo name (we always pass it explicitly)
        "y",                            # Apply?
    ]
    return "\n".join(lines) + "\n"


def clone_template(target_dir: pathlib.Path, dry_run: bool) -> bool:
    if target_dir.exists():
        print(f"  {target_dir.name}/ already exists -- assuming already derived, skipping clone+setup")
        return False
    print(f"  cloning template -> {target_dir}")
    if not dry_run:
        subprocess.run(["git", "clone", "--depth", "1", TEMPLATE_URL, str(target_dir)], cwd=PARENT, check=True)
    return True


def run_setup_script(target_dir: pathlib.Path, args: argparse.Namespace, repo: str, dry_run: bool) -> None:
    answers = build_answers(args, repo)
    if args.lang == "py":
        cmd = [sys.executable, "setup.py"]
    else:
        cmd = ["node", "setup.js"]
    result = run(cmd, cwd=target_dir, dry_run=dry_run, input_text=answers)
    if dry_run:
        return
    ok_marker = "OK -" if args.lang == "py" else "OK -"
    if result is None or result.returncode != 0 or ok_marker not in result.stdout:
        raise SystemExit(
            f"setup script did not report success (exit {result.returncode if result else '?'}) -- "
            f"see output above. The clone at {target_dir} is left in place for inspection; "
            "delete it before retrying this company."
        )


def commit_and_create_repo(target_dir: pathlib.Path, owner: str, repo: str, company: str, dry_run: bool) -> None:
    run(["git", "add", "-A"], cwd=target_dir, dry_run=dry_run)
    status = run(["git", "status", "--porcelain"], cwd=target_dir, dry_run=dry_run)
    if not dry_run and status is not None and status.stdout.strip():
        run(["git", "commit", "-m", f"Initial scraper for {company}"], cwd=target_dir, dry_run=dry_run)
    else:
        print("  (nothing to commit -- already committed on a previous attempt)")

    create = run(
        ["gh", "repo", "create", f"{owner}/{repo}", "--public", "--source=.", "--push"],
        cwd=target_dir, dry_run=dry_run,
    )
    if dry_run:
        return
    if create is not None and create.returncode != 0:
        stderr = create.stderr.lower()
        if "already exists" in stderr or "name already exists" in stderr:
            print("  repo already exists on GitHub -- pushing to it instead")
            run(["git", "branch", "-M", "main"], cwd=target_dir, dry_run=dry_run)
            remote = run(["git", "remote", "get-url", "origin"], cwd=target_dir, dry_run=dry_run)
            if remote is None or remote.returncode != 0:
                run(["git", "remote", "add", "origin", f"https://github.com/{owner}/{repo}.git"], cwd=target_dir, dry_run=dry_run)
            push = run(["git", "push", "-u", "origin", "main"], cwd=target_dir, dry_run=dry_run)
            if push is None or push.returncode != 0:
                raise SystemExit("push to existing repo failed -- see output above, resolve manually")
        else:
            raise SystemExit("gh repo create failed -- see output above")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--lang", required=True, choices=["py", "js"])
    parser.add_argument("--company", required=True, help='legal name, e.g. "EXEMPLU SRL"')
    parser.add_argument("--cif", required=True)
    parser.add_argument("--brand", help="defaults to the company name's first word, same as setup.py/js")
    parser.add_argument("--website", required=True)
    parser.add_argument("--career", required=True, help="careers / open-positions page URL")
    parser.add_argument("--city", required=True)
    parser.add_argument("--sitemap")
    parser.add_argument("--job-prefix")
    parser.add_argument("--sel-article")
    parser.add_argument("--sel-title")
    parser.add_argument("--sel-meta")
    parser.add_argument("--owner", default=DEFAULT_OWNER)
    parser.add_argument("--repo", help="defaults to <slug>-nodejs-scraper / <slug>-python-scraper")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-verify", action="store_true", help="skip the final verify_fleet.py check")
    args = parser.parse_args()

    slug = slugify(args.company)
    repo = args.repo or f"{slug}-{'nodejs' if args.lang == 'js' else 'python'}-scraper"
    target_dir = PARENT / repo

    print(f"Deriving {args.company!r} ({args.lang}) -> {args.owner}/{repo}{' (dry-run)' if args.dry_run else ''}\n")

    print("1. Clone template + run setup script")
    cloned = clone_template(target_dir, args.dry_run)
    if cloned or args.dry_run:
        run_setup_script(target_dir, args, repo, args.dry_run)

    print("\n2. Commit + create/push GitHub repo")
    commit_and_create_repo(target_dir, args.owner, repo, args.company, args.dry_run)

    print("\n3. Repo metadata + branch protection + fleet registration")
    setup_repo_cmd = [
        sys.executable, str(ROOT / "tools" / "setup_repo.py"),
        "--repo", repo, "--company", args.company, "--owner", args.owner,
        "--cif", args.cif, "--brand", args.brand or args.company.split()[0],
        "--lang", args.lang, "--register",
    ]
    if args.dry_run:
        setup_repo_cmd.append("--dry-run")
    run(setup_repo_cmd, cwd=ROOT, dry_run=False)  # setup_repo.py has its own --dry-run, always actually invoke it

    if args.skip_verify or args.dry_run:
        print("\nDone (dry-run or --skip-verify: not verifying).")
        return

    print("\n4. Health check")
    run([sys.executable, str(ROOT / "tools" / "verify_fleet.py"), "--only", repo], cwd=ROOT, dry_run=False)

    print(f"\nDone. New scraper at {target_dir}")
    print("Next: tune the selectors and adapt the parse function per DEFINITION_OF_DONE.md,")
    print("then run the tests and trigger a real (non-dry-run) scrape.yml dispatch once.")


if __name__ == "__main__":
    main()
