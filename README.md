# Brewtality-3-16

Dual-language job-scraper **template** for [peviitor.ro](https://peviitor.ro),
with a real **self-healing selector cascade** and an extended test suite.

Two complete, parallel reference implementations — pick the language, copy the
folder into a new repo, edit `config/`:

| | |
|---|---|
| [`scraper-js/`](scraper-js/) | Node.js (ESM) · `node-fetch` + Cheerio · Jest · **131 tests** |
| [`scraper-py/`](scraper-py/) | Python 3.10+ · `requests` + BeautifulSoup · pytest · **54 tests** · optional [Scrapling](https://github.com/D4Vinci/Scrapling) layer |

Both produce the same output contract — jobs upserted to `api.peviitor.ro` — and
both target a Romanian company's own careers site + ANOFM.

## This is a template — fill in the placeholders

Every company-specific value in `config/`, `docs/`, `ai/` and the workflows is a
`{{PLACEHOLDER}}`. The unit tests pass with the placeholders in place (they use
their own generic fixtures); the live (integration / e2e) tests self-skip until
a real company is configured.

| Placeholder | Fill with |
|---|---|
| `{{COMPANY_NAME}}` | legal name, uppercase (e.g. `EXAMPLE COMPANY SRL`) |
| `{{COMPANY_BRAND}}` | commercial brand |
| `{{CIF}}` | fiscal code (CUI), no `RO` prefix |
| `{{WEBSITE_URL}}` | `https://www.example.com` |
| `{{CAREER_URL}}` | the open-positions listing page |
| `{{SITEMAP_URL}}` | the job sitemap URL (or `""` if there is none) |
| `{{JOB_URL_PREFIX}}` | canonical job-permalink prefix, e.g. `https://www.example.com/jobs/` |
| `{{DEFAULT_CITY}}` | HQ city (falls back to `România` in the transform) |
| `{{SELECTOR_JOB_ARTICLE}}` / `{{SELECTOR_JOB_TITLE}}` / `{{SELECTOR_JOB_META}}` | the site's primary CSS selectors (keep the generic fallbacks that follow) |
| `{{GITHUB_OWNER}}` / `{{GITHUB_REPO}}` | the derived repo's owner / name |

## The self-healing cascade

Every field on the listing page is extracted by trying strategies top to bottom
until one returns a non-empty value. Each step has its own `try/catch` — a
failing or rescued step is **logged immediately**, so a drifting site surfaces
in the run output, not two weeks later.

| Level | Strategy |
|---|---|
| 1 | Primary CSS selector (`config/scraper.json`) |
| 2 | Fallback CSS selectors |
| 3 | Structural anchoring — `[itemprop]`, `[aria-label]`, `<meta content>`, **JSON-LD `JobPosting`** |
| 4 | Regex on raw HTML (`<hN>` / `<a>`) — last resort |
| 5 *(Python, optional)* | **Scrapling** adaptive relocation (`adaptive=True, auto_save=True`) |

The article-level locator degrades the same way:
`css:<selector>` → `jsonld` → `regex:<article>` → `none` (canary fires).

If a whole run scrapes nothing (or nothing survives validation), the **canary**
raises *before* any file or API write — a 0-result run is almost always broken
markup, not a company with no jobs.

Generic, copy-verbatim modules:

| Concern | `scraper-js/` | `scraper-py/` |
|---|---|---|
| cascade primitive | `scraper/self-healing.js` — `firstMatch`, `locateArticles`, `jsonLdJobPostings` | `scraper/self_healing.py` — `first_match`, `locate_articles`, `json_ld_job_postings` |
| validation + canary | `scraper/validate.js` | `scraper/validate.py` |
| retry / backoff | `scraper/api.js` (`fetchWithRetry`) | `scraper/fetch.py` |

Full detail: [`scraper-js/ai/AGENTS.md`](scraper-js/ai/AGENTS.md) ·
[`scraper-py/ai/SELF-HEALING.md`](scraper-py/ai/SELF-HEALING.md) (has the
JS↔Python parity table and the Scrapling guide).

## Deriving a company scraper

1. Copy `scraper-js/` **or** `scraper-py/` into a new repo.
2. Find-and-replace every `{{PLACEHOLDER}}` (table above) across the folder.
3. In `config/scraper.json`, set the site's **primary** selectors; keep the
   generic fallbacks that follow them.
4. Adapt `parse.py` / `parseListing` in `index.js` to the site's shape, and add
   a test per new cascade level (see `tests/`).
5. `.github/workflows/` in the variant folder is what the derived repo runs at
   its own root.

## Running the template's own tests

```bash
# JS
cd scraper-js && npm install && npm run test:unit

# Python
cd scraper-py && pip install -e ".[dev]" && pytest -q
```

CI (`.github/workflows/ci.yml`) runs both on every push.

## License

MIT (see `scraper-js/LICENSE` / `scraper-py/LICENSE`).
