# Changelog

## [0.2.0] - 2026-09-23

### Fixed
- `scrape.yml`: `Pre-scrape tests` step never set `GITHUB_TOKEN`, so
  `tests/consistency/test_public.py` hit GitHub's unauthenticated rate limit
  and failed intermittently. Now passed via `env:`.
- `autoheal` job: `gh` calls had no `.git` to infer the repo from (the job
  has no `actions/checkout` step) and crashed with "not a git repository".
  Fixed by adding `-R "${{ github.repository }}"` to every `gh` call.
- `tests/integration/test_company_real.py`: live ANAF/CUIScan and peViitor
  Solr calls failed the whole test run on transient upstream flakiness.
  Added a `_with_retries()` helper (3 attempts, 2s delay) that retries the
  call and `pytest.skip()`s — never fails the build — if every attempt
  raises. Production code (`scraper/anaf.py`) is intentionally untouched:
  its single-attempt, no-retry design per source is deliberate and locked in
  by `test_anaf_calls_are_single_attempt_no_retry`.

### Changed
- `scrape.yml` / `tests.yml` split into a thin **caller** file (unchanged
  triggers, kept in this repo for copy-pasting into new scrapers) plus the
  actual logic moved into `scrape-reusable.yml` / `tests-reusable.yml`,
  called via `uses: TheTatu13/Brewtality-3-16/.github/workflows/*.yml@v1`.
  A fix landed here now reaches every derived scraper that calls it on its
  next run, instead of being hand-applied to each repo separately (which is
  how the two fixes above ended up needing five identical patches).
- The dry-run gate moved into the caller `scrape.yml`, computed once as
  `github.event_name == 'workflow_dispatch' && inputs.dry_run == true` —
  fixes the case where a `schedule` run (no `inputs` context, so
  `github.event.inputs.dry_run` is `""`) silently took the dry-run branch
  forever and never wrote real data.

## [0.1.0] - 2026-09-10

### Added
- Initial skeleton — the Python half of the Brewtality-3-16 template. All
  company identity is `{{PLACEHOLDER}}` in `config/*.json`.
- `scraper/self_healing.py` — generic selector cascade: `first_match`,
  `locate_articles` (CSS → JSON-LD → regex `<article>` → none),
  `json_ld_job_postings`, `css_text`/`structural_text`/`regex_text`.
- `scraper/self_healing.py::scrapling_text` — **optional** adaptive layer
  (`adaptive=True, auto_save=True`); a no-op when `scrapling` is not installed.
- `scraper/validate.py` — `validate_job`, `filter_valid_jobs`,
  `assert_scrape_yielded_jobs` (0-result canary).
- `scraper/fetch.py` — `requests` + retry / full-jitter exponential backoff,
  honours `Retry-After`.
- `scraper/parse.py`, `scraper/api.py`, `scraper/main.py` (scrape → validate →
  canary → upsert → diff summary).
- 53 pytest tests: each cascade level in isolation, all-fail logging, JSON-LD,
  `locate_articles` modes, parse fallbacks (renamed class / JSON-LD-only /
  regex `<article>` / unrecognisable page), validation rules, retry/backoff,
  main-level canary.
- `ai/AGENTS.md`, `ai/SELF-HEALING.md` (cascade in depth + JS↔Python parity).
- GitHub Actions: `tests.yml` (pytest on 3.10 / 3.12, plus an allowed-to-fail
  run with Scrapling), `scrape.yml` (daily + `autoheal` issue on failure).
