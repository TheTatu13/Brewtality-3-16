import { jest } from "@jest/globals";
import { validateJob, filterValidJobs, assertScrapeYieldedJobs } from "../../scraper/validate.js";

const goodJob = {
  url: "https://www.antibiotice.ro/joburi/specialist-marketing/",
  title: "Specialist Marketing",
  location: ["Iași"]
};

describe("validateJob", () => {
  it("accepts a well-formed job", () => {
    expect(validateJob(goodJob)).toEqual({ valid: true, errors: [] });
  });

  describe("url", () => {
    it("rejects an empty url", () => {
      const r = validateJob({ ...goodJob, url: "" });
      expect(r.valid).toBe(false);
      expect(r.errors).toContain("url is empty");
    });

    it("rejects a non-URL string", () => {
      const r = validateJob({ ...goodJob, url: "not a url" });
      expect(r.valid).toBe(false);
      expect(r.errors.join()).toMatch(/not a valid URL/);
    });

    it("rejects a non-http(s) protocol", () => {
      const r = validateJob({ ...goodJob, url: "ftp://example.com/job" });
      expect(r.valid).toBe(false);
      expect(r.errors.join()).toMatch(/non-http/);
    });
  });

  describe("title", () => {
    it("rejects an empty / whitespace title", () => {
      expect(validateJob({ ...goodJob, title: "   " }).errors).toContain("title is empty");
    });

    it("rejects a title containing HTML", () => {
      expect(validateJob({ ...goodJob, title: "Dev <script>x</script>" }).errors).toContain("title contains HTML");
    });

    it("rejects a title over 200 chars", () => {
      const r = validateJob({ ...goodJob, title: "x".repeat(201) });
      expect(r.errors.join()).toMatch(/exceeds 200/);
    });
  });

  describe("location", () => {
    it("rejects a non-array location", () => {
      expect(validateJob({ ...goodJob, location: "Iași" }).errors).toContain("location is not an array");
    });
    it("rejects an empty entry", () => {
      expect(validateJob({ ...goodJob, location: ["Iași", ""] }).errors).toContain("location has an empty entry");
    });
  });

  describe("salary", () => {
    it("accepts a normal salary string", () => {
      expect(validateJob({ ...goodJob, salary: "5000-8000 RON" }).valid).toBe(true);
    });
    it("rejects a negative amount", () => {
      const r = validateJob({ ...goodJob, salary: "-2000 RON" });
      expect(r.valid).toBe(false);
      expect(r.errors.join()).toMatch(/negative/);
    });
    it("rejects a non-string salary", () => {
      expect(validateJob({ ...goodJob, salary: 5000 }).errors).toContain("salary is not a string");
    });
  });

  it("reports multiple errors at once", () => {
    const r = validateJob({ url: "bad", title: "" });
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects a non-object", () => {
    expect(validateJob(null).valid).toBe(false);
  });
});

describe("filterValidJobs", () => {
  let warnSpy;
  beforeEach(() => { warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => warnSpy.mockRestore());

  it("keeps the good, drops the bad, and logs each drop", () => {
    const jobs = [
      goodJob,
      { url: "https://x.ro/a", title: "" },          // empty title
      { url: "nonsense", title: "Has URL problem" }  // bad url
    ];
    const { kept, dropped } = filterValidJobs(jobs);

    expect(kept).toEqual([goodJob]);
    expect(dropped).toHaveLength(2);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("dropped"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("2/3 job(s) failed validation"));
  });

  it("returns everything when all jobs are valid and logs nothing", () => {
    const { kept, dropped } = filterValidJobs([goodJob, { ...goodJob, url: "https://x.ro/b" }]);
    expect(kept).toHaveLength(2);
    expect(dropped).toHaveLength(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("assertScrapeYieldedJobs — canary", () => {
  it("throws on an empty array (aborts before any write)", () => {
    expect(() => assertScrapeYieldedJobs([])).toThrow(/canary: 0 jobs/);
  });

  it("throws on a zero count", () => {
    expect(() => assertScrapeYieldedJobs(0)).toThrow(/canary/);
  });

  it("returns the count when jobs are present", () => {
    expect(assertScrapeYieldedJobs([{}, {}, {}])).toBe(3);
    expect(assertScrapeYieldedJobs(5)).toBe(5);
  });
});
