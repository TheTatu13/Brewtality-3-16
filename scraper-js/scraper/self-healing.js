/**
 * Self-healing extraction primitives.
 *
 * A single field is extracted through a CASCADE of strategies, tried in order
 * until one yields a non-empty value:
 *
 *   1. primary CSS selector        (from scraper/config/scraper.json)
 *   2. one or more fallback CSS selectors
 *   3. structural anchoring         (data-*, aria-*, itemprop, JSON-LD)
 *   4. regex on the raw HTML        (last-resort safety net)
 *
 * Each strategy runs in its own try/catch — a throwing or empty strategy is
 * logged and the cascade moves on, so one broken selector never takes the whole
 * run down. When a fallback rescues a field, that is logged too, so a drifting
 * site surfaces in the run output immediately instead of two weeks later.
 *
 * `parseListing` in index.js is the consumer; this module has no site-specific
 * knowledge and is meant to be reused verbatim by any derived scraper.
 */

import * as cheerio from "cheerio";

const isEmpty = (v) =>
  v == null ||
  (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.length === 0);

const clean = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : v);

/**
 * Run strategies in order; return the first non-empty result.
 *
 * @param {string} label            human name of the field, for logs
 * @param {Array<{name:string, run:() => any}>} strategies
 * @param {{silent?:boolean}} [opts] suppress the "all failed" warning (used when
 *                                   a miss is expected, e.g. an optional field)
 * @returns {{value:any, strategy:string|null, failures:string[]}}
 */
export function firstMatch(label, strategies, opts = {}) {
  const failures = [];

  for (const { name, run } of strategies) {
    try {
      const value = run();
      if (!isEmpty(value)) {
        if (failures.length) {
          console.log(`  [self-heal] ${label}: recovered via "${name}" (after ${failures.join("; ")})`);
        }
        return { value: clean(value), strategy: name, failures };
      }
      failures.push(`${name}: empty`);
    } catch (err) {
      failures.push(`${name}: ${err.message}`);
    }
  }

  if (!opts.silent) {
    console.warn(`  [self-heal] ${label}: ALL strategies failed — ${failures.join("; ") || "no strategies"}`);
  }
  return { value: null, strategy: null, failures };
}

// ---------------------------------------------------------------------------
// Strategy builders
// ---------------------------------------------------------------------------

/** Normalise a config value that may be a single selector or a list. */
export function asList(selectorOrList) {
  if (Array.isArray(selectorOrList)) return selectorOrList.filter(Boolean);
  return selectorOrList ? [selectorOrList] : [];
}

/** Text of the first element matching `selector`, searched under `$scope`. */
export function cssText($scope, selector) {
  return {
    name: `css("${selector}")`,
    run: () => $scope.find(selector).first().text()
  };
}

/** Attribute of the first element matching `selector`, under `$scope`. */
export function cssAttr($scope, selector, attr) {
  return {
    name: `css("${selector}")[${attr}]`,
    run: () => $scope.find(selector).first().attr(attr)
  };
}

/**
 * Structural anchoring: try a list of stable hooks (itemprop, aria-label,
 * data-* attributes, meta content) before giving up on the DOM.
 */
export function structuralText($scope, hooks) {
  return {
    name: `structural(${hooks.join("|")})`,
    run: () => {
      for (const hook of hooks) {
        const el = $scope.find(hook).first();
        if (el.length) {
          const text = el.text().trim() || el.attr("content") || el.attr("aria-label");
          if (text && text.trim()) return text;
        }
      }
      return null;
    }
  };
}

/** Strip tags and collapse whitespace from an HTML fragment. */
export function textFromHtml(fragment) {
  if (!fragment) return null;
  return clean(cheerio.load(String(fragment)).root().text());
}

/** Last-resort regex against a raw HTML string; the captured group is de-tagged. */
export function regexText(html, pattern, group = 1) {
  return {
    name: `regex(${String(pattern)})`,
    run: () => {
      const m = String(html).match(pattern);
      return m ? textFromHtml(m[group]) : null;
    }
  };
}

// ---------------------------------------------------------------------------
// JSON-LD (schema.org JobPosting) — the most stable hook a careers page offers
// ---------------------------------------------------------------------------

/**
 * Every schema.org JobPosting object embedded in <script type="application/ld+json">.
 * Handles a bare object, an array, and an ItemList/@graph wrapper. Malformed
 * blocks are skipped, not fatal.
 */
export function jsonLdJobPostings($) {
  const postings = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    let parsed;
    try {
      parsed = JSON.parse($(el).contents().text() || $(el).text());
    } catch {
      return; // malformed block — ignore
    }

    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(visit);
      const type = node["@type"];
      if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) {
        postings.push(node);
      }
      if (Array.isArray(node.itemListElement)) node.itemListElement.forEach(visit);
      if (Array.isArray(node["@graph"])) node["@graph"].forEach(visit);
      if (node.item) visit(node.item);
    };

    visit(parsed);
  });

  return postings;
}

// ---------------------------------------------------------------------------
// Article-level cascade: how to even find the repeated job blocks
// ---------------------------------------------------------------------------

/**
 * A mode-agnostic wrapper around one job block. `text(selectorList)` runs a CSS
 * cascade scoped to this block; `raw()` returns its HTML for regex fallbacks.
 */
function cssScope($, el) {
  const $el = $(el);
  return {
    kind: "css",
    text: (selectors) => {
      for (const sel of asList(selectors)) {
        try {
          const t = $el.find(sel).first().text();
          if (t && t.trim()) return { value: clean(t), strategy: `css("${sel}")` };
        } catch { /* bad selector — try next */ }
      }
      return { value: null, strategy: null };
    },
    fullText: () => clean($el.text()),
    raw: () => $.html($el)
  };
}

function htmlScope(chunk) {
  const $ = cheerio.load(chunk);
  const $root = $.root();
  return {
    kind: "regex",
    text: (selectors) => {
      for (const sel of asList(selectors)) {
        try {
          const t = $root.find(sel).first().text();
          if (t && t.trim()) return { value: clean(t), strategy: `css("${sel}") (in regex chunk)` };
        } catch { /* bad selector — try next */ }
      }
      return { value: null, strategy: null };
    },
    fullText: () => clean($root.text()),
    raw: () => chunk
  };
}

/**
 * Locate the repeated job blocks on a listing page.
 *
 * @returns {{mode:string, scopes:object[], jsonLd:object[]}}
 *   - mode "css:<selector>"  — matched an article-container selector
 *   - mode "regex:<article>" — fell back to slicing <article>…</article>
 *   - mode "jsonld"          — no article markup, but JobPosting JSON-LD exists
 *   - mode "none"            — nothing found (caller's canary should fire)
 */
export function locateArticles(html, articleSelectors) {
  const $ = cheerio.load(html);

  for (const sel of asList(articleSelectors)) {
    try {
      const els = $(sel);
      if (els.length) {
        return { mode: `css:${sel}`, scopes: els.toArray().map((el) => cssScope($, el)), jsonLd: [] };
      }
    } catch {
      console.warn(`  [self-heal] article selector "${sel}" is invalid — skipping`);
    }
  }

  const jsonLd = jsonLdJobPostings($);
  if (jsonLd.length) {
    return { mode: "jsonld", scopes: [], jsonLd };
  }

  const chunks = [...String(html).matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/gi)].map((m) => m[0]);
  if (chunks.length) {
    console.warn(`  [self-heal] no article selector matched — falling back to regex <article> slicing (${chunks.length} blocks)`);
    return { mode: "regex:<article>", scopes: chunks.map(htmlScope), jsonLd: [] };
  }

  return { mode: "none", scopes: [], jsonLd: [] };
}
