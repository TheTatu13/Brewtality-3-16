# Changelog

All notable changes to this template are documented here. A **derived** scraper
starts its own changelog from its first release.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-09-23

### Added
- `tests/unit/api.test.js`: regression tests for the CIF zero-padding bug
  family — assert the actual outgoing request (URL query param or JSON
  body) is padded to 8 digits for every call site that touches a CIF
  (`getCompanyByCif`, `querySOLR`, `upsertCompany`, `deleteJobsByCIF`,
  `upsertJobs`). `padCif()` itself was already applied consistently
  everywhere (verified across all derived repos), but nothing guarded that
  behaviour against a future regression — a stale copy missing the padding
  is exactly how the historical company-core duplicate records happened.

## [1.0.0] - 2026-09-10

### Added
- `scraper/self-healing.js` — generic selector cascade: `firstMatch`,
  `locateArticles` (CSS list → JSON-LD `JobPosting` → regex `<article>` → none),
  `jsonLdJobPostings`, `cssText`/`structuralText`/`regexText`. One `try/catch`
  per strategy; a failed or rescued step is logged immediately.
- `scraper/validate.js` — `validateJob` (url / title / location / salary),
  `filterValidJobs` (drops + logs), `assertScrapeYieldedJobs` (0-result canary).
- `scraper/api.js` — `fetchWithRetry`: retry + full-jitter exponential backoff
  on transient failures (network, 429, 5xx), honours `Retry-After`.
- `parseListing(html, selectors?)` in `scraper/index.js` runs on the cascade;
  the article / title / deadline fields each self-heal independently.
- Extended test suite (`tests/unit/**`): each cascade level in isolation,
  all-fail logging, JSON-LD, `locateArticles` modes, parse fallbacks
  (renamed class / missing headings / JSON-LD-only / regex `<article>` /
  unrecognisable page), validation rules, retry/backoff.

### Template
- All company identity is `{{PLACEHOLDER}}` in `scraper/config/*.json`,
  `docs/`, `ai/`, workflows. See the repo root `README.md` for the placeholder
  list. Unit tests pass with placeholders in place; live (e2e / integration)
  tests self-skip until a real company is configured.
