# CLAUDE.md

Brewtality-3-16 — dual-language peviitor.ro scraper template (`scraper-js/`, `scraper-py/`).

## Before any `git commit`

Run the tests for whichever variant(s) you touched, and say so in the response:

```bash
cd scraper-js && npm run test:unit           # + test:integration / test:e2e if network + logic changed
cd scraper-py && pytest -q
```

Show a `git diff --stat`. Flag before committing (and do not commit until confirmed):
- any failing test (name + short error);
- changes to `.github/`, `package.json` / `package-lock.json`, `pyproject.toml`,
  secrets/credentials, mass file deletions.

## Structure rules

- `scraper/self-healing.js` · `scraper/validate.js` (JS) and
  `scraper/self_healing.py` · `scraper/validate.py` · `scraper/fetch.py` (Py)
  are **generic** — no company/site knowledge. Keep them in step across the two
  variants; document any divergence in `ai/SELF-HEALING.md`.
- Only `config/*.json` and the `parse` layer are site-specific.
- Company identity is `{{PLACEHOLDER}}` everywhere. If you add a new one, add it
  to the `map` in **both** `setup.js` and `setup.py` and to the README table.
- The self-healing cascade and the canary must not be weakened. Add a test per
  new cascade level.
- Temp files in `tmp/` only.

## The derivation scripts

`setup.js` / `setup.py` (repo root) are functional mirrors — a change to one
must be made to the other. `ci.yml`'s `derive-smoke` job runs each on a
throwaway checkout and then the derived scraper's own tests, so a broken script
or a broken result fails CI.

## Note

`scraper-js/` and `scraper-py/` carry their own `.github/workflows/` — those are
what a *derived* company repo runs at its root. Only the root
`.github/workflows/ci.yml` runs for this template.
