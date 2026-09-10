# job_seeker_ro_spider — GitHub Pages

This folder is published by GitHub Pages for a **derived** scraper. It shows the
company's current openings, pulled live from the peviitor API.

- `index.html` — the page. Reads `company.json` at runtime; falls back to the
  `{{...}}` constants near the top of its `<script>` if that file is missing.
- `company.json` — regenerated on every scrape by `scraper/index.js` (a copy of
  `scraper/config/company.json` plus `ownJobUrlPrefix`).
- `jobs.md` — generated on every scrape (company info + all current jobs).
- `test-results/` — HTML test reports pushed by CI.

Nothing here is edited by hand except `index.html`. When you derive a scraper,
replace the `{{PLACEHOLDER}}` values in `company.json` (or just fill in
`scraper/config/company.json` and let the first scrape regenerate this copy).
