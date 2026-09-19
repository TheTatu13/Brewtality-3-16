import { jest } from '@jest/globals';
import fs from 'fs';

const mockFetch = jest.fn();

jest.unstable_mockModule('node-fetch', () => ({
  default: mockFetch
}));

const COMPANY_JSON_PATH = 'tmp/company.json';
const ROOT_COMPANY_JSON_PATH = 'company.json';

function backupFile(path) {
  if (fs.existsSync(path)) {
    fs.renameSync(path, `${path}.bak`);
  }
}

function restoreFile(path) {
  if (fs.existsSync(`${path}.bak`)) {
    fs.renameSync(`${path}.bak`, path);
  }
}

function clearAllCaches() {
  for (const p of [COMPANY_JSON_PATH, ROOT_COMPANY_JSON_PATH]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

function anafCompanyResponse(data) {
  return {
    ok: true,
    json: async () => ({ data, success: true })
  };
}

function peviitorResponse(companies) {
  return {
    ok: true,
    json: async () => ({ companies })
  };
}

function solrResponse(total, data) {
  return {
    ok: true,
    json: async () => ({ total, data })
  };
}

const EXAMPLE_ANAF_RECORD = {
  cui: 12345678,
  name: 'EXAMPLE COMPANY SRL',
  address: 'STR. EXAMPLE, NR.1, LOCALITATE',
  caenCode: '0000',
  inactive: false,
  vatRegistered: true,
  eFacturaRegistered: false,
  headquartersAddress: { locality: 'Iași' }
};

describe('company.js', () => {
  let company;

  beforeAll(async () => {
    fs.mkdirSync("tmp", { recursive: true });
    backupFile(COMPANY_JSON_PATH);
    backupFile(ROOT_COMPANY_JSON_PATH);
    company = await import('../../scraper/company.js');
  });

  afterAll(() => {
    restoreFile(COMPANY_JSON_PATH);
    restoreFile(ROOT_COMPANY_JSON_PATH);
  });

  beforeEach(() => {
    mockFetch.mockReset();
    clearAllCaches();
  });

  describe('getCompanyData (no cache)', () => {
    it('should fetch the company via direct CIF lookup and return company data', async () => {
      mockFetch.mockResolvedValueOnce(anafCompanyResponse(EXAMPLE_ANAF_RECORD));

      const result = await company.getCompanyData();

      expect(result).toHaveProperty('company', 'EXAMPLE COMPANY SRL');
      expect(result).toHaveProperty('cif', '12345678');
      expect(result).toHaveProperty('active', true);
      expect(result).toHaveProperty('anafData');
      expect(result.anafData.name).toBe('EXAMPLE COMPANY SRL');
    });

    it('should throw when ANAF returns no data', async () => {
      mockFetch.mockResolvedValueOnce(anafCompanyResponse(null));

      await expect(company.getCompanyData()).rejects.toThrow('No data from ANAF');
    });

    it('should throw when ANAF returns no company name', async () => {
      mockFetch.mockResolvedValueOnce(anafCompanyResponse({ cui: 12345678, name: null }));

      await expect(company.getCompanyData()).rejects.toThrow('ANAF returned no company name');
    });
  });

  describe('getCompanyData (with cache)', () => {
    const cachedData = {
      validatedAt: new Date().toISOString(),
      anaf: EXAMPLE_ANAF_RECORD,
      summary: {
        company: 'EXAMPLE COMPANY SRL',
        cif: '12345678',
        active: true
      }
    };

    beforeEach(() => {
      fs.writeFileSync(COMPANY_JSON_PATH, JSON.stringify(cachedData), 'utf-8');
    });

    it('should use cached company data when available', async () => {
      const result = await company.getCompanyData();

      expect(result.company).toBe('EXAMPLE COMPANY SRL');
      expect(result.cif).toBe('12345678');
      expect(result.active).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('validateAndGetCompany', () => {
    afterEach(() => {
      clearAllCaches();
    });

    it('should return company data with status active', async () => {
      mockFetch
        .mockResolvedValueOnce(anafCompanyResponse(EXAMPLE_ANAF_RECORD))
        .mockResolvedValueOnce(solrResponse(5, [
          { url: 'https://test.com/1', title: 'Job 1' },
          { url: 'https://test.com/2', title: 'Job 2' }
        ]))
        .mockResolvedValueOnce(peviitorResponse([{ company: 'EXAMPLE COMPANY SRL' }]));

      const result = await company.validateAndGetCompany();

      expect(result).toHaveProperty('status', 'active');
      expect(result).toHaveProperty('company', 'EXAMPLE COMPANY SRL');
      expect(result).toHaveProperty('cif', '12345678');
      expect(result).toHaveProperty('existingJobsCount');
      expect(typeof result.existingJobsCount).toBe('number');
    });

    it('should return inactive status when company is inactive', async () => {
      const inactiveRecord = { ...EXAMPLE_ANAF_RECORD, inactive: true };

      mockFetch
        .mockResolvedValueOnce(anafCompanyResponse(inactiveRecord))
        .mockResolvedValueOnce(solrResponse(0, []));

      const result = await company.validateAndGetCompany();

      expect(result).toHaveProperty('status', 'inactive');
    });

    it('deletes jobs by CIF when an inactive company still has jobs in SOLR', async () => {
      const inactiveRecord = { ...EXAMPLE_ANAF_RECORD, inactive: true };

      mockFetch
        .mockResolvedValueOnce(anafCompanyResponse(inactiveRecord))
        .mockResolvedValueOnce(solrResponse(3, []))
        .mockResolvedValueOnce(peviitorResponse([]))
        .mockResolvedValueOnce({ ok: true, json: async () => ({ count: 3 }) }); // deleteJobsByCIF

      const result = await company.validateAndGetCompany();

      expect(result.status).toBe('inactive');
      const deleteCall = mockFetch.mock.calls.find(([, opts]) => opts?.method === 'DELETE');
      expect(deleteCall).toBeDefined();
    });

    it('regression: dry_run=true must never call deleteJobsByCIF, even with jobs present', async () => {
      // Before this fix, validateAndGetCompany had no dryRun parameter at all --
      // an inactive company with existing jobs always fired a real, CIF-wide
      // DELETE against peviitor's live API, with no way for a caller to check
      // status safely first.
      const inactiveRecord = { ...EXAMPLE_ANAF_RECORD, inactive: true };

      mockFetch
        .mockResolvedValueOnce(anafCompanyResponse(inactiveRecord))
        .mockResolvedValueOnce(solrResponse(3, []));

      const result = await company.validateAndGetCompany(true);

      expect(result.status).toBe('inactive');
      const deleteCall = mockFetch.mock.calls.find(([, opts]) => opts?.method === 'DELETE');
      expect(deleteCall).toBeUndefined();
    });
  });
});
