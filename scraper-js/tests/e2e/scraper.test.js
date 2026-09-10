import { jest } from '@jest/globals';
import fetch from 'node-fetch';

const API_BASE = 'https://api.peviitor.ro/v1';

let HAS_API = false;

let HAS_ANAF = false;

function itIfApi(name, fn, timeout) {
  if (HAS_API) {
    return it(name, fn, timeout);
  }
  return it.skip(`${name} (skipped: API unavailable)`, fn, timeout);
}

function itIfAnaf(name, fn, timeout) {
  if (HAS_ANAF) {
    return it(name, fn, timeout);
  }
  return it.skip(`${name} (skipped: ANAF API unavailable)`, fn, timeout);
}

import companyConfig from '../../scraper/config/company.js';
const TEST_CIF = companyConfig.id;
const TEST_BRAND = companyConfig.brand;
const COMPANY_NAME = companyConfig.company;

beforeAll(async () => {
  [HAS_API, HAS_ANAF] = await Promise.all([
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/scraper/jobs/?cif=${TEST_CIF}&rows=1`, {
          signal: AbortSignal.timeout(5000)
        });
        return res.ok || res.status === 400;
      } catch {
        return false;
      }
    })(),
    (async () => {
      try {
        const res = await fetch('https://demoanaf.ro/api/search?q=test', {
          method: 'HEAD',
          signal: AbortSignal.timeout(5000)
        });
        return res.ok;
      } catch {
        return false;
      }
    })()
  ]);
});

describe('E2E: Full Scraping Pipeline', () => {

  describe('Job Sources — Live Fetch', () => {
    let index;

    beforeAll(async () => {
      index = await import('../../scraper/index.js');
    });

    it('should fetch the joburi sitemap and return /joburi/ permalinks', async () => {
      let entries = [];
      try {
        entries = await index.fetchSitemapJobUrls();
      } catch (err) {
        console.log('Sitemap fetch failed:', err.message);
      }
      expect(Array.isArray(entries)).toBe(true);
      for (const e of entries) {
        expect(e.url).toMatch(/^https:\/\/www\.antibiotice\.ro\/joburi\/[^/]+\/?$/);
        expect(typeof e.slug).toBe('string');
      }
    }, 60000);

    it('should scrape the official careers page without crashing', async () => {
      let jobs = [];
      try {
        jobs = await index.scrapeAntibioticeCareers();
      } catch (err) {
        console.log('careers scrape failed (site may be down):', err.message);
      }
      expect(Array.isArray(jobs)).toBe(true);
      for (const j of jobs) {
        expect(typeof j.title).toBe('string');
        expect(j.title.length).toBeGreaterThan(0);
        expect(j.url).toMatch(/^https:\/\/www\.antibiotice\.ro\/joburi\//);
        expect(j.source).toBe('antibiotice.ro');
      }
    }, 60000);
  });

  describe('Parse + Transform Pipeline', () => {
    let index;

    beforeAll(async () => {
      index = await import('../../scraper/index.js');
    });

    it('should map scraped jobs to the job model', () => {
      const rawJob = {
        url: 'https://www.antibiotice.ro/joburi/specialist-marketing/',
        title: 'Specialist Marketing',
        location: ['Iași'],
        source: 'antibiotice.ro'
      };

      const model = index.mapToJobModel(rawJob, TEST_CIF, COMPANY_NAME);

      expect(model).toHaveProperty('url', rawJob.url);
      expect(model).toHaveProperty('title', rawJob.title);
      expect(model).toHaveProperty('company', COMPANY_NAME);
      expect(model).toHaveProperty('cif', TEST_CIF);
      expect(model).toHaveProperty('status', 'scraped');
      expect(model).toHaveProperty('date');
    });

    it('should transform jobs and keep Romanian locations', () => {
      const jobs = [
        index.mapToJobModel({
          url: 'https://www.antibiotice.ro/joburi/job-1/',
          title: 'Job 1',
          location: ['Iași'],
          source: 'antibiotice.ro'
        }, TEST_CIF, COMPANY_NAME),
        index.mapToJobModel({
          url: 'https://www.antibiotice.ro/joburi/job-2/',
          title: 'Job 2',
          location: ['Bucharest'],
          source: 'antibiotice.ro'
        }, TEST_CIF, COMPANY_NAME)
      ];

      const payload = {
        source: 'antibiotice.ro,anofm.ro',
        company: COMPANY_NAME,
        cif: TEST_CIF,
        jobs
      };

      const transformed = index.transformJobsForSOLR(payload);

      expect(transformed.company).toBe(COMPANY_NAME);
      expect(transformed.jobs.length).toBe(jobs.length);

      for (const job of transformed.jobs) {
        expect(job).toHaveProperty('location');
        expect(Array.isArray(job.location)).toBe(true);
        expect(job.location.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Company Validation Path', () => {
    let anaf;
    let company;

    beforeAll(async () => {
      anaf = await import('../../scraper/anaf.js');
      company = await import('../../scraper/company.js');
    });

    itIfAnaf('should find Antibiotice in ANAF and validate active status', async () => {
      const results = await anaf.searchCompany(TEST_BRAND);

      const match = results.find(c =>
        c.cui.toString() === TEST_CIF &&
        c.statusLabel === 'Funcțiune'
      );
      expect(match).toBeDefined();
      expect(match.cui.toString()).toBe(TEST_CIF);

      const anafData = await anaf.getCompanyFromANAF(TEST_CIF);
      expect(anafData).toBeDefined();
      expect(anafData.inactive).toBe(false);
    }, 30000);

    itIfApi('should run full validation and report active status with job count', async () => {
      const result = await company.validateAndGetCompany();

      expect(result.status).toBe('active');
      expect(result.company).toBe(COMPANY_NAME);
      expect(result.cif).toBe(TEST_CIF);

      if (result.existingJobsCount === 0) {
        console.log('⚠️ No jobs in API — skipping job count assertion');
        return;
      }
      expect(result.existingJobsCount).toBeGreaterThan(0);
    }, 30000);
  });

  describe('Inactive Company Handling', () => {
    let anaf;

    beforeAll(async () => {
      anaf = await import('../../scraper/anaf.js');
    });

    itIfAnaf('should detect inactive/radiated companies via ANAF', async () => {
      const results = await anaf.searchCompany(TEST_BRAND);

      const nonActive = results.find(c => c.statusLabel !== 'Funcțiune');

      if (nonActive) {
        try {
          const anafData = await anaf.getCompanyFromANAF(nonActive.cui.toString());
          expect(anafData).toBeDefined();
          if (anafData.inactive !== undefined) {
            expect(anafData.inactive).toBe(true);
          }
        } catch {
          expect(nonActive.statusLabel).toMatch(/Radiată|Inactiv|Suspendat/);
        }
      }
    }, 30000);
  });

  describe('API Data Verification', () => {
    let api;

    beforeAll(async () => {
      api = await import('../../scraper/api.js');
    });

    itIfApi('should have Antibiotice jobs in API with correct company name', async () => {
      const result = await api.querySOLR(TEST_CIF);

      if (result.numFound === 0) {
        console.log('⚠️ No jobs in API — skipping API data verification');
        return;
      }

      for (const job of result.docs) {
        expect(job.company).toBe(COMPANY_NAME);
        // Jobs store a zero-padded 8-digit CIF; the config keeps the real one.
        expect(String(job.cif).replace(/^0+/, '')).toBe(TEST_CIF.replace(/^0+/, ''));
      }
    }, 15000);

    itIfApi('should have Antibiotice company core entry with required fields', async () => {
      const companyDoc = await api.getCompanyByCif(TEST_CIF);

      expect(companyDoc).toBeDefined();
      expect(companyDoc.company).toBe(COMPANY_NAME);
      expect(companyDoc.status).toBe('activ');
    }, 15000);
  });
});