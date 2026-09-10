# Brewtality-3-16

Dual-language job-scraper **template** for [peviitor.ro](https://peviitor.ro),
with a real **self-healing selector cascade** and an extended test suite.

Two complete, parallel reference implementations. Clone it and run
**`node setup.js`** (or **`python setup.py`**) — one interactive script picks a
language, asks for the company details, and turns the clone into a
ready-to-commit scraper. Details in
[Deriving a company scraper](#deriving-a-company-scraper).

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

### The interactive way (recommended)

```bash
git clone https://github.com/{owner}/Brewtality-3-16.git my-company-scraper
cd my-company-scraper
node setup.js       # …or:  python setup.py   — pick whichever you have
```

Either script does the same thing. It asks:

1. **JavaScript or Python?** — type `js` / `py` (or `1` / `2`).
2. Then, one prompt at a time: the company legal name, brand, CIF, website,
   careers-page URL, job sitemap URL (optional), job-permalink prefix, HQ city,
   the three primary CSS selectors (optional — Enter to keep only the generic
   fallbacks), and the GitHub owner / repo name.
3. It prints a **summary** and asks for confirmation.

On confirm it rewrites the clone **in place**:

- deletes the language folder you didn't pick;
- promotes the one you did pick to the repo root;
- fills every `{{PLACEHOLDER}}` with your answers;
- sets the package/module name to `<company-slug>-scraper`
  (`package.json` / `pyproject.toml`);
- deletes both `setup.*` scripts and the template's `.git` history.

At the end it prints exactly what's left to do:

```
OK - scraper generated for ACME WIDGETS SRL in JavaScript.
  package/module name: acme-widgets-scraper
  intended repo:       github.com/acme-dev/acme-widgets-nodejs-scraper

Ready for the first commit:
  git init && git add -A && git commit -m "Initial scraper for ACME WIDGETS SRL"
  gh repo create acme-dev/acme-widgets-nodejs-scraper --public --source=. --push

Next: tune the selectors in scraper/config/scraper.json
      and adapt parseListing in scraper/index.js,
      then run the tests (npm install && npm run test:unit).
```

The unit tests pass immediately after derivation (they use their own generic
fixtures); the live tests self-skip until the company details resolve.

### By hand

1. Copy `scraper-js/` **or** `scraper-py/` into a new repo.
2. Find-and-replace every `{{PLACEHOLDER}}` (table above) across the folder;
   set `name` in `package.json` / `pyproject.toml`.
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
