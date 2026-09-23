#!/usr/bin/env python3
"""Brewtality-3-16 — interactive derivation script.

    python setup.py

Asks for a language and the company details, then turns this template repo
*in place* into a ready-to-commit scraper for one company:
  - deletes the language folder you did not pick
  - promotes the one you did pick to the repo root
  - fills every {{PLACEHOLDER}} with your answers
  - names the package after the company
  - removes itself, the sibling setup.js and the template's git history

Standard library only — no install step. (This file is a plain script, not a
setuptools build script.)
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

# Read/write the console as UTF-8 so accented company names / cities survive
# (Windows consoles otherwise default to a legacy code page).
for _stream in (sys.stdin, sys.stdout):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = Path(__file__).resolve().parent
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".pytest_cache", ".venv"}
_PLACEHOLDER_RX = re.compile(r"\{\{([A-Z_]+)\}\}")
_SUFFIX_RX = re.compile(r"\b(s\.?r\.?l\.?|s\.?a\.?|p\.?f\.?a\.?|s\.?n\.?c\.?|inc\.?|ltd\.?|llc)\b")
_SELECTOR_KEYWORD_RX = re.compile(r"job|position|career|vacan|post|listing|ofert|anunt", re.I)


def _readline(prompt_text: str) -> str:
    try:
        return input(prompt_text).strip()
    except EOFError:
        return ""


def ask(label: str, *, default: str = "", required: bool = False) -> str:
    if default:
        suffix = f" [{default}]"
    elif required:
        suffix = " (required)"
    else:
        suffix = " (optional, Enter to skip)"
    for _ in range(100):
        answer = _readline(f"  {label}{suffix}: ") or default
        if answer or not required:
            return answer
        print("    - this one is required.")
    sys.exit(f"\n  x no value provided for '{label}'.")


def slugify(s: str) -> str:
    s = _SUFFIX_RX.sub("", s.lower())
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def iter_files(root: Path):
    for p in root.rglob("*"):
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        if p.is_file():
            yield p


def rmrf(p: Path) -> None:
    if p.is_dir():
        shutil.rmtree(p, ignore_errors=True)
    elif p.exists():
        p.unlink()


def move_contents(src: Path, dst: Path) -> None:
    for entry in list(src.iterdir()):
        target = dst / entry.name
        rmrf(target)
        shutil.move(str(entry), str(target))


def replace_in_file(path: Path, mapping: dict[str, str]) -> None:
    try:
        text = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return
    if "{{" not in text:
        return
    new = _PLACEHOLDER_RX.sub(lambda m: mapping.get(m.group(1), m.group(0)), text)
    if new != text:
        path.write_text(new, encoding="utf-8")


def set_json_name(path: Path, name: str) -> None:
    if not path.exists():
        return
    data = json.loads(path.read_text(encoding="utf-8"))
    data["name"] = name
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def set_pyproject_name(path: Path, name: str) -> None:
    if not path.exists():
        return
    text = re.sub(r'^name = ".*"$', f'name = "{name}"', path.read_text(encoding="utf-8"), flags=re.M)
    path.write_text(text, encoding="utf-8")


def is_git_worktree() -> bool:
    """True if ROOT/.git is a linked-worktree pointer file, not a real git dir.

    A plain clone has .git/ as a directory. A linked `git worktree` checkout
    has .git as a *file* containing `gitdir: ...`. Deleting that pointer (as
    the transform step below does, to detach from the template's history)
    makes git silently fall through to whatever repo owns the parent
    directory - so `git add -A && git commit` afterwards could land in the
    template's own history instead of the new scraper's.
    """
    git_path = ROOT / ".git"
    if not git_path.exists() or git_path.is_dir():
        return False
    try:
        content = git_path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return False
    if not content.startswith("gitdir:"):
        return False
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=ROOT, capture_output=True, text=True, timeout=5, check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return True  # can't confirm via git, but the gitfile shape is enough
    return result.returncode == 0 and result.stdout.strip() == "true"


def reinit_git(was_worktree: bool) -> None:
    """Give the derived scraper its own, independent git history on `main`.

    Runs right after the old .git (template history, or a worktree's gitdir
    pointer) is removed, so there is no window where the folder could fall
    through to a parent repository. Branch name is forced to `main` via
    `symbolic-ref` (safe on a just-initialised repo with zero commits) rather
    than relying on the user's `init.defaultBranch` config, which may say
    `master` or anything else.
    """
    try:
        subprocess.run(["git", "init", "-q"], cwd=ROOT, check=True, capture_output=True, text=True, timeout=10)
        subprocess.run(
            ["git", "symbolic-ref", "HEAD", "refs/heads/main"],
            cwd=ROOT, check=True, capture_output=True, text=True, timeout=10,
        )
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        print(
            "\n  ! could not initialise a fresh git repository automatically "
            f"({exc}).\n    Run this yourself before committing:\n      git init -b main\n"
        )
        return
    note = " (this clone was a git worktree - it now has its own, independent history)" if was_worktree else ""
    print(f"\n  -> fresh git repo initialised on branch 'main'{note}.")


def fetch_html(url: str, timeout: float = 10.0) -> str | None:
    req = urllib.request.Request(
        url, headers={"User-Agent": "Mozilla/5.0 (compatible; Brewtality-setup/1.0)"}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - user-provided URL, by design
            raw = resp.read(2_000_000)  # cap at ~2MB, plenty for a listing page
            charset = resp.headers.get_content_charset() or "utf-8"
            return raw.decode(charset, errors="replace")
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        print(f"    - could not fetch the page ({exc}).")
        return None


def best_selector_candidate(html: str) -> tuple[str, int] | None:
    """Heuristic, regex-only (no deps yet) scan for a repeated job-card selector.

    Looks for a CSS class that (a) repeats at least 3 times, the way one
    card/row per job would, and (b) contains a job-related keyword. Falls
    back to counting <article> tags. Same heuristic as setup.js, by design.
    """
    counts: dict[str, int] = {}
    for m in re.finditer(r'class=["\']([^"\']+)["\']', html):
        for tok in m.group(1).split():
            counts[tok] = counts.get(tok, 0) + 1
    best: tuple[str, int] | None = None
    for tok, count in counts.items():
        if count >= 3 and _SELECTOR_KEYWORD_RX.search(tok):
            if best is None or count > best[1]:
                best = (tok, count)
    if best:
        return f".{best[0]}", best[1]
    article_count = len(re.findall(r"<article[\s>]", html, re.I))
    if article_count >= 3:
        return "article", article_count
    return None


def detect_job_selector(career_url: str) -> str:
    print("\n    fetching the careers page ...")
    html = fetch_html(career_url)
    if html is None:
        return ""
    candidate = best_selector_candidate(html)
    if not candidate:
        print("    - no confident candidate found; keeping the generic fallbacks.")
        return ""
    selector, count = candidate
    accept = _readline(
        f"    Found `{selector}` repeated {count}x on the page - use it as the "
        "primary job-card selector? (Y/n): "
    ).lower()
    if accept in {"", "y", "yes", "da"}:
        return selector
    print("    - discarded; keeping the generic fallbacks.")
    return ""


def main() -> None:
    print("\nBrewtality-3-16 - derive a scraper\n=================================\n")

    was_worktree = is_git_worktree()
    if was_worktree:
        print(
            "  ! detected: this clone's .git is a worktree pointer, not a real git\n"
            "    directory. That's fine - this script gives the derived scraper its\n"
            "    own independent git history (step 3 below), so nothing can leak\n"
            "    into the worktree's parent repository.\n"
        )

    lang_input = ""
    for _ in range(20):
        if lang_input.lower() in {"js", "py", "1", "2"}:
            break
        lang_input = _readline("  JavaScript or Python?  (js / py  or  1 / 2): ")
    if lang_input.lower() not in {"js", "py", "1", "2"}:
        sys.exit("\n  x no language chosen.")
    lang = "js" if lang_input.lower() in {"js", "1"} else "py"
    keep_dir = "scraper-js" if lang == "js" else "scraper-py"
    drop_dir = "scraper-py" if lang == "js" else "scraper-js"

    if not (ROOT / keep_dir).is_dir():
        sys.exit(f"\n  x {keep_dir}/ not found - run this from a fresh clone of the template.")

    print(f"\n  -> {'JavaScript' if lang == 'js' else 'Python'} it is. Now the company details:\n")

    company = ask("Company legal name (UPPERCASE, e.g. EXAMPLE COMPANY SRL)", required=True)
    slug = slugify(company)
    brand = ask("Commercial brand", default=company.split()[0])
    cif = ask("CIF / CUI (digits only, no RO prefix)", required=True)
    website = ask("Company website (https://...)", required=True).rstrip("/")
    career = ask("Careers / open-positions page URL", required=True)

    detected_article = ""
    try_detect = _readline(
        "  Try to auto-detect a CSS selector for job cards by fetching this page now? (y/N): "
    )
    if try_detect.lower() in {"y", "yes", "da"}:
        detected_article = detect_job_selector(career)

    sitemap = ask("Job sitemap URL (Enter if the site has none)")
    job_prefix = ask("Canonical job-permalink prefix", default=f"{website}/jobs/")
    city = ask("HQ city", required=True)
    print("\n  CSS selectors - Enter to rely on the generic fallbacks and tune later:\n")
    sel_article = ask("Primary selector for one job card/row", default=detected_article)
    sel_title = ask("Primary selector for the job title")
    sel_meta = ask("Primary selector for the deadline/meta text")
    print()
    owner = ask("GitHub owner / org", required=True)
    repo = ask("GitHub repo name", default=f"{slug}-{'nodejs' if lang == 'js' else 'python'}-scraper")

    mapping = {
        "COMPANY_NAME": company,
        "COMPANY_BRAND": brand,
        "CIF": cif,
        "WEBSITE_URL": website,
        "CAREER_URL": career,
        "SITEMAP_URL": sitemap,
        "JOB_URL_PREFIX": job_prefix,
        "DEFAULT_CITY": city,
        "SELECTOR_JOB_ARTICLE": sel_article,
        "SELECTOR_JOB_TITLE": sel_title,
        "SELECTOR_JOB_META": sel_meta,
        "GITHUB_OWNER": owner,
        "GITHUB_REPO": repo,
    }

    print("\n  Summary\n  -------")
    print(f"  language : {'JavaScript (scraper-js)' if lang == 'js' else 'Python (scraper-py)'}")
    for k, v in mapping.items():
        print(f"  {k:<20} {v or '(blank -> fallbacks)'}")
    confirm = _readline("\n  Apply? This rewrites the repo in place and cannot be undone. (y/N): ").lower()
    if confirm not in {"y", "yes"}:
        print("  Aborted - nothing changed.")
        return

    pkg_name = f"{slug}-scraper"

    rmrf(ROOT / drop_dir)
    for name in (
        ".github", "README.md", "CLAUDE.md", ".gitignore", "setup.js",
        # fleet-management files that live at the template root only --
        # a derived repo gets its own copy of nothing here (bug found by
        # tools/derive_new_scraper.py's first real test run: these were
        # silently carried into the derived repo because this list never
        # got updated when Faza 4 added them to the template root).
        "SCRAPERS.md", "DEFINITION_OF_DONE.md", "fleet.json", "tools", "changes",
    ):
        rmrf(ROOT / name)
    rmrf(ROOT / ".git")
    reinit_git(was_worktree)
    move_contents(ROOT / keep_dir, ROOT)
    rmrf(ROOT / keep_dir)

    for path in iter_files(ROOT):
        if path.name == "setup.py":
            continue
        replace_in_file(path, mapping)

    set_json_name(ROOT / "package.json", pkg_name)
    set_pyproject_name(ROOT / "pyproject.toml", pkg_name)

    rmrf(ROOT / "setup.py")

    lang_name = "JavaScript" if lang == "js" else "Python"
    print(f"\n  OK - scraper generated for {company} in {lang_name}.")
    print(f"    package/module name: {pkg_name}")
    print(f"    intended repo:       github.com/{owner}/{repo}\n")
    print("  Ready for the first commit:")
    print(f'    git add -A && git commit -m "Initial scraper for {company}"')
    print(f"    gh repo create {owner}/{repo} --public --source=. --push\n")
    print("  IMPORTANT -- gh repo create does NOT set these, and the consistency")
    print("  tests in CI will fail on first push without them (see ai/UPDATE-REPO-ABOUT.md):")
    print(f'    gh repo edit {owner}/{repo} --add-topic job-seeker-ro-spider --add-topic peviitor-ro \\')
    print(f'      --homepage "https://{owner.lower()}.github.io/{repo}/" \\')
    print(f'      --description "Scraper pentru {company} - peViitor.ro"')
    print(f'    gh api -X POST repos/{owner}/{repo}/pages -f build_type=legacy -f "source[branch]=main" -f "source[path]=/docs"\n')
    print("  Also apply branch protection (blocks force-push + deletion on main;")
    print("  does NOT require PRs/reviews -- this fleet pushes directly to main):")
    print(f"    gh api -X PUT repos/{owner}/{repo}/branches/main/protection \\")
    print('      -F required_status_checks=null -F enforce_admins=false \\')
    print('      -F required_pull_request_reviews=null -F restrictions=null \\')
    print('      -F allow_force_pushes=false -F allow_deletions=false\n')
    cfg = "scraper/config/scraper.json" if lang == "js" else "config/scraper.json"
    parse = "parseListing in scraper/index.js" if lang == "js" else "parse_listing in scraper/parse.py"
    test = 'npm install && npm run test:unit' if lang == "js" else 'pip install -e ".[dev]" && pytest -q'
    print(f"  Next: tune the selectors in {cfg} and adapt {parse},")
    print(f"        then run the tests ({test}).")
    print("\n  This scraper isn't done until DEFINITION_OF_DONE.md's checklist is")
    print("  clear (it didn't come along in the derivation -- it's a template-repo")
    print("  doc, not a per-scraper one; read it at github.com/TheTatu13/Brewtality-3-16).\n")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n  Aborted.")
        sys.exit(1)
