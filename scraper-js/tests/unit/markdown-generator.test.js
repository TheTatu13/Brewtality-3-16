import { generateJobsMarkdown } from "../../scraper/markdown-generator.js";

const baseCompany = {
  id: "1973096",
  company: "ANTIBIOTICE SA",
  brand: "Antibiotice",
  status: "activ",
  location: ["Iași"],
  website: ["https://www.antibiotice.ro"],
  career: ["https://www.antibiotice.ro/cariere/open-position/"],
  lastScraped: "2026-09-06"
};

const baseJob = {
  url: "https://www.antibiotice.ro/joburi/specialist-marketing/",
  title: "Specialist Marketing",
  workmode: "on-site",
  location: ["Iași"],
  tags: ["marketing", "comunicare"],
  status: "scraped"
};

describe("generateJobsMarkdown", () => {
  describe("company section", () => {
    it("includes company name as h1", () => {
      const md = generateJobsMarkdown(baseCompany, []);
      expect(md).toContain("# ANTIBIOTICE SA");
    });

    it("includes CIF", () => {
      const md = generateJobsMarkdown(baseCompany, []);
      expect(md).toContain("1973096");
    });

    it("includes brand", () => {
      const md = generateJobsMarkdown(baseCompany, []);
      expect(md).toContain("Antibiotice");
    });

    it("includes status", () => {
      const md = generateJobsMarkdown(baseCompany, []);
      expect(md).toContain("activ");
    });

    it("includes website as markdown link", () => {
      const md = generateJobsMarkdown(baseCompany, []);
      expect(md).toContain("[https://www.antibiotice.ro](https://www.antibiotice.ro)");
    });

    it("includes career page as markdown link", () => {
      const md = generateJobsMarkdown(baseCompany, []);
      expect(md).toContain("[https://www.antibiotice.ro/cariere/open-position/](https://www.antibiotice.ro/cariere/open-position/)");
    });

    it("includes lastScraped date", () => {
      const md = generateJobsMarkdown(baseCompany, []);
      expect(md).toContain("2026-09-06");
    });

    it("omits optional fields when not present", () => {
      const minimal = { id: "1973096", company: "ANTIBIOTICE SA" };
      const md = generateJobsMarkdown(minimal, []);
      expect(md).toContain("# ANTIBIOTICE SA");
      expect(md).not.toContain("Brand");
      expect(md).not.toContain("Last Scraped");
    });
  });

  describe("jobs section", () => {
    it("shows job count in heading", () => {
      const md = generateJobsMarkdown(baseCompany, [baseJob]);
      expect(md).toContain("## Current Job Listings (1)");
    });

    it("shows 0 when no jobs", () => {
      const md = generateJobsMarkdown(baseCompany, []);
      expect(md).toContain("## Current Job Listings (0)");
    });

    it("includes job title as h3", () => {
      const md = generateJobsMarkdown(baseCompany, [baseJob]);
      expect(md).toContain("### Specialist Marketing");
    });

    it("includes job URL as markdown link", () => {
      const md = generateJobsMarkdown(baseCompany, [baseJob]);
      expect(md).toContain("[https://www.antibiotice.ro/joburi/specialist-marketing/]");
    });

    it("includes workmode", () => {
      const md = generateJobsMarkdown(baseCompany, [baseJob]);
      expect(md).toContain("on-site");
    });

    it("includes location", () => {
      const md = generateJobsMarkdown(baseCompany, [baseJob]);
      expect(md).toContain("Iași");
    });

    it("includes tags", () => {
      const md = generateJobsMarkdown(baseCompany, [baseJob]);
      expect(md).toContain("marketing, comunicare");
    });

    it("includes status", () => {
      const md = generateJobsMarkdown(baseCompany, [baseJob]);
      expect(md).toContain("scraped");
    });

    it("renders multiple jobs", () => {
      const job2 = { ...baseJob, title: "Operator Producție", url: "https://mediere.anofm.ro/app/module/mediere/job/700001" };
      const md = generateJobsMarkdown(baseCompany, [baseJob, job2]);
      expect(md).toContain("### Specialist Marketing");
      expect(md).toContain("### Operator Producție");
      expect(md).toContain("## Current Job Listings (2)");
    });

    it("handles job with no optional fields", () => {
      const minimal = { url: "https://www.antibiotice.ro/joburi/analist-calitate/", title: "Analist Calitate" };
      const md = generateJobsMarkdown(baseCompany, [minimal]);
      expect(md).toContain("### Analist Calitate");
      expect(md).not.toContain("Work Mode");
      expect(md).not.toContain("Tags");
    });
  });

  describe("output format", () => {
    it("returns a non-empty string", () => {
      const md = generateJobsMarkdown(baseCompany, [baseJob]);
      expect(typeof md).toBe("string");
      expect(md.length).toBeGreaterThan(0);
    });

    it("includes a generated timestamp", () => {
      const md = generateJobsMarkdown(baseCompany, []);
      expect(md).toMatch(/_Generated: \d{4}-\d{2}-\d{2}/);
    });
  });

  describe("markdown escaping", () => {
    it("escapes # in job titles", () => {
      const job = { ...baseJob, title: "C# Developer" };
      const md = generateJobsMarkdown(baseCompany, [job]);
      expect(md).toContain("### C\\# Developer");
    });

    it("escapes * in job titles", () => {
      const job = { ...baseJob, title: "Full-Stack * Developer" };
      const md = generateJobsMarkdown(baseCompany, [job]);
      expect(md).toContain("### Full-Stack \\* Developer");
    });

    it("escapes [ ] in company name", () => {
      const company = { ...baseCompany, company: "ACME [Tech] SRL" };
      const md = generateJobsMarkdown(company, []);
      expect(md).toContain("# ACME \\[Tech\\] SRL");
    });

    it("escapes ` in tags", () => {
      const job = { ...baseJob, tags: ["node.js", "`bash`"] };
      const md = generateJobsMarkdown(baseCompany, [job]);
      expect(md).toContain("\\`bash\\`");
    });

    it("escapes # in location", () => {
      const job = { ...baseJob, location: ["Building #5"] };
      const md = generateJobsMarkdown(baseCompany, [job]);
      expect(md).toContain("Building \\#5");
    });
  });
});
