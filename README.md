# Brewtality-3-16

Dual-language job-scraper **template** for [peviitor.ro](https://peviitor.ro),
with a real **self-healing selector cascade** and an extended test suite.

Two complete, parallel reference implementations — pick the language, copy the
folder into a new repo, edit `config/`:

| | |
|---|---|
| [`scraper-js/`](scraper-js/) | Node.js (ESM) · `node-fetch` + Cheerio · Jest · **130 tests** |
| [`scraper-py/`](scraper-py/) | Python 3.10+ · `requests` + BeautifulSoup · pytest · **53 tests** · optional [Scrapling](https://github.com/D4Vinci/Scrapling) layer |

Both target `antibiotice.ro/cariere` (ANTIBIOTICE SA, CIF 1973096) as the worked
example and produce the same output contract: jobs upserted to
`api.peviitor.ro`.

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
2. Edit `config/company.json` (or `scraper/config/company.json` for JS) — CIF,
   name, brand, URLs.
3. Edit `config/scraper.json` — the source URLs and the **selector cascades**
   (primary + 1–2 fallbacks per field).
4. Adapt `parse.py` / `parseListing` in `index.js` to the site's shape.
5. Add a test per new cascade level (see `tests/`).
6. `.github/workflows/` in the variant folder is what the derived repo runs at
   its root.

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
