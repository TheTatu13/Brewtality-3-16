import { jest } from '@jest/globals';

// dropDeadUrls' only dependency is validateByContent -- mock it here, in its
// own file, so index.js's dynamic import gets the mocked module without
// disturbing index.test.js's own (unmocked) import of the same file.
const mockValidateByContent = jest.fn();

jest.unstable_mockModule('../../scraper/job-validator.js', () => ({
  validateByContent: mockValidateByContent
}));

describe('dropDeadUrls', () => {
  let index;

  beforeAll(async () => {
    index = await import('../../scraper/index.js');
  });

  beforeEach(() => {
    mockValidateByContent.mockReset();
  });

  it('keeps active jobs and drops expired or erroring ones', async () => {
    mockValidateByContent.mockImplementation(async (url) => {
      const status = url.includes('good') ? 'active' : 'expired';
      return { url, status, httpStatus: status === 'active' ? 200 : 404, title: null, error: null };
    });

    const jobs = [
      { url: 'https://x/good/', title: 'Good' },
      { url: 'https://x/bad/', title: 'Bad' }
    ];
    const kept = await index.dropDeadUrls(jobs);

    expect(kept.map(j => j.title)).toEqual(['Good']);
  });

  it('returns an empty array when every job fails live validation', async () => {
    mockValidateByContent.mockResolvedValue({
      url: 'x', status: 'expired', httpStatus: 404, title: null, error: null
    });

    const kept = await index.dropDeadUrls([{ url: 'https://x/1/', title: 'One' }]);

    expect(kept).toEqual([]);
  });
});
