# Contributing

Thank you for your interest in contributing!

## Development Setup

```bash
npm install
npm test
```

## Reporting Issues

Open a [GitHub Issue](https://github.com/TheTatu13/antibiotice-sa-nodejs-scraper/issues) with:
- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior

## Job Sources

This scraper extracts jobs from:
- [Antibiotice — pagina de carieră](https://www.antibiotice.ro/cariere/open-position/) (+ `https://www.antibiotice.ro/joburi-sitemap.xml`)
- ANOFM (by CIF 1973096)

If the careers page changes its DOM structure, the Cheerio selectors in `scraper/config/scraper.json` and the parsing in `scraper/index.js` may need updating.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.