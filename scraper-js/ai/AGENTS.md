# AGENTS.md — Rules for AI agents

## Project
Antibiotice scraper for peviitor.ro (Node.js, ESM, Jest)

## 🌱 This Repo Is a Derived Scraper
This repo is a scraper **derived** from the [EPAM template](https://github.com/sebiboga/epam-systems-international-srl-nodejs-scraper) for **ANTIBIOTICE SA** (CIF: 1973096).

When making changes:
- **All company-specific identity lives in `scraper/config/company.json`** (id, company, brand, URLs, API params). Read from `scraper/config/company.js` in Node code, or via `jq` in workflows. Never hardcode in source files.
- **Only the scraping logic in `scraper/index.js`** (`scrapeAntibioticeCareers`, `fetchSitemapJobUrls`, `parseListing`, `searchANOFM`) is source-specific. The output shape (`mapToJobModel`, `transformJobsForSOLR`) must stay uniform across peviitor.ro scrapers.

## Self-healing selector cascade

`scraper/self-healing.js` + `scraper/validate.js` are **generic** (no site knowledge) — copy them verbatim into a derived scraper. Only `scraper/config/scraper.json` and `parseListing` in `index.js` are site-specific.

### How a field is extracted

Every field on the listing page goes through a cascade, tried top to bottom until one strategy returns a non-empty value. Each step is wrapped in its own `try/catch` — a throwing or empty strategy is **logged** (`[self-heal] <field>: …`) and the cascade continues, so one broken selector never fails the run, and a fallback that rescues a field is printed immediately (not discovered two weeks later).

| Level | Strategy | Where it's configured |
|---|---|---|
| 1 | Primary CSS selector | first entry of the `selectors.*` array in `scraper/config/scraper.json` |
| 2 | Fallback CSS selectors | remaining entries of that array (headings, `[class*='…']`, permalink anchor, …) |
| 3 | Structural anchoring | `[itemprop='…']`, `[aria-label]`, `<meta content>`, and **JSON-LD `JobPosting`** (`schema.org`) — the most stable hook a careers page offers |
| 4 | Regex on raw HTML | `<hN>` / `<a>` capture as a last-resort safety net |

The **article-level** cascade (finding the repeated job blocks at all) works the same way — `locateArticles()` returns a `mode`:
`css:<selector>` → `jsonld` (JobPosting blocks, no article markup) → `regex:<article>` (slice `<article>…</article>`) → `none` (canary fires).

### Config format (`scraper/config/scraper.json`)

```json
"selectors": {
  "jobArticle": ["article.job-item", "[class*='job-item']", ".career-item, li.job"],
  "jobTitle":   [".header-job h3", "h1, h2, h3, h4", "[itemprop='title']", "a[href*='/joburi/']"],
  "jobMeta":    ["article.job-item > p", ".job-item p", "p, .meta, [class*='deadline']"]
}
```

A single string is still accepted (`asList()` normalises it). Put the **most specific** selector first, broader fallbacks after.

### Adding a field to a derived scraper

1. Add its selector list to `selectors` in `scraper.json` (primary + 1–2 fallbacks).
2. In `parseListing`, extract it with `firstMatch("<field>", [ …strategies ])`, or `scope.text(selectors)` for the plain CSS cascade.
3. Compose strategies from `cssText`, `structuralText`, `regexText`, `jsonLdJobPostings`.
4. Add a test per level in `tests/unit/self-healing.test.js` / `index.test.js` (primary works → fallback works → regex works → all-fail logs).

### Validation & canary (`scraper/validate.js`)

- `validateJob(job)` → `{ valid, errors }`: URL must be a real http(s) URL, title non-empty / no HTML / ≤ 200 chars, `location` an array of non-empty strings, `salary` a string with no negative amount.
- `filterValidJobs(jobs)` drops the failures (logged individually) before mapping to the job model.
- `assertScrapeYieldedJobs(jobs)` is the **canary** — throws before any file write / API call when the scrape produced nothing (or nothing survived validation). A 0-result run almost always means the markup changed, not that the company has no openings.

### Scrapling (Python only)

The Python counterpart (`peviitor-scraper-py`) has an **optional** extra cascade level via [Scrapling](https://github.com/D4Vinci/Scrapling) (`adaptive=True, auto_save=True`) — it fingerprints an element and relocates it by similarity when the selector drifts. Cheerio has no equivalent, so the JS scraper implements levels 1–4 by hand. See `peviitor-scraper-py/ai/SELF-HEALING.md`.

## Critical Rules

### 0. Background tasks — always pass `--repo` explicitly to `gh`

When polling a workflow run with `until [ "$(gh run view ID --json status -q .status)" = "completed" ]; do sleep N; done`, the `gh run view` command implicitly uses the current working directory's git remote. If the CWD is a different repo (e.g. you cd-ed elsewhere mid-task), `gh` looks in the wrong repo and returns 404 — the loop's check becomes `"" != "completed"` (always true) and the background task sleeps forever.

**Always specify the repo explicitly:**
```bash
gh run view <RUN_ID> --repo TheTatu13/antibiotice-sa-nodejs-scraper --json status -q .status
```

Before starting any `gh run watch` or polling loop in the background, sanity-check:
- Does the command include `--repo`?
- Is the run ID from the same repo as `--repo`?

If you spawn a stuck task, kill it immediately rather than letting it hang.

### 1. Temporary Files
All temporary/scratch files MUST go in `tmp/` inside the project root.
NEVER use paths outside the project (e.g. `C:\Users\...\AppData\Local\Temp\opencode`).

### 2. Issues & GitHub
- **Orice modificare de cod trebuie să aibă un issue în GitHub Issues** (vezi [ISSUES.md](ISSUES.md))
- Excepții: typo-uri, whitespace, documentație minoră
- Create a GitHub issue before implementing any change
- Commit messages must reference the issue they close
- Never commit credentials (`.env.local`, `*.pem`, etc.)
- Push after commit

### 3. Environment Variables
- `.env.local` is NOT used — all operations go through the Peviitor API (no direct SOLR access)
- Consistency tests need `GITHUB_REPOSITORY` (format: `owner/repo`) and `GITHUB_TOKEN`

### 4. Testing
```bash
npm run test:unit
npm run test:integration   # needs ANAF
npm run test:e2e           # needs ANAF
npm run test:consistency   # needs GITHUB_REPOSITORY + GITHUB_TOKEN
```

### 5. Commit & Push
- `git add -A && git commit -m "..." && git push`
- Commit messages must reference the related issue
- Never `--force` push

### 6. DO NOT modify these files (derived from template)
- `scraper/anaf.js`
- `scraper/company.js`
- `scraper/job-validator.js`
- `scraper/validate-jobs.js`

### 7. Maintenance Agent
See [MAINTENANCE.md](MAINTENANCE.md) for the full maintenance workflow.

**On every session:**
1. Check open GitHub issues: `gh issue list --repo TheTatu13/antibiotice-sa-nodejs-scraper --state open`
2. Prioritize: `critical` → `bug` → `enhancement` → `documentation`
3. Fix all issues, commit with `#issue` reference, close the issue
