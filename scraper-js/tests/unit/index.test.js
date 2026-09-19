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
      expect(index.parseDeadline('Apply by: 30.09.2026'))
        .toBe('2026-09-30T23:59:59.000Z');
    });

    it('returns undefined when no date is present', () => {
      expect(index.parseDeadline('fără termen')).toBeUndefined();
    });
  });

  describe('matchSitemapUrl', () => {
    const sitemap = [
      { url: 'https://jobs.example.com/careers/senior-widget-engineer/', slug: 'senior-widget-engineer' },
      { url: 'https://jobs.example.com/careers/field-sales-representative/', slug: 'field-sales-representative' },
      // real-world drift: a "-2" disambiguation suffix, and a "reprezentnt" typo
      { url: 'https://jobs.example.com/careers/night-shift-operator-2/', slug: 'night-shift-operator-2' },
      { url: 'https://jobs.example.com/careers/reprezentnt-medical/', slug: 'reprezentnt-medical' }
    ];

    it('matches exact slugs', () => {
      expect(index.matchSitemapUrl('Senior Widget Engineer', sitemap))
        .toBe('https://jobs.example.com/careers/senior-widget-engineer/');
    });

    it('tolerates a trailing -2 disambiguation suffix', () => {
      expect(index.matchSitemapUrl('Night Shift Operator', sitemap))
        .toBe('https://jobs.example.com/careers/night-shift-operator-2/');
    });

    it('tolerates a small typo in the sitemap slug (edit distance <= 2)', () => {
      expect(index.matchSitemapUrl('Reprezentant Medical', sitemap))
        .toBe('https://jobs.example.com/careers/reprezentnt-medical/');
    });

    it('returns null when nothing is close enough', () => {
      expect(index.matchSitemapUrl('Chief Astronaut Officer', sitemap)).toBeNull();
    });
  });

  describe('parseListing', () => {
    // A generic example selector cascade — the template's config/scraper.json
    // ships {{PLACEHOLDER}} selectors, so tests pass their own explicitly.
    const SEL = {
      jobArticle: ['.job', "[class*='job']", '.vacancy, .position, .listing-item'],
      jobTitle: ['.job__title', 'h1, h2, h3, h4', "[itemprop='title'], [aria-label]", 'a'],
      jobMeta: ['.job__meta', "p, .meta, [class*='deadline']"]
    };

    const html = `
      <main>
        <div class="job">
          <h3 class="job__title">Senior Widget Engineer &#8211; Platform </h3>
          <a class="more" href="/careers/jr1/senior-widget-engineer/">Read more</a>
          <p class="job__meta">Apply by: 30.09.2026</p>
          <div class="body"><p>description</p></div>
        </div>
        <div class="job">
          <h3 class="job__title">Night Shift Operator </h3>
          <a class="more" href="/careers/jr2/night-shift-operator/">Read more</a>
          <p class="job__meta">no deadline announced</p>
          <div class="body"><p>description</p></div>
        </div>
      </main>`;

    it('extracts one item per article with a decoded, trimmed title', () => {
      const items = index.parseListing(html, SEL);
      expect(items).toHaveLength(2);
      expect(items[0].title).toBe('Senior Widget Engineer – Platform');
      expect(items[1].title).toBe('Night Shift Operator');
    });

    it('carries the deadline when present, undefined otherwise', () => {
      const items = index.parseListing(html, SEL);
      expect(items[0].expirationdate).toBe('2026-09-30T23:59:59.000Z');
      expect(items[1].expirationdate).toBeUndefined();
    });

    it('carries the real scraped url, not a guessed slug', () => {
      // The real href (which may carry an ID a title-slug guess could never
      // reproduce, e.g. "/jobs/jr133930/software-architect/") must survive
      // parseListing untouched -- scrapeCareers resolves it against the
      // listing page, it does not fall back to guessing when this is present.
      const items = index.parseListing(html, SEL);
      expect(items[0].url).toBe('/careers/jr1/senior-widget-engineer/');
      expect(items[1].url).toBe('/careers/jr2/night-shift-operator/');
    });

    it('returns an empty array when the selector matches nothing', () => {
      expect(index.parseListing('<div>no jobs here</div>', SEL)).toEqual([]);
    });

    it('keeps two postings that share a title but have different URLs (dedup is title+URL, not title alone)', () => {
      // Real-world case: a company reposts the same role for two locations
      // ("Mecatronist" open in both Sighișoara and Sovata). This must not
      // collapse into one job — each has its own permalink.
      const html = `
        <div class="job">
          <h2 class="job__title">Mecatronist</h2>
          <a href="https://x/mecatronist-sighisoara/">apply</a>
        </div>
        <div class="job">
          <h2 class="job__title">Mecatronist</h2>
          <a href="https://x/mecatronist-sovata/">apply</a>
        </div>
      `;
      const items = index.parseListing(html, SEL);
      expect(items).toHaveLength(2);
      expect(items.map((i) => i.url).sort()).toEqual([
        'https://x/mecatronist-sighisoara/',
        'https://x/mecatronist-sovata/'
      ]);
    });

    it('still drops a true duplicate match (same title AND same URL) from an overly broad fallback selector', () => {
      const html = `
        <article class="job">
          <div class="job">
            <h2 class="job__title">Analyst</h2>
            <a href="https://x/analyst/">apply</a>
          </div>
        </article>
      `;
      // A selector broad enough to match both the outer and inner ".job" block
      // for the same posting must still collapse to one item.
      const items = index.parseListing(html, SEL);
      expect(items).toHaveLength(1);
    });

    it('skips an unconfigured {{PLACEHOLDER}} primary selector and uses a fallback', () => {
      // the template ships {{SELECTOR_JOB_ARTICLE}} — invalid CSS, must not crash;
      // the generic "[class*='job']" fallback in the shipped config still matches.
      const items = index.parseListing(html); // default = config/scraper.json
      expect(Array.isArray(items)).toBe(true);
      expect(items.map(i => i.title)).toContain('Senior Widget Engineer – Platform');
    });

    describe('self-healing when the primary markup breaks', () => {
      let logSpy, warnSpy;
      beforeEach(() => {
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      });
      afterEach(() => { logSpy.mockRestore(); warnSpy.mockRestore(); });

      it('recovers via a fallback article selector when the class is renamed', () => {
        // site swapped `.job` -> `.job-card` (still class*="job")
        const html = `
          <div class="job-card">
            <h3 class="job__title">QA Analyst</h3>
            <p class="job__meta">Apply by: 15.11.2026</p>
          </div>`;
        const items = index.parseListing(html, SEL);
        expect(items).toHaveLength(1);
        expect(items[0].title).toBe('QA Analyst');
        expect(items[0].expirationdate).toBe('2026-11-15T23:59:59.000Z');
      });

      it('recovers the title via a fallback heading selector when .job__title is gone', () => {
        const html = `
          <div class="job">
            <header><h2>Production Operator</h2></header>
            <div>Apply by: 01.12.2026</div>
          </div>`;
        const items = index.parseListing(html, SEL);
        expect(items).toHaveLength(1);
        expect(items[0].title).toBe('Production Operator');
        expect(items[0].expirationdate).toBe('2026-12-01T23:59:59.000Z');
      });

      it('recovers the title via the anchor text when all headings are gone', () => {
        const html = `
          <div class="job">
            <a href="https://jobs.example.com/careers/electrical-maintenance-technician/">Electrical Maintenance Technician</a>
            <p class="job__meta">no deadline</p>
          </div>`;
        const items = index.parseListing(html, SEL);
        expect(items).toHaveLength(1);
        expect(items[0].title).toBe('Electrical Maintenance Technician');
      });

      it('falls back to JSON-LD JobPosting when there is no article markup at all', () => {
        const html = `
          <html><head>
          <script type="application/ld+json">
          {"@type":"JobPosting","title":"Field Sales Representative","validThrough":"2026-10-31"}
          </script>
          <script type="application/ld+json">
          {"@type":"JobPosting","title":"Product Manager"}
          </script>
          </head><body><div>markup the scraper doesn't know</div></body></html>`;
        const items = index.parseListing(html, SEL);
        expect(items.map(i => i.title).sort()).toEqual(['Field Sales Representative', 'Product Manager']);
        expect(items.find(i => i.title === 'Field Sales Representative').expirationdate)
          .toBe('2026-10-31T00:00:00.000Z');
      });

      it('falls back to regex <article> slicing when the container selectors all miss', () => {
        // container class unknown, but the <article> tag and an <h3> survive
        const html = `
          <section>
            <article data-role="posting"><h3>Duty Firefighter</h3>
              <em>deadline: 20.10.2026</em></article>
          </section>`;
        const items = index.parseListing(html, SEL);
        expect(items).toHaveLength(1);
        expect(items[0].title).toBe('Duty Firefighter');
        expect(items[0].expirationdate).toBe('2026-10-20T23:59:59.000Z');
      });

      it('returns [] and does not throw when the page is unrecognisable (canary feeds off this)', () => {
        const items = index.parseListing('<body><nav>Home</nav><footer>©</footer></body>', SEL);
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
        source: 'careers.example.com,anofm.ro',
        company: 'example company srl',
        cif: '12345678',
        jobs: [{ url: 'https://test.com/1', title: 'Job 1', company: 'example company srl', cif: '12345678' }]
      };

      const result = index.transformJobsForSOLR(payload);
      expect(result.company).toBe('EXAMPLE COMPANY SRL');
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
        url: 'https://jobs.example.com/careers/widget-engineer/',
        title: 'Specialist Marketing',
        location: ['Iași'],
        workmode: 'on-site',
        expirationdate: '2026-09-30T23:59:59.000Z'
      };

      const result = index.mapToJobModel(rawJob, '12345678', 'EXAMPLE COMPANY SRL');

      expect(result.url).toBe(rawJob.url);
      expect(result.title).toBe(rawJob.title);
      expect(result.company).toBe('EXAMPLE COMPANY SRL');
      expect(result.cif).toBe('12345678');
      expect(result.location).toEqual(['Iași']);
      expect(result.workmode).toBe('on-site');
      expect(result.expirationdate).toBe('2026-09-30T23:59:59.000Z');
      expect(result.status).toBe('scraped');
      expect(result.date).toBeDefined();
    });

    it('should remove undefined fields', () => {
      const result = index.mapToJobModel({ url: 'https://test.com/1', title: 'Job 1' }, '12345678');
      expect(result.location).toBeUndefined();
      expect(result.tags).toBeUndefined();
      expect(result.workmode).toBeUndefined();
      expect(result.expirationdate).toBeUndefined();
    });
  });
});
