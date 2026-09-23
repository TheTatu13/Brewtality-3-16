# Fleet tooling

Three scripts under `tools/`, built to close the gap between "10 scrapers,
managed by hand" and "90 scrapers, managed by hand" -- the latter doesn't
work: manual per-repo git loops don't scale and the risk of a mistake (like
the placeholder-regex false-positive caught during the Faza 4 rollout)
grows with every extra repo touched one at a time. All three read
`fleet.json`, the single source of truth for which repos exist -- edit
that file (or use `--register`), never hand-edit `SCRAPERS.md`.

## `fleet.json` + `tools/gen_scrapers_md.py`

`fleet.json` lists every derived repo: company, CIF, owner/repo, language,
template version, status, notes. `SCRAPERS.md` is generated from it:

```
python tools/gen_scrapers_md.py
```

Run this after any manual edit to `fleet.json`. `setup_repo.py --register`
runs it automatically.

## `tools/setup_repo.py` -- one-time GitHub setup for a new repo

Replaces manually copy-pasting the `gh` commands `setup.py`/`setup.js`
used to only print. Run right after `gh repo create`:

```
python tools/setup_repo.py --repo <repo> --company "<Company Name>" \
    --cif <CIF> --brand <Brand> --lang py|js --register
```

Sets topics/homepage/description, enables GitHub Pages, applies branch
protection on `main`, and (with `--register`) adds the repo to
`fleet.json` + regenerates `SCRAPERS.md`. Idempotent -- safe to re-run if
a step failed partway (e.g. transient `gh api` error). Always try
`--dry-run` first on an unfamiliar company name to check the printed
commands before they run for real.

## `tools/propagate.py` -- push one change to every active repo

Replaces the manual "clone/pull, copy file, git add, commit, push" loop
done one repo at a time (how the Faza 4 consistency tests were rolled out
to all 10 repos). Describe the change once as a small JSON plan (see
`changes/EXAMPLE.json`):

```json
{
  "commit_message": "chore: describe the change",
  "changes": [
    {"lang": "py", "src": "tests/consistency/test_repo.py"},
    {"lang": "js", "src": "tests/consistency/some_file.test.js"}
  ]
}
```

`src` is relative to `scraper-py/`/`scraper-js/` in this template repo;
`dest` (optional) defaults to the same relative path inside the derived
repo, since a derived repo's root mirrors the template's `scraper-<lang>/`
contents.

```
python tools/propagate.py --plan changes/my-change.json --dry-run   # see what would happen first
python tools/propagate.py --plan changes/my-change.json             # for real
python tools/propagate.py --plan changes/my-change.json --only some-repo,another-repo
python tools/propagate.py --plan changes/my-change.json --no-push   # commit locally, push manually later
```

It clones a repo if it isn't already cloned as a sibling of this template
repo, otherwise fast-forward pulls `main` first. If content is already
identical, it skips the commit for that repo (safe to re-run after a
partial failure). A push that fails (e.g. needs a rebase) is reported at
the end without stopping the other repos.

**This does NOT touch `scrape-reusable.yml`/`tests-reusable.yml`/etc.**
A change to the *reusable* workflows themselves still goes through
`ai/VERSIONING.md`'s `@v1` tag-move process -- every repo picks that up
automatically on its next run, no propagation needed. `propagate.py` is
for everything else: new test files, doc updates, anything that has to
physically exist as its own file in each repo.

## `tools/verify_fleet.py` -- automated health check

Replaces manually opening each repo's Actions tab and each company's
listing on peviitor.ro. For every active repo:

```
python tools/verify_fleet.py
python tools/verify_fleet.py --only betfair-scraper-py
python tools/verify_fleet.py --json report.json
```

Checks the latest CI run's status (the real pass/fail signal) and shows
the company's `lastScraped` from peviitor.ro's public API for
information. That field is **not** a reliable per-repo freshness signal --
confirmed empirically that a company's record can be last-written by an
unrelated third-party aggregator scraper, not necessarily this repo's own
`scrape.yml` run -- so it's reported, never treated as a failure.

Requires `gh` CLI authenticated. The peviitor.ro API call needs a
browser-like `User-Agent` header -- the default Python `urllib` one gets
a 403 from its WAF/CDN.
