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

## `tools/derive_new_scraper.py` -- full pipeline: one company in, one live repo out

Drives `setup.py`/`setup.js` non-interactively (both already support piped
stdin -- no changes needed there beyond the deletion-list fix below), then
chains everything that used to be manual: commit, `gh repo create` + push,
`setup_repo.py --register`, `verify_fleet.py`. One command, one company:

```
python tools/derive_new_scraper.py --lang py \
    --company "EXEMPLU SRL" --cif 12345678 --brand Exemplu \
    --website https://exemplu.ro --career https://exemplu.ro/cariere \
    --city Bucuresti
```

Always try `--dry-run` first for an unfamiliar company. `--repo` overrides
the auto-generated name (`<slug>-nodejs-scraper` / `<slug>-python-scraper`).
Selector auto-detection is always skipped (answered "n") for determinism in
a batch -- tune `config/scraper.json`'s selectors by hand afterward, same
as `DEFINITION_OF_DONE.md` already asks for every new scraper.

Resumable: if `../<repo>/` already exists, the clone+setup step is skipped
(assumes it's already derived); if the GitHub repo already exists, it
pushes to it instead of failing. Safe to re-run after a partial failure.

## `tools/batch_derive.py` -- the actual "90 companies" entry point

Runs `derive_new_scraper.py` once per row of a CSV:

```
python tools/batch_derive.py --csv changes/companies.csv
python tools/batch_derive.py --csv changes/companies.csv --dry-run       # sanity-check the whole sheet first
python tools/batch_derive.py --csv changes/companies.csv --only-row 3    # test one row
python tools/batch_derive.py --csv changes/companies.csv --start-at 15  # resume after a partial run
```

CSV columns (see `changes/COMPANIES_EXAMPLE.csv`): required --
`company, cif, brand, website, career, city, lang` (lang is `py` or `js`);
optional -- `sitemap, job_prefix, sel_article, sel_title, sel_meta, owner, repo`.
This is the format to hand Alexandra: one row per company, and the batch
handles the rest. One bad row (bad URL, missing CIF) is reported and
skipped -- it doesn't stop the other 89.

**Before running this on all 90 for real:** run `--dry-run` on the whole
sheet first to catch typos/missing columns, then `--only-row` on 2-3 real
entries end-to-end (real GitHub repos, real `gh` calls) to catch anything
sheet-specific before committing to all of them in one sitting.

## Known limits of this pipeline (read before scaling to 90)

- **A `gh api` rate limit is real at this volume.** ~90 derivations means
  ~90 `gh repo create` + several `gh api`/`gh repo edit` calls each,
  authenticated (5000/hour) but still worth batching in a few sittings
  rather than one continuous run if `gh` starts throwing 403s.
- **Selectors are never auto-tuned.** Every derived scraper still needs a
  human pass over `config/scraper.json` against the real careers page --
  this pipeline gets a scraper to "exists, has CI, is registered", not to
  "actually finds the right jobs". `DEFINITION_OF_DONE.md`'s checklist
  still applies per scraper.
- **The template's own root must stay clean.** Any new file added to the
  template root (like `SCRAPERS.md`/`DEFINITION_OF_DONE.md`/`fleet.json`/
  `tools/`/`changes/` were, until this was caught) needs adding to the
  deletion list in *both* `setup.py` and `setup.js`, or it silently leaks
  into every derived repo. This bit us on this pipeline's own first real
  test run -- caught before it reached a real company, not after.
