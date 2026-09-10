# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-09-07

### Added
- Repo derivat din template-ul [epam-systems-international-srl-nodejs-scraper](https://github.com/sebiboga/epam-systems-international-srl-nodejs-scraper) pentru **ANTIBIOTICE SA** (CIF: 1973096)
- Scraping HTTP + Cheerio pe site-ul oficial [antibiotice.ro/cariere](https://www.antibiotice.ro/cariere/open-position/), fără browser headless
- Reconcilierea titlurilor din listing cu permalink-urile canonice din `joburi-sitemap.xml` (potrivire exactă → prefix → distanță de editare mică, pentru drift-ul real din sitemap)
- `parseDeadline` — extrage `expirationdate` din textul „Data limita pentru aplicarea la acest job..."
- Scraping ANOFM prin `employer_tax_code`
- Degradare grațioasă: o sursă indisponibilă nu oprește scrape-ul; canary care abortează dacă toate sursele întorc 0 job-uri

### Changed
- `scraper/config/company.json`: identitate ANTIBIOTICE SA (brand Antibiotice, sediu Iași)
- `scraper/config/scraper.json`: surse `antibiotice.ro` (sitemap, listing, jobArchive) + selectori Cheerio
- `scraper/index.js`: `fetchJobsPage`/`parseApiJobs` (EPAM JSON API) → `scrapeAntibioticeCareers`/`fetchSitemapJobUrls`/`parseListing` (HTTP + Cheerio)
- Teste adaptate la noul CIF și la noile surse (unit, integration, e2e, consistency)
- `tests/validate-epam-jobs.js` → `tests/validate-antibiotice-jobs.js`

### Removed
- Dependența de Playwright / Chromium headless (site-ul oficial e server-rendered)
- Istoricul CHANGELOG din template (aparține template-ului EPAM)

## License

Copyright (c) 2026 TheTatu13
Licensed under MIT License