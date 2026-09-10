import { jest } from '@jest/globals';

describe('index.js Component Tests', () => {
  let index;

  beforeAll(async () => {
    index = await import('../../scraper/index.js');
  });

  describe('slugify', () => {
    it('strips Romanian diacritics and lowercases', () => {
      expect(index.slugify('Key Account Manager – Vânzări Distribuitori'))
        .toBe('key-account-manager-vanzari-distribuitori');
    });

    it('collapses separators and trims dashes', () => {
      expect(index.slugify('  Operator   exploatare și mentenanță  '))
        .toBe('operator-exploatare-si-mentenanta');
    });
  });

  describe('parseDeadline', () => {
    it('converts a DD.MM.YYYY deadline to an end-of-day ISO string', () => {
      expect(index.parseDeadline('Data limita pentru aplicarea la acest job este: 30.09.2026'))
        .toBe('2026-09-30T23:59:59.000Z');
    });

    it('returns undefined when no date is present', () => {
      expect(index.parseDeadline('fără termen')).toBeUndefined();
    });
  });

  describe('matchSitemapUrl', () => {
    const sitemap = [
      { url: 'https://www.antibiotice.ro/joburi/specialist-marketing/', slug: 'specialist-marketing' },
      { url: 'https://www.antibiotice.ro/joburi/reprezentat-vanzari-biovet/', slug: 'reprezentat-vanzari-biovet' },
      { url: 'https://www.antibiotice.ro/joburi/operator-exploatare-si-mentenanta-2/', slug: 'operator-exploatare-si-mentenanta-2' }
    ];

    it('matches exact slugs', () => {
      expect(index.matchSitemapUrl('Specialist Marketing', sitemap))
        .toBe('https://www.antibiotice.ro/joburi/specialist-marketing/');
    });

    it('tolerates a trailing -2 disambiguation suffix', () => {
      expect(index.matchSitemapUrl('Operator exploatare și mentenanță', sitemap))
        .toBe('https://www.antibiotice.ro/joburi/operator-exploatare-si-mentenanta-2/');
    });

    it('tolerates a small typo in the sitemap slug (edit distance <= 2)', () => {
      expect(index.matchSitemapUrl('Reprezentant vânzări Biovet', sitemap))
        .toBe('https://www.antibiotice.ro/joburi/reprezentat-vanzari-biovet/');
    });

    it('returns null when nothing is close enough', () => {
      expect(index.matchSitemapUrl('Chief Astronaut Officer', sitemap)).toBeNull();
    });
  });

  describe('parseListing', () => {
    const html = `
      <main>
        <article class="job-item">
          <div class="header-job"><h3>Manager Medical &#8211; Produse veterinare </h3>
          <span class="readmorejob">Vezi detalii</span></div>
          <p>Data limita pentru aplicarea la acest job este: 30.09.2026</p>
          <div class="bullets"><p>descriere</p></div>
        </article>
        <article class="job-item">
          <div class="header-job"><h3>Servant pompier </h3>
          <span class="readmorejob">Vezi detalii</span></div>
          <p>fără termen anuntat</p>
          <div class="bullets"><p>descriere</p></div>
        </article>
      </main>`;

    it('extracts one item per article with a decoded, trimmed title', () => {
      const items = index.parseListing(html);
      expect(items).toHaveLength(2);
      expect(items[0].title).toBe('Manager Medical – Produse veterinare');
      expect(items[1].title).toBe('Servant pompier');
    });

    it('carries the deadline when present, undefined otherwise', () => {
      const items = index.parseListing(html);
      expect(items[0].expirationdate).toBe('2026-09-30T23:59:59.000Z');
      expect(items[1].expirationdate).toBeUndefined();
    });

    it('returns an empty array when the selector matches nothing', () => {
      expect(index.parseListing('<div>no jobs here</div>')).toEqual([]);
    });

    describe('self-healing when the primary markup breaks', () => {
      let logSpy, warnSpy;
      beforeEach(() => {
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      });
      afterEach(() => { logSpy.mockRestore(); warnSpy.mockRestore(); });

      it('recovers via a fallback article selector when the class is renamed', () => {
        // site swapped `article.job-item` -> `article.job-card` (still class*="job-")
        const html = `
          <article class="job-card">
            <div class="header-job"><h3>Analist Calitate</h3></div>
            <p>Data limita pentru aplicarea la acest job este: 15.11.2026</p>
          </article>`;
        const items = index.parseListing(html);
        expect(items).toHaveLength(1);
        expect(items[0].title).toBe('Analist Calitate');
        expect(items[0].expirationdate).toBe('2026-11-15T23:59:59.000Z');
      });

      it('recovers the title via a fallback heading selector when .header-job h3 is gone', () => {
        // site moved the title out of `.header-job` into a bare <h2>
        const html = `
          <article class="job-item">
            <header><h2>Operator Productie</h2></header>
            <div>Data limita pentru aplicarea la acest job este: 01.12.2026</div>
          </article>`;
        const items = index.parseListing(html);
        expect(items).toHaveLength(1);
        expect(items[0].title).toBe('Operator Productie');
        expect(items[0].expirationdate).toBe('2026-12-01T23:59:59.000Z');
      });

      it('recovers the title via the /joburi/ permalink anchor when all headings are gone', () => {
        const html = `
          <article class="job-item">
            <a href="https://www.antibiotice.ro/joburi/tehnician-mentenanta-electric/">Tehnician Mentenanta Electric</a>
            <p>fără termen</p>
          </article>`;
        const items = index.parseListing(html);
        expect(items).toHaveLength(1);
        expect(items[0].title).toBe('Tehnician Mentenanta Electric');
      });

      it('falls back to JSON-LD JobPosting when there is no article markup at all', () => {
        const html = `
          <html><head>
          <script type="application/ld+json">
          {"@type":"JobPosting","title":"Reprezentant Medical","validThrough":"2026-10-31"}
          </script>
          <script type="application/ld+json">
          {"@type":"JobPosting","title":"Product Manager Biovet"}
          </script>
          </head><body><div>markup the scraper doesn't know</div></body></html>`;
        const items = index.parseListing(html);
        expect(items.map(i => i.title).sort()).toEqual(['Product Manager Biovet', 'Reprezentant Medical']);
        expect(items.find(i => i.title === 'Reprezentant Medical').expirationdate)
          .toBe('2026-10-31T00:00:00.000Z');
      });

      it('falls back to regex <article> slicing when the container selectors all miss', () => {
        // container class unknown, but the <article> tag and an <h3> survive
        const html = `
          <section>
            <article data-role="posting"><h3>Servant Pompier</h3>
              <em>termen: 20.10.2026</em></article>
          </section>`;
        const items = index.parseListing(html);
        expect(items).toHaveLength(1);
        expect(items[0].title).toBe('Servant Pompier');
        expect(items[0].expirationdate).toBe('2026-10-20T23:59:59.000Z');
      });

      it('returns [] and does not throw when the page is unrecognisable (canary feeds off this)', () => {
        const items = index.parseListing('<body><nav>Home</nav><footer>©</footer></body>');
        expect(items).toEqual([]);
      });
    });
  });

  describe('transformJobsForSOLR', () => {
    it('should filter locations to only Romanian cities', () => {
      const payload = {
        jobs: [
          { url: 'https://test.com/1', title: 'Job 1', location: ['România'] },
          { url: 'https://test.com/2', title: 'Job 2', location: ['Bucharest'] },
          { url: 'https://test.com/3', title: 'Job 3', location: ['Bulgaria'] },
          { url: 'https://test.com/4', title: 'Job 4', location: ['Iași'] },
          { url: 'https://test.com/5', title: 'Job 5', location: [] }
        ]
      };

      const result = index.transformJobsForSOLR(payload);

      expect(result.jobs[0].location).toEqual(['România']);
      expect(result.jobs[1].location).toEqual(['Bucharest']);
      expect(result.jobs[2].location).toEqual(['România']);
      expect(result.jobs[3].location).toEqual(['Iași']);
      expect(result.jobs[4].location).toEqual(['România']);
    });

    it('should keep company uppercase', () => {
      const payload = {
        source: 'antibiotice.ro,anofm.ro',
        company: 'antibiotice sa',
        cif: '1973096',
        jobs: [{ url: 'https://test.com/1', title: 'Job 1', company: 'antibiotice sa', cif: '1973096' }]
      };

      const result = index.transformJobsForSOLR(payload);
      expect(result.company).toBe('ANTIBIOTICE SA');
    });

    it('should normalize workmode values', () => {
      const payload = {
        jobs: [
          { url: 'https://test.com/1', title: 'Job 1', workmode: 'Remote' },
          { url: 'https://test.com/2', title: 'Job 2', workmode: 'on-site' },
          { url: 'https://test.com/3', title: 'Job 3', workmode: 'Hybrid' }
        ]
      };

      const result = index.transformJobsForSOLR(payload);
      expect(result.jobs[0].workmode).toBe('remote');
      expect(result.jobs[1].workmode).toBe('on-site');
      expect(result.jobs[2].workmode).toBe('hybrid');
    });

    it('should preserve expirationdate through the transform', () => {
      const payload = {
        jobs: [{ url: 'https://test.com/1', title: 'Job 1', location: ['Iași'], expirationdate: '2026-09-30T23:59:59.000Z' }]
      };
      const result = index.transformJobsForSOLR(payload);
      expect(result.jobs[0].expirationdate).toBe('2026-09-30T23:59:59.000Z');
    });

    it('should handle empty jobs array', () => {
      const result = index.transformJobsForSOLR({ jobs: [] });
      expect(result.jobs).toEqual([]);
    });
  });

  describe('mapToJobModel', () => {
    it('should map a raw job to the job model format', () => {
      const rawJob = {
        url: 'https://www.antibiotice.ro/joburi/specialist-marketing/',
        title: 'Specialist Marketing',
        location: ['Iași'],
        workmode: 'on-site',
        expirationdate: '2026-09-30T23:59:59.000Z'
      };

      const result = index.mapToJobModel(rawJob, '1973096', 'ANTIBIOTICE SA');

      expect(result.url).toBe(rawJob.url);
      expect(result.title).toBe(rawJob.title);
      expect(result.company).toBe('ANTIBIOTICE SA');
      expect(result.cif).toBe('1973096');
      expect(result.location).toEqual(['Iași']);
      expect(result.workmode).toBe('on-site');
      expect(result.expirationdate).toBe('2026-09-30T23:59:59.000Z');
      expect(result.status).toBe('scraped');
      expect(result.date).toBeDefined();
    });

    it('should remove undefined fields', () => {
      const result = index.mapToJobModel({ url: 'https://test.com/1', title: 'Job 1' }, '1973096');
      expect(result.location).toBeUndefined();
      expect(result.tags).toBeUndefined();
      expect(result.workmode).toBeUndefined();
      expect(result.expirationdate).toBeUndefined();
    });
  });
});
