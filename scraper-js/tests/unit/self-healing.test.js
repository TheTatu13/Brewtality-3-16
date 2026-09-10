import { jest } from "@jest/globals";
import * as cheerio from "cheerio";
import {
  firstMatch,
  asList,
  cssText,
  structuralText,
  regexText,
  textFromHtml,
  jsonLdJobPostings,
  locateArticles
} from "../../scraper/self-healing.js";

// Silence the cascade's own logging, but keep the spies so we can assert on it.
let logSpy, warnSpy;
beforeEach(() => {
  logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  warnSpy.mockRestore();
});

describe("firstMatch — cascade primitive", () => {
  it("returns the primary strategy when it yields a value", () => {
    const res = firstMatch("field", [
      { name: "primary", run: () => "  hello  " },
      { name: "fallback", run: () => "world" }
    ]);
    expect(res.value).toBe("hello"); // trimmed
    expect(res.strategy).toBe("primary");
    expect(logSpy).not.toHaveBeenCalled(); // no "recovered via" when primary works
  });

  it("falls through to the backup when the primary is empty", () => {
    const res = firstMatch("field", [
      { name: "primary", run: () => "" },
      { name: "backup", run: () => "recovered" }
    ]);
    expect(res.value).toBe("recovered");
    expect(res.strategy).toBe("backup");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('recovered via "backup"'));
  });

  it("falls through when the primary THROWS (per-strategy try/catch)", () => {
    const res = firstMatch("field", [
      { name: "primary", run: () => { throw new Error("selector blew up"); } },
      { name: "backup", run: () => "still fine" }
    ]);
    expect(res.value).toBe("still fine");
    expect(res.strategy).toBe("backup");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("selector blew up"));
  });

  it("uses the regex last-resort when every DOM strategy fails", () => {
    const res = firstMatch("title", [
      { name: "css-primary", run: () => null },
      { name: "css-backup", run: () => "" },
      regexText("<h3>From Regex</h3>", /<h3>([\s\S]*?)<\/h3>/i)
    ]);
    expect(res.value).toBe("From Regex");
    expect(res.strategy).toMatch(/^regex/);
  });

  it("returns {value:null} and WARNS once when all strategies fail", () => {
    const res = firstMatch("doomed", [
      { name: "a", run: () => null },
      { name: "b", run: () => { throw new Error("boom"); } }
    ]);
    expect(res).toMatchObject({ value: null, strategy: null });
    expect(res.failures).toEqual(["a: empty", "b: boom"]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("ALL strategies failed"));
  });

  it("stays silent on total failure when opts.silent is set", () => {
    firstMatch("optional", [{ name: "a", run: () => null }], { silent: true });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("asList", () => {
  it("wraps a single selector, passes an array through, drops falsy", () => {
    expect(asList("a")).toEqual(["a"]);
    expect(asList(["a", "b"])).toEqual(["a", "b"]);
    expect(asList(["a", "", null, "b"])).toEqual(["a", "b"]);
    expect(asList(undefined)).toEqual([]);
  });
});

describe("cssText / structuralText builders", () => {
  const $ = cheerio.load(`
    <div id="s">
      <span class="t">CSS Title</span>
      <meta itemprop="title" content="Structural Title">
    </div>`);
  const $scope = $("#s");

  it("cssText reads the first match under the scope", () => {
    expect(cssText($scope, ".t").run()).toBe("CSS Title");
  });

  it("structuralText reads itemprop/meta content hooks", () => {
    expect(structuralText($scope, ["[itemprop='title']"]).run()).toBe("Structural Title");
  });
});

describe("textFromHtml", () => {
  it("strips tags and collapses whitespace", () => {
    expect(textFromHtml("<b>Key</b>  Account   <i>Manager</i>")).toBe("Key Account Manager");
  });
  it("returns null for empty input", () => {
    expect(textFromHtml("")).toBeNull();
    expect(textFromHtml(null)).toBeNull();
  });
});

describe("jsonLdJobPostings", () => {
  it("extracts JobPosting objects from a bare object, an array and an @graph", () => {
    const $ = cheerio.load(`
      <script type="application/ld+json">{"@type":"JobPosting","title":"Solo"}</script>
      <script type="application/ld+json">[{"@type":"JobPosting","title":"InArray"}]</script>
      <script type="application/ld+json">{"@graph":[{"@type":"Organization"},{"@type":"JobPosting","title":"InGraph"}]}</script>
    `);
    const titles = jsonLdJobPostings($).map((p) => p.title).sort();
    expect(titles).toEqual(["InArray", "InGraph", "Solo"]);
  });

  it("ignores malformed JSON-LD blocks instead of throwing", () => {
    const $ = cheerio.load(`<script type="application/ld+json">{ not json </script>`);
    expect(jsonLdJobPostings($)).toEqual([]);
  });
});

describe("locateArticles — article-level cascade", () => {
  it("mode css:<selector> when a primary selector matches", () => {
    const html = `<article class="job-item"><h3>A</h3></article><article class="job-item"><h3>B</h3></article>`;
    const r = locateArticles(html, ["article.job-item", ".fallback"]);
    expect(r.mode).toBe("css:article.job-item");
    expect(r.scopes).toHaveLength(2);
    expect(r.scopes[0].text(["h3"]).value).toBe("A");
  });

  it("uses a fallback selector when the primary misses", () => {
    const html = `<li class="vacancy"><h3>Only fallback</h3></li>`;
    const r = locateArticles(html, ["article.job-item", "li.vacancy"]);
    expect(r.mode).toBe("css:li.vacancy");
    expect(r.scopes[0].text(["h3"]).value).toBe("Only fallback");
  });

  it("mode jsonld when there is no article markup but JobPosting JSON-LD exists", () => {
    const html = `<script type="application/ld+json">{"@type":"JobPosting","title":"From LD"}</script>`;
    const r = locateArticles(html, ["article.job-item"]);
    expect(r.mode).toBe("jsonld");
    expect(r.jsonLd[0].title).toBe("From LD");
  });

  it("mode regex:<article> when selectors miss and there is no JSON-LD", () => {
    const html = `<article data-x="1"><span>Regex Title</span></article>`;
    const r = locateArticles(html, [".nope"]);
    expect(r.mode).toBe("regex:<article>");
    expect(r.scopes).toHaveLength(1);
    expect(r.scopes[0].fullText()).toContain("Regex Title");
  });

  it("mode none when nothing matches at all", () => {
    const r = locateArticles(`<div>plain page</div>`, [".nope"]);
    expect(r.mode).toBe("none");
    expect(r.scopes).toEqual([]);
  });

  it("skips an invalid selector without crashing", () => {
    const html = `<article class="job-item"><h3>Still works</h3></article>`;
    const r = locateArticles(html, ["::::garbage::::", "article.job-item"]);
    expect(r.mode).toBe("css:article.job-item");
  });
});
