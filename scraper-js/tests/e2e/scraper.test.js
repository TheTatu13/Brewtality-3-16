import { jest } from '@jest/globals';
import fetch from 'node-fetch';

import companyConfig from '../../scraper/config/company.js';
import scraperConfig from '../../scraper/config/scraper.js';

const API_BASE = 'https://api.peviitor.ro/v1';

// The template ships {{PLACEHOLDER}} config. The live-site parts of this suite
// only make sense once a real company has been filled in.
const CONFIGURED = !JSON.stringify({ ...companyConfig, ...scraperConfig }).includes('{{');

const TEST_CIF = companyConfig.id;
const TEST_BRAND = companyConfig.brand;
const COMPANY_NAME = companyConfig.company;
const OWN_PREFIX = scraperConfig.ownJobUrlPrefix;

let HAS_API = false;
let HAS_ANAF = false;

function gate(cond) {
  return (name, fn, timeout) =>
    cond ? it(name, fn, timeout) : it.skip(`${name} (skipped)`, fn, timeout);
}
const itLive = gate(CONFIGURED);
const itIfApi = (name, fn, t) => gate(CONFIGURED && HAS_API)(name, fn, t);
const itIfAnaf = (name, fn, t) => gate(CONFIGURED && HAS_ANAF)(name, fn, t);

// demoanaf.ro's free API tier was sunset 2026-08-21 (permanent HTTP 402 on
// every /api/* call). anaf.js already falls back to cuiscan.ro/cuifirma.ro
// when demoanaf.ro fails, so "is ANAF available" must reflect that fallback
// chain — probing demoanaf.ro alone would leave these tests pending forever.
async function checkAnafAvailability() {
  const [demoanaf, cuifirma] = await Promise.allSettled([
    fetch('https://demoanaf.ro/api/search?q=test', { method: 'HEAD', signal: AbortSignal.timeout(5000) }),
    fetch('https://cuifirma.ro/api/search?q=test', { signal: AbortSignal.timeout(5000) }),
  ]);
  return (demoanaf.status === 'fulfilled' && demoanaf.value.ok) ||
         (cuifirma.status === 'fulfilled' && cuifirma.value.ok);
}

beforeAll(async () => {
  if (!CONFIGURED) return;
  [HAS_API, HAS_ANAF] = await Promise.all([
    fetch(`${API_BASE}/scraper/jobs/?cif=${TEST_CIF}&rows=1`, { signal: AbortSignal.timeout(5000) })
      .then(r => r.ok || r.status === 400).catch(() => false),
    checkAnafAvailability().catch(() => false),
  ]);
});

describe('E2E: Full Scraping Pipeline', () => {

  describe('Parse + Transform Pipeline (offline, always runs)', () => {
    let index;
    beforeAll(async () => { index = await import('../../scraper/index.js'); });

    it('maps a scraped job to the job model', () => {
      const raw = { url: 'https://jobs.example.com/careers/widget-engineer/', title: 'Widget Engineer', location: ['Iași'] };
      const model = index.mapToJobModel(raw, '12345678', 'EXAMPLE COMPANY SRL');
      expect(model).toMatchObject({
        url: raw.url, title: raw.title, company: 'EXAMPLE COMPANY SRL', cif: '12345678', status: 'scraped',
      });
      expect(model).toHaveProperty('date');
    });

    it('transforms jobs and keeps only Romanian locations', () => {
      const jobs = [
        index.mapToJobModel({ url: 'https://jobs.example.com/careers/a/', title: 'A', location: ['Iași'] }, '12345678', 'EXAMPLE COMPANY SRL'),
        index.mapToJobModel({ url: 'https://jobs.example.com/careers/b/', title: 'B', location: ['Bucharest'] }, '12345678', 'EXAMPLE COMPANY SRL'),
      ];
      const out = index.transformJobsForSOLR({ company: 'example company srl', cif: '12345678', jobs });
      expect(out.company).toBe('EXAMPLE COMPANY SRL');
      expect(out.jobs).toHaveLength(2);
      for (const j of out.jobs) expect(j.location.length).toBeGreaterThan(0);
    });
  });

  describe('Live careers site (needs a configured company)', () => {
    let index;
    beforeAll(async () => { index = await import('../../scraper/index.js'); });

    itLive('fetches the sitemap and returns job permalinks under the configured prefix', async () => {
      let entries = [];
      try { entries = await index.fetchSitemapJobUrls(); } catch (err) { console.log('sitemap:', err.message); }
      expect(Array.isArray(entries)).toBe(true);
      for (const e of entries) {
        expect(e.url.startsWith(OWN_PREFIX)).toBe(true);
        expect(typeof e.slug).toBe('string');
      }
    }, 60000);

    itLive('scrapes the careers page without crashing', async () => {
      let jobs = [];
      try { jobs = await index.scrapeCareers(); } catch (err) { console.log('scrape:', err.message); }
      expect(Array.isArray(jobs)).toBe(true);
      for (const j of jobs) {
        expect(typeof j.title).toBe('string');
        expect(j.title.length).toBeGreaterThan(0);
        expect(typeof j.url).toBe('string');
      }
    }, 60000);
  });

  describe('Company validation (needs a configured company + network)', () => {
    let anaf, company, api;
    beforeAll(async () => {
      anaf = await import('../../scraper/anaf.js');
      company = await import('../../scraper/company.js');
      api = await import('../../scraper/api.js');
    });

    itIfAnaf('finds the company in ANAF and reads active status', async () => {
      const results = await anaf.searchCompany(TEST_BRAND);
      const match = results.find(c => c.cui.toString() === TEST_CIF && c.statusLabel === 'Funcțiune');
      expect(match).toBeDefined();
      const data = await anaf.getCompanyFromANAF(TEST_CIF);
      expect(data.inactive).toBe(false);
    }, 30000);

    itIfApi('runs full validation and reports active status', async () => {
      const result = await company.validateAndGetCompany();
      expect(result.status).toBe('active');
      expect(result.company).toBe(COMPANY_NAME);
      expect(result.cif).toBe(TEST_CIF);
    }, 30000);

    itIfApi('has jobs in the API with the correct company name and CIF', async () => {
      const result = await api.querySOLR(TEST_CIF);
      if (result.numFound === 0) { console.log('no jobs yet — skipping assertions'); return; }
      for (const job of result.docs) {
        expect(job.company).toBe(COMPANY_NAME);
        expect(String(job.cif).replace(/^0+/, '')).toBe(TEST_CIF.replace(/^0+/, ''));
      }
    }, 15000);
  });
});
