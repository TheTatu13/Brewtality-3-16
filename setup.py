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
import sys
import unicodedata
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


def main() -> None:
    print("\nBrewtality-3-16 - derive a scraper\n=================================\n")

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
    sitemap = ask("Job sitemap URL (Enter if the site has none)")
    job_prefix = ask("Canonical job-permalink prefix", default=f"{website}/jobs/")
    city = ask("HQ city", required=True)
    print("\n  CSS selectors - Enter to rely on the generic fallbacks and tune later:\n")
    sel_article = ask("Primary selector for one job card/row")
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
    for name in (".github", "README.md", "CLAUDE.md", ".gitignore", "setup.js", ".git"):
        rmrf(ROOT / name)
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
    print(f'    git init && git add -A && git commit -m "Initial scraper for {company}"')
    print(f"    gh repo create {owner}/{repo} --public --source=. --push\n")
    cfg = "scraper/config/scraper.json" if lang == "js" else "config/scraper.json"
    parse = "parseListing in scraper/index.js" if lang == "js" else "parse_listing in scraper/parse.py"
    test = 'npm install && npm run test:unit' if lang == "js" else 'pip install -e ".[dev]" && pytest -q'
    print(f"  Next: tune the selectors in {cfg} and adapt {parse},")
    print(f"        then run the tests ({test}).\n")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n  Aborted.")
        sys.exit(1)
