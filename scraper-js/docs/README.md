# job_seeker_ro_spider

**job_seeker_ro_spider** — scraper pentru job-urile ANTIBIOTICE SA din România.

Extrage anunțurile de pe [pagina de carieră Antibiotice](https://www.antibiotice.ro/cariere/open-position/) și de pe [ANOFM](https://mediere.anofm.ro) și le publică în [peviitor.ro](https://peviitor.ro) prin API-ul Peviitor.

> **🌱 Repo derivat.** Acest repo este derivat din template-ul [epam-systems-international-srl-nodejs-scraper](https://github.com/sebiboga/epam-systems-international-srl-nodejs-scraper).

## Identificare

Toate request-urile HTTP folosesc User-Agent-ul:

```
job_seeker_ro_spider
```

## Ce face

1. **Validează compania** — interoghează API-ul public ANAF ([demoanaf.ro](https://demoanaf.ro)) după CIF-ul (1973096) și verifică:
   - Denumirea oficială: ANTIBIOTICE SA
   - Status: activ/inactiv/radiat
   - Adresa completă din registrul comerțului
2. **Cross-validează cu Peviitor** — verifică existența companiei în API-ul Peviitor
3. **Scrape-uiește job-urile** — extrage lista de pe `antibiotice.ro/cariere/open-position/` (HTTP + Cheerio), reconciliază titlurile cu permalink-urile din `joburi-sitemap.xml` și adaugă job-urile ANOFM (după CIF)
4. **Transformă datele** — normalizează locațiile (doar orașe românești), tag-urile (lowercase), workmode-ul (remote/on-site/hybrid)
5. **Stochează în Peviitor** — upsert prin API-ul Peviitor (job-uri și date companie)
6. **Generează jobs.md** — fișier markdown cu informații companie + toate job-urile curente

## API-uri folosite

| Sursă | URL | Autentificare |
|---|---|---|
| Antibiotice — listing | `https://www.antibiotice.ro/cariere/open-position/` | Public |
| Antibiotice — sitemap | `https://www.antibiotice.ro/joburi-sitemap.xml` | Public |
| ANOFM | `https://mediere.anofm.ro/api/entity/vw_public_job_posting` | Public |
| ANAF (demoanaf) | `https://demoanaf.ro/api/...` | Public |
| Peviitor | `https://api.peviitor.ro/v1/company/` | Public |

## Robots.txt

Site-ul oficial `antibiotice.ro` este scrape-uit politicos: request-uri secvențiale (o pagină la un moment dat), delay între request-uri, fără autentificare, User-Agent identificabil. Se citesc doar pagina publică de carieră și sitemap-ul public.

Pentru analiza completă, vezi [ai/ROBOTS.md](../ai/ROBOTS.md).

## Testare

```bash
# Toate testele
npm test

# Doar unitare
npm run test:unit

# Doar integrare (necesită ANAF live, Peviitor API conditional)
npm run test:integration

# Doar E2E (antibiotice.ro real + ANAF + Peviitor)
npm run test:e2e
```

Testele Peviitor API folosesc `itIfApi` — se auto-skip dacă API-ul Peviitor nu e disponibil.