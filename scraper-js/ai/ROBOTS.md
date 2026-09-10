# Robots.txt Analysis — antibiotice.ro

Sursa: https://www.antibiotice.ro/robots.txt

## Ce scrape-uim

| Cale | Rol |
|---|---|
| `https://www.antibiotice.ro/cariere/open-position/` | Listing-ul public al posturilor deschise (HTML server-rendered) |
| `https://www.antibiotice.ro/joburi-sitemap.xml` | Sitemap-ul cu permalink-urile canonice `/joburi/<slug>/` |
| `https://www.antibiotice.ro/joburi/<slug>/` | Paginile individuale de job (doar referite, nu crawl-uite integral) |

## Interpretare

Site-ul oficial al companiei publică sitemap-ul de job-uri explicit pentru
indexare. Pagina de carieră și sitemap-ul sunt conținut public, destinat
candidaților. Nu există zonă de autentificare implicată.

## Politețe

Scraper-ul este intenționat lent și minimal:

| Măsură | Valoare | Unde |
|---|---|---|
| Request-uri | secvențiale, 1 la un moment dat | `scraper/index.js` (fără `Promise.all` pe fetch-uri) |
| Delay între pagini | `pageDelayMs` (1000 ms) | `scraper/config/scraper.json` |
| Timeout | `requestTimeoutMs` (10000 ms) | `scraper/config/scraper.json` |
| User-Agent | `job_seeker_ro_spider` | identifică scraper-ul în log-urile serverului |
| Volum | 2 request-uri pe site (listing + sitemap) + ANOFM | — |

Nu se descarcă asset-uri, nu se randează JS, nu se urmăresc link-uri în afara
`/joburi/`.

## Diferență față de template-ul EPAM

Template-ul EPAM scrape-uia `careers.epam.com` printr-un API JSON. Aici sursa
principală este site-ul oficial al companiei (`antibiotice.ro`), server-rendered,
citit cu HTTP + Cheerio — fără browser headless, fără Playwright.
