# Project Files

## JavaScript Files — scraper/

| File | Description |
|------|-------------|
| `scraper/index.js` | Main scraper - full workflow: validate company → scrape → transform → upsert → generate docs/jobs.md. Source-specific: `scrapeAntibioticeCareers`, `fetchSitemapJobUrls`, `parseListing`, `matchSitemapUrl`, `parseDeadline`, `slugify`, `searchANOFM` |
| `scraper/company.js` | Validates company via ANAF + CUIScan + Peviitor APIs, checks if company is active/inactive |
| `scraper/anaf.js` | Multi-source company data module - ANAF + CUIScan (company details) + CUIFirma (search). Exports `getCompanyFromANAF`, `getCompanyFromANAFWithFallback`, `searchCompany` |
| `scraper/demoanaf.js` | CLI entry point for anaf.js (thin wrapper) |
| `scraper/api.js` | Peviitor API operations module - exports querySOLR, deleteJobByUrl, upsertJobs + standalone verify/extract/company commands |
| `scraper/validate-jobs.js` | **Generic deep validator (manual use).** Full GET requests, parses page body for "no longer available" keywords. Works with any CIF, single URL, or file. Slower but catches soft-404s. Not used by CI. |
| `scraper/job-validator.js` | Shared validation primitives - exports validateByHead(url), validateByContent(url, opts), validateByBrowser(url, opts), DEFAULT_EXPIRED_KEYWORDS. Used by `validate-jobs.js`, `tests/validate-antibiotice-jobs.js`, and the deep-validate workflow. |
| `scraper/self-healing.js` | **Generic** selector cascade — `firstMatch`, `locateArticles`, `jsonLdJobPostings`, `cssText`/`structuralText`/`regexText`. Primary CSS → fallback CSS → structural/JSON-LD → regex, `try/catch` + log per strategy. Consumed by `parseListing`. See `ai/AGENTS.md`. |
| `scraper/validate.js` | **Generic** pre-publish data validation — `validateJob` (url/title/location/salary), `filterValidJobs` (drops + logs), `assertScrapeYieldedJobs` (the 0-result canary). |
| `scraper/markdown-generator.js` | Generates docs/jobs.md - exports generateJobsMarkdown(companyData, jobs) |

## Config — scraper/config/

| File | Description |
|------|-------------|
| `scraper/config/company.json` | **Single source of truth for company identity.** All scraper code, CI workflows, and the static HTML read from this file. To derive a scraper for a different company, this is the primary file to edit. `scraperFile` must be the GitHub Actions workflow URL (not raw). |
| `scraper/config/company.js` | ESM wrapper that imports and exposes `scraper/config/company.json` to Node code |
| `scraper/config/scraper.json` | Source config: `antibiotice.ro` sitemap/listing/jobArchive URLs, Cheerio selectors, delays, timeouts, `ownJobUrlPrefix`, `defaultLocation`, `defaultWorkmode` |
| `scraper/config/scraper.js` | ESM wrapper that exposes `scraper.json` (+ `userAgent`) to Node code |

## Test Files — tests/

| File | Description |
|------|-------------|
| `tests/package.json` | Jest config for test suite - experimental VM modules, test scripts (unit/integration/e2e/consistency) |
| `tests/company.json` | Mock company data used in unit tests |
| `tests/validate-antibiotice-jobs.js` | **Company-specific validator (used by CI).** Modes: `--head` (default), `--content`. Called nightly by `automation-testing.yml` and manually via `job-deep-validate.yml`. Supports `--dry-run` and `--delete`. |
| `tests/unit/index.test.js` | Unit tests for index.js - slugify, parseDeadline, matchSitemapUrl, parseListing, mapToJobModel, transformJobsForSOLR |
| `tests/unit/company.test.js` | Unit tests for company.js - getCompanyBrand, validateAndGetCompany, fallback caching |
| `tests/unit/api.test.js` | Unit tests for api.js - query, upsert, delete, HTTP error handling |
| `tests/unit/demoanaf.test.js` | Unit tests for anaf.js - search, company retrieval, CUIScan/CUIFirma fallback |
| `tests/unit/job-validator.test.js` | Unit tests for job-validator.js - validateByHead, validateByContent, validateByBrowser |
| `tests/unit/self-healing.test.js` | Unit tests for self-healing.js - each cascade level in isolation, all-fail logging, JSON-LD, `locateArticles` modes |
| `tests/unit/validate.test.js` | Unit tests for validate.js - url/title/location/salary rules, `filterValidJobs`, canary |
| `tests/unit/markdown-generator.test.js` | Unit tests for markdown-generator.js |
| `tests/integration/workflow.test.js` | Integration tests - ANAF live API, Peviitor API |
| `tests/e2e/scraper.test.js` | E2E tests - full pipeline with real antibiotice.ro, ANAF, and Peviitor API |
| `tests/consistency/public.test.js` | Verifies repository is public on GitHub |
| `tests/consistency/repo.test.js` | Verifies default branch, GitHub Pages, workflow files |
| `tests/consistency/topics.test.js` | Verifies repository has required topics: job-seeker-ro-spider, peviitor-ro |
| `tests/consistency/workflow-naming.test.js` | Validates workflow file naming conventions |
| `tests/consistency/root-files.test.js` | Verifies required root OSS files exist (LICENSE, README, CHANGELOG, ...) |
| `tests/consistency/version.test.js` | Verifies `package.json` version matches the latest CHANGELOG entry |

## Markdown Files

| File | Description |
|------|-------------|
| `INSTRUCTIONS.md` | Project documentation - workflow, technologies, API endpoints, how to update models |
| `job-model.md` | Job schema definition (Peviitor Core) - fields, types, validation rules |
| `company-model.md` | Company schema definition (Peviitor Core) - fields, types, validation rules |
| `files.md` | This file - documents role of each project file |
| `AGENTS.md` | Rules for AI agents working on this project |
| `BRANCH.md` | Branch strategy and naming conventions |

| `ISSUES.md` | Issue tracking conventions |
| `PUBLIC.md` | Notes on public visibility and data policies |
| `ROBOTS.md` | robots.txt analysis and scraping policy for antibiotice.ro |
| `SECURITY.md` | Security policy and vulnerability reporting |
| `TOPICS.md` | Repository topics documentation |
| `UPDATE-REPO-ABOUT.md` | Instructions for updating repo description/about |
| `VERIFY.md` | Step-by-step verification checklist after changes |

## Configuration Files

| File | Description |
|------|-------------|
| `package.json` | Node.js project config - dependencies (node-fetch), scripts |
| `package-lock.json` | Locked dependency versions |
| `.npmrc` | npm configuration |
| `.gitignore` | Ignores node_modules/, tmp/, .env.local |
| `.env.local` | Local environment variables - NOT committed |
| `CHANGELOG.md` | Version history and notable changes |
| `CONTRIBUTING.md` | Contribution guidelines |
| `.github/CODEOWNERS` | Code ownership rules for PR reviews |
| `.github/workflows/job-seeker-ro-spider.yml` | Daily scraping workflow (6 AM UTC) |
| `.github/workflows/automation-testing.yml` | Automated tests on every push/PR |
| `.github/workflows/job-deep-validate.yml` | Manual deep validation (content mode — GET + body scan) |
| `.github/workflows/automation-template-sync-check.yml` | Weekly check that derived scrapers are up to date with this template |
| `.github/workflows/job-recovery-from-disaster.yml` | Manual: restores the company core entry from `scraper/config/company.json` |
| `CODE_OF_CONDUCT.md` | Community code of conduct (Contributor Covenant 2.0) |

## Data Files

| File | Description |
|------|-------------|
| `tmp/company.json` | **Per-run scratch cache (gitignored).** Survives between CI runs so the scraper does not hit demoANAF on every scrape. Refreshed when older than 7 days. |
| `company.json` (root) | **Committed cache.** Refreshed every 7 days. If ANAF is unreachable AND cache is stale, falls back to stale cache rather than failing. |
| `docs/company.json` | Static copy of `scraper/config/company.json` regenerated on each scrape. Served by GitHub Pages so the live page can read company identity without hardcoding it in HTML. |
| `docs/jobs.md` | Scraped jobs in markdown format - company info + all current jobs (generated by CI after each scrape) |

## Notes

- All `.md` schema files (job-model.md, company-model.md) are dynamic — check peviitor_core README.md for updates
- `tmp/` directory holds runtime artifacts (company.json, jobs.json) — not committed
- Full workflow: validate company (ANAF+CUIScan+CUIFirma+Peviitor) → scrape antibiotice.ro/cariere + ANOFM → transform → upsert → generate docs/jobs.md
