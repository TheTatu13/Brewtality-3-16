# Scraper registry

Point-in-time snapshot of every scraper derived from this template, as of
**2026-09-23**. Not a live query — see `ai/VERSIONING.md` for how to check
what's actually pinned in a given repo if this drifts. Regenerate by hand
(or from `company.json`/`tmp/company.json` + each repo's caller workflow
files) whenever a new scraper is derived or a repo's status changes.

| Company | Brand | CIF | Repo | Language | Template version | Status |
|---|---|---|---|---|---|---|
| ANTIBIOTICE SA | Antibiotice | 1973096 | [antibiotice-sa-nodejs-scraper](https://github.com/TheTatu13/antibiotice-sa-nodejs-scraper) | Node.js | `@v1` | active |
| AEROSTAR SA | AEROSTAR | 950531 | [aerostar-sa-nodejs-scraper](https://github.com/TheTatu13/aerostar-sa-nodejs-scraper) | Node.js | `@v1` | active |
| TURBOMECANICA SA | Turbomecanica | 3156315 | [turbomecanica-sa-nodejs-scraper](https://github.com/TheTatu13/turbomecanica-sa-nodejs-scraper) | Node.js | `@v1` | active |
| CEMACON S.A. | Cemacon | 677858 | [cemacon-sa-nodejs-scraper](https://github.com/TheTatu13/cemacon-sa-nodejs-scraper) | Node.js | `@v1` | active |
| CRAMELE COTNARI S.A. | Cotnari | 40321026 | [cramele-cotnari-sa-nodejs-scraper](https://github.com/TheTatu13/cramele-cotnari-sa-nodejs-scraper) | Node.js | `@v1` | active |
| HOCHLAND ROMANIA SRL | Hochland | 10666988 | [hochland-romania-nodejs-scraper](https://github.com/TheTatu13/hochland-romania-nodejs-scraper) | Node.js | `@v1` | active — README still shows unmodified template boilerplate, see note below |
| VALROM INDUSTRIE SRL | Valrom | 8529679 | [valrom-industrie-python-scraper](https://github.com/TheTatu13/valrom-industrie-python-scraper) | Python | `@v1` | active |
| BETFAIR ROMANIA DEVELOPMENT SRL | Betfair | 22201773 | [betfair-scraper-py](https://github.com/TheTatu13/betfair-scraper-py) | Python | `@v1` | active |
| CRIS-TIM FAMILY HOLDING S.A. | Cris-Tim | 13533870 | [cris-tim-python-scraper](https://github.com/TheTatu13/cris-tim-python-scraper) | Python | `@v1` | active |
| KRONOSPAN SEBES SA | Kronospan | 11358544 | [kronospan-sebes-python-scraper](https://github.com/TheTatu13/kronospan-sebes-python-scraper) | Python | `@v1` | active |

All 10 repos above: branch protection (anti-accident: no force-push, no
branch deletion, direct push to `main` still allowed) applied; weekly
health-summary reusable workflow, template-sync-check, and
`COMMIT_CHECKLIST.md` all present and pushed.

## Also part of the fleet, archived (read-only)

These two were discovered mid-audit and confirmed to belong to the same
"zero bugs" scope, but are archived on GitHub (pushes rejected with 403)
so no fixes were pushed to them — findings only, left as-is per an
explicit decision to leave archived repos alone.

| Company | Repo | Language | Notes |
|---|---|---|---|
| — (already on the newer reusable-workflow architecture) | [peviitor-scraper-py](https://github.com/TheTatu13/peviitor-scraper-py) | Python | Audited clean — CIF-padding already applied everywhere, full regression coverage. Archived, so the dead template-sync-check mechanism (same bug as the other 10, before their fix) was never pushed. |
| — | [teraplast-romania-python-scraper](https://github.com/TheTatu13/teraplast-romania-python-scraper) | Python | **Two real bugs found, fix written but not pushed (archived):** (1) the scheduled `scrape.yml` run's dry-run gate never evaluated true on a `schedule` trigger, so this scraper had never written real data since creation; (2) missing `permissions: contents: write` + the docs-push-back step. If this repo is ever unarchived, re-apply the fix (ported 1:1 from `peviitor-scraper-py`'s working `scrape.yml`) before resuming its schedule. |

## Known non-blocking issue

`hochland-romania-nodejs-scraper`'s root `README.md` is still the raw,
unmodified template README (English boilerplate, "This is a template"
banner, one literal `{{...}}`-style leftover in prose) instead of the
company-specific README the other 9 repos have. Cosmetic only — it
doesn't affect CI, tests, or the scrape pipeline — but worth a manual
rewrite next time that repo is touched.
