# Contributing

Thank you for your interest in contributing!

## Development Setup

```bash
npm install
npm test
```

## Reporting Issues

Open a [GitHub Issue](https://github.com/{{GITHUB_OWNER}}/{{GITHUB_REPO}}/issues) with:
- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior

## Job Sources

A derived scraper extracts jobs from:
- the company's own careers listing (`{{CAREER_URL}}`) + its job sitemap (`{{SITEMAP_URL}}`)
- ANOFM (by CIF)

If the careers page changes its DOM structure, update the **selector cascades** in
`scraper/config/scraper.json` (primary + fallbacks) — the self-healing cascade in
`scraper/self-healing.js` and the tests in `tests/unit/` mean one broken selector
should not fail a run. Add a test per new fallback level.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.