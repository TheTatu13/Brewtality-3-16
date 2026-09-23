import { jest } from '@jest/globals';

const mockFetch = jest.fn();

jest.unstable_mockModule('node-fetch', () => ({
  default: mockFetch
}));

function makeJsonResponse(body) {
  return {
    ok: true,
    json: async () => body
  };
}

function makeErrorResponse(status, text) {
  return {
    ok: false,
    status,
    text: async () => text
  };
}

describe('scraper/api.js', () => {
  let solr;

  beforeAll(async () => {
    solr = await import('../../scraper/api.js');
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('querySOLR', () => {
    it('should return response object with docs', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({
        total: 2,
        data: [
          { id: 'job1', url: 'https://test.com/1', cif: '39176747' },
          { id: 'job2', url: 'https://test.com/2', cif: '39176747' }
        ]
      }));

      const result = await solr.querySOLR('39176747');

      expect(result).toHaveProperty('numFound', 2);
      expect(result).toHaveProperty('docs');
      expect(Array.isArray(result.docs)).toBe(true);
      expect(result.docs).toHaveLength(2);
    });

    it('should return empty docs when no jobs found', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({ total: 0, data: [] }));

      const result = await solr.querySOLR('99999999');

      expect(result.numFound).toBe(0);
      expect(result.docs).toEqual([]);
    });

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(500, 'Internal Server Error'));

      await expect(solr.querySOLR('39176747')).rejects.toThrow('API jobs query error: 500');
    });

    it('should retry a transient 503 and then succeed', async () => {
      mockFetch
        .mockResolvedValueOnce(makeErrorResponse(503, 'Service Unavailable'))
        .mockResolvedValueOnce(makeJsonResponse({ total: 1, data: [{ url: 'https://test.com/1', cif: '39176747' }] }));

      const result = await solr.querySOLR('39176747');

      expect(result.numFound).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should not retry a 4xx response', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(404, 'Not Found'));

      await expect(solr.querySOLR('39176747')).rejects.toThrow('API jobs query error: 404');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('upsertJobs', () => {
    it('should accept array of jobs', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({ count: 1 }));

      const testJob = {
        url: 'https://test.com/job1',
        title: 'Test Job',
        company: 'TEST COMPANY',
        cif: '12345678',
        status: 'scraped'
      };

      await expect(solr.upsertJobs([testJob])).resolves.not.toThrow();
    });

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(400, 'Bad Request'));

      await expect(solr.upsertJobs([{ url: 'https://test.com/bad' }])).rejects.toThrow('API jobs upload error: 400');
    });

    it('should retry a transient 502 and then succeed', async () => {
      mockFetch
        .mockResolvedValueOnce(makeErrorResponse(502, 'Bad Gateway'))
        .mockResolvedValueOnce(makeJsonResponse({ count: 1 }));

      await expect(solr.upsertJobs([{ url: 'https://test.com/job1', cif: '12345678' }])).resolves.not.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('deleteJobByUrl', () => {
    it('should delete a job by URL', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({ success: true }));

      await expect(solr.deleteJobByUrl('https://test.com/old-job')).resolves.not.toThrow();
    });

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(500, 'Error'));

      await expect(solr.deleteJobByUrl('https://test.com/bad')).rejects.toThrow('API jobs delete error: 500');
    });
  });

  describe('deleteJobsByCIF', () => {
    it('should delete all jobs for a CIF', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({ count: 3 }));

      await expect(solr.deleteJobsByCIF('39176747')).resolves.not.toThrow();
    });

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(500, 'Error'));

      await expect(solr.deleteJobsByCIF('39176747')).rejects.toThrow('API jobs delete error: 500');
    });
  });

  // Regression tests for the CIF zero-padding bug family: several derived
  // scrapers historically produced duplicate company-core records because a
  // stale copy of api.js sent an unpadded CIF while other call sites (or the
  // company-core CI job) used the padded 8-digit form as the key. padCif()
  // itself is not exported, so these assert on the actual outgoing request
  // (URL query param or JSON body) for every call site that touches a CIF —
  // a change that silently drops the padding again would fail here instead
  // of shipping a new duplicate.
  describe('CIF zero-padding (regression)', () => {
    const SHORT_CIF = '176747'; // 6 digits — a real CIF shorter than 8 digits
    const PADDED_CIF = '00176747';

    it('getCompanyByCif pads the CIF in the query string', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({ success: true, data: [] }));

      await solr.getCompanyByCif(SHORT_CIF);

      const [calledUrl] = mockFetch.mock.calls[0];
      expect(calledUrl).toContain(`cif=${PADDED_CIF}`);
      expect(calledUrl).not.toContain(`cif=${SHORT_CIF}&`);
      expect(calledUrl.endsWith(`cif=${SHORT_CIF}`)).toBe(false);
    });

    it('querySOLR pads the CIF in the query string', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({ total: 0, data: [] }));

      await solr.querySOLR(SHORT_CIF);

      const [calledUrl] = mockFetch.mock.calls[0];
      expect(calledUrl).toContain(`cif=${PADDED_CIF}`);
    });

    it('upsertCompany pads the id field in the request body', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({ success: true }));

      await solr.upsertCompany({ id: SHORT_CIF, company: 'TEST COMPANY' });

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.id).toBe(PADDED_CIF);
    });

    it('deleteJobsByCIF pads the cif field in the request body', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({ count: 0 }));

      await solr.deleteJobsByCIF(SHORT_CIF);

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.cif).toBe(PADDED_CIF);
    });

    it('upsertJobs pads every job\'s cif field in the request body', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({ count: 2 }));

      await solr.upsertJobs([
        { url: 'https://test.com/1', cif: SHORT_CIF },
        { url: 'https://test.com/2', cif: SHORT_CIF },
      ]);

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body).toHaveLength(2);
      for (const job of body) {
        expect(job.cif).toBe(PADDED_CIF);
      }
    });

    it('already-padded CIFs pass through unchanged (idempotent)', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({ total: 0, data: [] }));

      await solr.querySOLR(PADDED_CIF);

      const [calledUrl] = mockFetch.mock.calls[0];
      expect(calledUrl).toContain(`cif=${PADDED_CIF}`);
    });
  });

  describe('Data Integrity', () => {
    it('should not have duplicate URLs for same CIF', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({
        total: 2,
        data: [
          { url: 'https://test.com/job1', title: 'Job 1', cif: '39176747' },
          { url: 'https://test.com/job2', title: 'Job 2', cif: '39176747' }
        ]
      }));

      const result = await solr.querySOLR('39176747');
      const urls = result.docs.map(j => j.url);
      const uniqueUrls = new Set(urls);

      expect(uniqueUrls.size).toBe(result.numFound);
    });

    it('should have valid CIF format for all jobs', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({
        total: 2,
        data: [
          { url: 'https://test.com/1', title: 'Job 1', cif: '39176747' },
          { url: 'https://test.com/2', title: 'Job 2', cif: '12345678' }
        ]
      }));

      const result = await solr.querySOLR('39176747');

      for (const job of result.docs) {
        expect(job.cif).toMatch(/^\d{6,9}$/);
      }
    });

    it('should detect invalid CIF format', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({
        total: 1,
        data: [
          { url: 'https://test.com/1', title: 'Job 1', cif: 'abc' }
        ]
      }));

      const result = await solr.querySOLR('abc');

      for (const job of result.docs) {
        expect(job.cif).not.toMatch(/^\d{6,9}$/);
      }
    });

    it('should have valid status values', async () => {
      const validStatuses = ['scraped', 'tested', 'verified', 'published'];

      mockFetch.mockResolvedValue(makeJsonResponse({
        total: 3,
        data: [
          { url: 'https://test.com/1', title: 'Job 1', cif: '39176747', status: 'scraped' },
          { url: 'https://test.com/2', title: 'Job 2', cif: '39176747', status: 'verified' },
          { url: 'https://test.com/3', title: 'Job 3', cif: '39176747', status: 'published' }
        ]
      }));

      const result = await solr.querySOLR('39176747');

      for (const job of result.docs) {
        expect(validStatuses).toContain(job.status);
      }
    });
  });
});
