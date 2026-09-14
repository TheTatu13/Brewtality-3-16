import fetch from "node-fetch";
import fs from "fs";
import { fileURLToPath } from "url";
import { validateAndGetCompany } from "./company.js";
import { querySOLR, upsertJobs, upsertCompany, deleteJobByUrl } from "./api.js";
import { generateJobsMarkdown } from "./markdown-generator.js";
import { filterValidJobs, assertScrapeYieldedJobs } from "./validate.js";
import { validateByContent } from "./job-validator.js";
import { locateArticles, firstMatch, regexText, textFromHtml } from "./self-healing.js";
import companyConfig from "./config/company.js";
import scraperConfig, { userAgent } from "./config/scraper.js";

const COMPANY_CIF = companyConfig.id;

const TIMEOUT = scraperConfig.requestTimeoutMs;
const PAGE_DELAY = scraperConfig.pageDelayMs;
const OWN_URL_PREFIX = scraperConfig.ownJobUrlPrefix;

// The path segment that marks an individual job permalink, derived from
// `ownJobUrlPrefix` (e.g. "https://site.com/jobs/" -> "/jobs/"). Used to pick
// job URLs out of the sitemap. Falls back to matching any prefixed URL.
const JOB_PATH = (() => {
  try { return new URL(OWN_URL_PREFIX).pathname.replace(/\/+$/, "") + "/"; }
  catch { return "/"; }
})();

// A short label for where a scraped job came from (the careers host).
const CAREERS_SOURCE = (() => {
  try { return new URL(scraperConfig.sources.listing).host; }
  catch { return "careers-site"; }
})();

let COMPANY_NAME = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const isOwnJob = (url) => typeof url === "string" && url.startsWith(OWN_URL_PREFIX);

// ============================================================================
// Slug helpers — join listing titles to canonical job permalinks
// ============================================================================

// Romanian diacritics have no NFD decomposition for ș/ț, so map them explicitly.
const DIACRITICS = {
  "ă": "a", "â": "a", "î": "i",
  "ș": "s", "ş": "s", "ț": "t", "ţ": "t"
};

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[ăâîșşțţ]/g, (c) => DIACRITICS[c] || c)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[m][n];
}

// Pick the sitemap URL whose slug best matches a listing title. Sitemaps drift
// in the real world (typos, a "-2" disambiguation suffix), so match
// exact → bounded prefix → small edit distance, else return null.
function matchSitemapUrl(title, sitemapEntries) {
  const slug = slugify(title);
  const exact = sitemapEntries.find((e) => e.slug === slug);
  if (exact) return exact.url;

  // Tolerate a trailing "-2"/"-copy" style disambiguation suffix on either side,
  // but only at a "-" boundary so "manager" can't swallow "manager-portofoliu".
  const boundedPrefix = (a, b) => a === b || (a.startsWith(b) && a[b.length] === "-");
  const prefix = sitemapEntries.find(
    (e) => boundedPrefix(e.slug, slug) || boundedPrefix(slug, e.slug)
  );
  if (prefix) return prefix.url;

  let best = null, bestDist = Infinity;
  for (const e of sitemapEntries) {
    const dist = levenshtein(slug, e.slug);
    if (dist < bestDist) { bestDist = dist; best = e; }
  }
  return bestDist <= 2 ? best.url : null;
}

// "30.09.2026" -> "2026-09-30T23:59:59.000Z" (end of the closing day).
// Also accepts an ISO date (schema.org JobPosting `validThrough`).
function parseDeadline(text) {
  if (!text) return undefined;
  const s = String(text);

  const dmy = s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (dmy) {
    const [, dd, mm, yyyy] = dmy;
    const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd, 23, 59, 59));
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }

  const iso = s.match(/\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?/);
  if (iso) {
    const d = new Date(iso[0]);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }

  return undefined;
}

// ============================================================================
// Careers listing — the company's own site (config `sources`)
// ============================================================================

async function fetchSitemapJobUrls() {
  const sitemapUrl = scraperConfig.sources.sitemap;
  if (!sitemapUrl || sitemapUrl.startsWith("{{")) return []; // not configured
  try {
    const res = await fetch(sitemapUrl, {
      timeout: TIMEOUT,
      headers: { "User-Agent": userAgent }
    });
    if (!res.ok) {
      console.log(`  Sitemap returned ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const entries = [];
    // one path segment past JOB_PATH, e.g. /jobs/<slug>/ but not the /jobs/ index
    const jobUrlRe = new RegExp(`${JOB_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^/]+/?$`);
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      const url = m[1].trim();
      if (!jobUrlRe.test(url)) continue;
      const slug = url.replace(/\/$/, "").split("/").pop();
      entries.push({ url, slug });
    }
    console.log(`  Sitemap: ${entries.length} job permalinks`);
    return entries;
  } catch (err) {
    console.log(`  Sitemap error: ${err.message}`);
    return [];
  }
}

async function fetchListing() {
  const res = await fetch(scraperConfig.sources.listing, {
    timeout: TIMEOUT,
    headers: { "User-Agent": userAgent }
  });
  if (!res.ok) throw new Error(`listing returned ${res.status}`);
  return res.text();
}

// Strip HTML tags / collapse whitespace, cap at the job-model title limit.
function cleanTitle(raw) {
  const t = textFromHtml(raw);
  if (!t) return null;
  return t.replace(/\s+/g, " ").trim().slice(0, 200) || null;
}

/**
 * Parse the open-positions listing into { title, expirationdate, url } items,
 * self-healing through the selector cascade (default: scraper/config/scraper.json;
 * pass `selectors` explicitly in tests):
 *
 *   article blocks:  CSS list  ->  JSON-LD JobPosting  ->  regex <article>
 *   title:           CSS list  ->  regex <hN>  ->  regex <a>
 *   deadline:        CSS list  ->  date regex over the whole block text
 *   url:             first real <a href> in the block (may be relative; the
 *                     caller resolves it against the listing page)
 *
 * `url` is null when the block has no anchor at all -- the caller then falls
 * back to a sitemap match or a title-slug guess. Prefer this scraped `url`
 * whenever present: guessing a permalink from the title alone breaks on any
 * site whose real URL needs an ID the title can't reproduce.
 *
 * @param {string} html
 * @param {{jobArticle:any, jobTitle:any, jobMeta:any, jobUrl?:any}} [selectors]
 */
function parseListing(html, selectors = scraperConfig.selectors) {
  const { jobTitle, jobMeta, jobArticle, jobUrl } = selectors;
  const { mode, scopes, jsonLd } = locateArticles(html, jobArticle);
  const items = [];
  const strategies = new Set();
  const seenTitles = new Set(); // a broad fallback selector can match nested blocks

  if (mode === "jsonld") {
    for (const posting of jsonLd) {
      const title = cleanTitle(posting.title);
      if (!title || seenTitles.has(title.toLowerCase())) continue;
      seenTitles.add(title.toLowerCase());
      strategies.add("jsonld");
      items.push({ title, expirationdate: parseDeadline(posting.validThrough), url: posting.url || null });
    }
    console.log(`  parseListing: ${items.length} items via JSON-LD JobPosting`);
    return items;
  }

  for (let i = 0; i < scopes.length; i++) {
    const scope = scopes[i];

    // TITLE — CSS cascade (incl. itemprop/aria hooks), then regex last resort.
    const { value: title, strategy } = firstMatch(`title[${i}]`, [
      { name: "css-cascade", run: () => scope.text(jobTitle).value },
      regexText(scope.raw(), /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i),
      regexText(scope.raw(), /<a\b[^>]*>([\s\S]*?)<\/a>/i)
    ], { silent: true });

    const cleaned = cleanTitle(title);
    if (!cleaned || seenTitles.has(cleaned.toLowerCase())) continue;
    seenTitles.add(cleaned.toLowerCase());
    if (strategy) strategies.add(strategy);

    // DEADLINE — meta selectors, then a bare date regex over the whole block.
    const metaText = scope.text(jobMeta).value;
    const deadline = parseDeadline(metaText) || parseDeadline(scope.fullText());

    const url = scope.href(jobUrl).value;
    items.push({ title: cleaned, expirationdate: deadline, url });
  }

  console.log(
    `  parseListing: ${items.length} items via ${mode}` +
    (strategies.size ? ` [${[...strategies].join(", ")}]` : "")
  );
  return items;
}

// Light location hint from the title; the transform step still validates against
// the Romanian-city allowlist and falls back to "România".
const RO_CITY_HINTS = [
  "Iași", "Iasi", "București", "Bucuresti", "Cluj", "Timișoara", "Timisoara",
  "Ploiești", "Ploiesti", "Constanța", "Constanta", "Brașov", "Brasov",
  "Craiova", "Sibiu", "Oradea", "Bacău", "Bacau", "Galați", "Galati",
  "Dâmbovița", "Dambovita"
];

function locationFromTitle(title) {
  const hit = RO_CITY_HINTS.find((c) => new RegExp(`\\b${c}\\b`, "i").test(title));
  return hit ? [hit] : scraperConfig.defaultLocation;
}

async function scrapeCareers() {
  console.log(`Scraping ${scraperConfig.sources.listing} ...`);
  const jobs = [];

  const sitemapEntries = await fetchSitemapJobUrls();
  await sleep(PAGE_DELAY);

  let listingItems = [];
  try {
    listingItems = parseListing(await fetchListing());
    console.log(`  Listing: ${listingItems.length} open positions`);
  } catch (err) {
    console.log(`  Listing error: ${err.message}`);
  }

  if (listingItems.length > 0) {
    for (const item of listingItems) {
      // The real <a href> scraped from the page is ground truth -- prefer it
      // over guessing. Sites whose permalink needs an ID the title can't
      // reproduce (e.g. "/jobs/jr133930/software-architect/") silently 404
      // under the guess, which nothing else catches until the live
      // validation just before upload.
      const url = item.url
        ? new URL(item.url, scraperConfig.sources.listing).toString()
        : matchSitemapUrl(item.title, sitemapEntries) ||
          `${scraperConfig.sources.jobArchive}${slugify(item.title)}/`;
      jobs.push({
        url,
        title: item.title,
        location: locationFromTitle(item.title),
        workmode: scraperConfig.defaultWorkmode,
        expirationdate: item.expirationdate,
        source: CAREERS_SOURCE
      });
    }
  } else if (sitemapEntries.length > 0) {
    // Listing unreachable — fall back to sitemap-only, deriving titles from slugs.
    console.log("  Falling back to sitemap-only (titles from slugs)");
    for (const e of sitemapEntries) {
      const title = e.slug
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      jobs.push({
        url: e.url,
        title,
        location: scraperConfig.defaultLocation,
        workmode: scraperConfig.defaultWorkmode,
        source: CAREERS_SOURCE
      });
    }
  }

  console.log(`  Found ${jobs.length} jobs on ${CAREERS_SOURCE}`);
  return jobs;
}

// ============================================================================
// ANOFM — free public postings by CIF
// ============================================================================

async function searchANOFM(cif) {
  const jobs = [];
  try {
    console.log(`Searching ANOFM by CIF: ${cif}`);
    const payload = {
      current: 1,
      rowCount: 250,
      sort: { created_at: "desc" },
      employer_tax_code: cif
    };
    const res = await fetch("https://mediere.anofm.ro/api/entity/vw_public_job_posting", {
      method: "POST",
      timeout: TIMEOUT,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": userAgent
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      console.log(`  ANOFM returned ${res.status}`);
      return jobs;
    }
    const data = await res.json();
    for (const row of data.rows || []) {
      const locationParts = (row.address_locality_name || "").split(">").map((s) => s.trim());
      const location = locationParts.length > 1 ? locationParts[locationParts.length - 1] : locationParts[0];
      jobs.push({
        url: `https://mediere.anofm.ro/app/module/mediere/job/${row.id}`,
        title: row.occupation,
        location: location ? [location] : undefined,
        source: "ANOFM"
      });
    }
    console.log(`  Found ${jobs.length} jobs on ANOFM`);
  } catch (err) {
    console.log(`  ANOFM error: ${err.message}`);
  }
  return jobs;
}

// ============================================================================
// Job Model
// ============================================================================

function mapToJobModel(rawJob, cif, companyName = COMPANY_NAME) {
  const now = new Date().toISOString();

  const job = {
    url: rawJob.url,
    title: rawJob.title,
    company: companyName,
    cif: cif,
    location: rawJob.location?.length ? rawJob.location : undefined,
    tags: rawJob.tags?.length ? rawJob.tags : undefined,
    workmode: rawJob.workmode || undefined,
    expirationdate: rawJob.expirationdate || undefined,
    date: now,
    status: "scraped"
  };

  Object.keys(job).forEach((k) => job[k] === undefined && delete job[k]);

  return job;
}

function transformJobsForSOLR(payload) {
  const romanianCities = [
    'Bucharest', 'București', 'Cluj-Napoca', 'Cluj Napoca',
    'Timișoara', 'Timisoara', 'Iași', 'Iasi', 'Brașov', 'Brasov',
    'Constanța', 'Constanta', 'Craiova', 'Bacău', 'Sibiu',
    'Târgu Mureș', 'Targu Mures', 'Oradea', 'Baia Mare', 'Satu Mare',
    'Ploiești', 'Ploiesti', 'Pitești', 'Pitesti', 'Arad', 'Galați', 'Galati',
    'Brăila', 'Braila', 'Drobeta-Turnu Severin', 'Râmnicu Vâlcea', 'Ramnicu Valcea',
    'Buzău', 'Buzau', 'Botoșani', 'Botosani', 'Zalău', 'Zalau', 'Hunedoara', 'Deva',
    'Suceava', 'Bistrița', 'Bistrita', 'Tulcea', 'Călărași', 'Calarasi',
    'Giurgiu', 'Alba Iulia', 'Slatina', 'Piatra Neamț', 'Piatra Neamt', 'Roman',
    'Dumbrăvița', 'Dumbravita', 'Voluntari', 'Popești-Leordeni', 'Popesti-Leordeni',
    'Chitila', 'Mogoșoaia', 'Mogosoaia', 'Otopeni', 'Dâmbovița', 'Dambovita'
  ];

  const citySet = new Set(romanianCities.map(c => c.toLowerCase()));

  const normalizeWorkmode = (wm) => {
    if (!wm) return undefined;
    const lower = wm.toLowerCase();
    if (lower.includes('remote')) return 'remote';
    if (lower.includes('office') || lower.includes('on-site') || lower.includes('site')) return 'on-site';
    return 'hybrid';
  };

  const transformed = {
    ...payload,
    company: payload.company?.toUpperCase(),
    jobs: payload.jobs.map(job => {
      const validLocations = (job.location || []).filter(loc => {
        const lower = loc.toLowerCase().trim();
        if (lower === 'romania' || lower === 'românia') return true;
        return citySet.has(lower);
      }).map(loc => loc.toLowerCase() === 'romania' ? 'România' : loc);

      return {
        ...job,
        location: validLocations.length > 0 ? validLocations : ['România'],
        workmode: normalizeWorkmode(job.workmode)
      };
    })
  };

  return transformed;
}

/**
 * Pre-upload safety net: GET-check every job URL and drop the ones that don't
 * resolve. filterValidJobs only checks URL *shape* (a syntactically valid
 * http(s) URL); job-validator.js can actually tell a live job from a 404, but
 * nothing called it before an upload -- this is what let a URL-construction
 * bug reach peviitor undetected.
 *
 * Uses validateByContent (GET), not validateByHead: at least one real
 * careers site (Workday-based) answers every HEAD request with a generic 404
 * regardless of whether the resource exists -- HEAD-only would have dropped
 * every real job.
 */
async function dropDeadUrls(jobs) {
  const alive = [];
  for (const job of jobs) {
    const result = await validateByContent(job.url);
    if (result.status === "active") {
      alive.push(job);
    } else {
      console.warn(`  dropped "${job.title}" (${job.url}): live URL check failed — ${result.error || `HTTP ${result.httpStatus}`}`);
    }
  }
  if (alive.length < jobs.length) {
    console.warn(`  ${jobs.length - alive.length}/${jobs.length} job(s) failed live URL validation and were dropped`);
  }
  return alive;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  try {
    fs.mkdirSync("scraper", { recursive: true });

    console.log("=== Step 1: Get existing jobs from SOLR ===");
    const existingResult = await querySOLR(COMPANY_CIF);
    const existingCount = existingResult.numFound;
    // Every URL under this CIF (used to classify a scraped job as new vs. update).
    const allExistingUrls = new Set(existingResult.docs.map(d => d.url));
    // Only URLs this scraper owns — the same CIF may also carry jobs published
    // by other peviitor scrapers / aggregators. We never touch those, and only
    // these can be reported as "gone from the site".
    const ownExistingUrls = new Set(
      existingResult.docs.map(d => d.url).filter(isOwnJob)
    );
    console.log(`Found ${existingCount} existing jobs in SOLR (${ownExistingUrls.size} ours)`);

    console.log("=== Step 2: Validate company via ANAF ===");
    const { company, cif, address, status } = await validateAndGetCompany();
    COMPANY_NAME = company;
    if (status === 'inactive') {
      console.log("Company is INACTIVE — removing only our own jobs, skipping scrape.");
      for (const url of ownExistingUrls) {
        try { await deleteJobByUrl(url); } catch (e) { console.warn(`  delete failed: ${url} — ${e.message}`); }
      }
      return;
    }

    // On by default: upsertCompany is an idempotent PUT of ANAF-validated facts
    // (name, address, website, career URL), so there's no real downside to
    // keeping the company core in sync -- unlike staleJobDeletion below, this
    // is additive, not destructive. Only turn it off once you've verified
    // another scraper genuinely owns this CIF's company record.
    if (scraperConfig.manageCompany) {
      try {
        await upsertCompany({
          id: cif,
          company,
          brand: companyConfig.brand || undefined,
          status: status === 'active' ? 'activ' : (status || "activ"),
          location: address ? [address] : companyConfig.location,
          website: companyConfig.website,
          career: companyConfig.career,
          scraperFile: companyConfig.scraperFile,
          lastScraped: new Date().toISOString().split('T')[0]
        });
      } catch (err) {
        console.log(`Note: Could not upsert company: ${err.message}`);
      }
    } else {
      console.log(
        "manageCompany=false — leaving company core untouched (explicitly disabled in " +
        "config/scraper.json; only turn this off once you've *verified* another scraper " +
        "actually manages this CIF's company record — an unverified guess here is exactly " +
        "what left a real company entirely missing from peviitor's company core before)"
      );
    }

    console.log("=== Step 3: Scrape jobs ===");
    const rawJobs = [];

    const careerJobs = await scrapeCareers();
    rawJobs.push(...careerJobs);

    const anofmJobs = await searchANOFM(cif);
    for (const job of anofmJobs) {
      if (!rawJobs.find(j => j.url === job.url)) {
        rawJobs.push(job);
      }
    }
    console.log(`Jobs from ANOFM: ${anofmJobs.length}`);

    console.log(`Total jobs scraped (careers site + ANOFM): ${rawJobs.length}`);

    // Canary — abort before writing anything if every source came back empty.
    assertScrapeYieldedJobs(rawJobs);

    // Drop jobs with a broken URL / empty title / bad data before publishing.
    const { kept: validJobs } = filterValidJobs(rawJobs);
    assertScrapeYieldedJobs(validJobs); // everything failed validation → also a canary

    const scrapedCount = validJobs.length;
    const jobs = validJobs.map(job => mapToJobModel(job, cif));

    const payload = {
      source: `${CAREERS_SOURCE},anofm.ro`,
      scrapedAt: new Date().toISOString(),
      company: COMPANY_NAME,
      cif: cif,
      jobs
    };

    console.log("Transforming jobs for SOLR...");
    const transformedPayload = transformJobsForSOLR(payload);
    transformedPayload.jobs = await dropDeadUrls(transformedPayload.jobs);
    const validCount = transformedPayload.jobs.filter(j => j.location).length;
    console.log(`Jobs with valid Romanian locations: ${validCount}`);

    fs.writeFileSync("scraper/jobs.json", JSON.stringify(transformedPayload, null, 2), "utf-8");
    console.log("Saved scraper/jobs.json");

    const companyData = {
      id: cif,
      company: transformedPayload.company,
      brand: companyConfig.brand || undefined,
      status: status === 'active' ? 'activ' : (status || "activ"),
      location: address ? [address] : companyConfig.location,
      website: companyConfig.website,
      career: companyConfig.career,
      lastScraped: new Date().toISOString().split('T')[0]
    };
    const markdown = generateJobsMarkdown(companyData, transformedPayload.jobs);
    fs.mkdirSync("docs", { recursive: true });
    fs.writeFileSync("docs/jobs.md", markdown, "utf-8");
    console.log("Saved docs/jobs.md");

    // docs/company.json = company identity + the URL prefix the static page uses
    // to show only jobs this scraper manages (not eJobs/BestJobs imports on the
    // same CIF).
    fs.writeFileSync(
      "docs/company.json",
      JSON.stringify({ ...companyConfig, ownJobUrlPrefix: OWN_URL_PREFIX }, null, 2),
      "utf-8"
    );
    console.log("Wrote docs/company.json (+ ownJobUrlPrefix)");

    console.log("\n=== Step 4: Upsert jobs to SOLR ===");
    if (transformedPayload.jobs.length > 0) {
      await upsertJobs(transformedPayload.jobs);
    } else {
      console.log("No jobs scraped — skipping upsert (API rejects an empty array)");
    }

    // Step 4.5 — stale-job deletion. Disabled by default: if the CIF is shared
    // with another scraper, deleting (even scoped to our own URLs) would fight
    // that scraper on any transient fetch failure. The nightly validate-jobs.js
    // job (scoped to our URLs) handles real 404s instead.
    if (scraperConfig.staleJobDeletion) {
      const scrapedUrls = new Set(transformedPayload.jobs.map(job => job.url));
      const staleUrls = [...ownExistingUrls].filter(url => !scrapedUrls.has(url));
      if (staleUrls.length > 0) {
        console.log(`\n=== Step 4.5: Delete ${staleUrls.length} stale job(s) (ours only) ===`);
        for (const url of staleUrls) {
          try {
            console.log(`  Deleting: ${url}`);
            await deleteJobByUrl(url);
          } catch (delErr) {
            console.warn(`  Failed to delete: ${url} — ${delErr.message}`);
          }
        }
      } else {
        console.log("\nNo stale jobs to delete");
      }
    } else {
      console.log(
        "\nStep 4.5 skipped — staleJobDeletion=false (deliberate: a partial scrape " +
        "failure would otherwise delete real jobs it simply failed to find this run — " +
        "use the deep-validate workflow to actually confirm and clean up dead URLs)"
      );
    }

    console.log("\n=== Step 5: Summary ===");
    await sleep(2000);
    const finalResult = await querySOLR(COMPANY_CIF);

    // Diff this run against what was in SOLR before it.
    const scrapedUrls = new Set(transformedPayload.jobs.map(job => job.url));
    const addedUrls = [...scrapedUrls].filter(url => !allExistingUrls.has(url));
    const updatedUrls = [...scrapedUrls].filter(url => allExistingUrls.has(url));
    const goneUrls = [...ownExistingUrls].filter(url => !scrapedUrls.has(url));

    const preview = (urls, n = 10) =>
      urls.slice(0, n).map(u => `    - ${u}`).join("\n") +
      (urls.length > n ? `\n    … and ${urls.length - n} more` : "");

    console.log(`\n=== SUMMARY ===`);
    console.log(`Jobs in SOLR before scrape:  ${existingCount} (${ownExistingUrls.size} ours)`);
    console.log(`Scraped this run:             ${scrapedCount} (careers site + ANOFM)`);
    console.log(`  new (not in SOLR before):  ${addedUrls.length}`);
    if (addedUrls.length) console.log(preview(addedUrls));
    console.log(`  updated (already in SOLR): ${updatedUrls.length}`);
    console.log(`  gone from site (ours):     ${goneUrls.length}${goneUrls.length && !scraperConfig.staleJobDeletion ? " — kept (staleJobDeletion=false)" : ""}`);
    if (goneUrls.length) console.log(preview(goneUrls));
    console.log(`Jobs in SOLR after scrape:    ${finalResult.numFound}`);
    console.log(`====================`);

    console.log("\n=== DONE ===");
    console.log("Scraper completed successfully!");

  } catch (err) {
    console.error("Scraper failed:", err);
    process.exit(1);
  }
}

export { mapToJobModel, transformJobsForSOLR, scrapeCareers, fetchSitemapJobUrls, parseListing, slugify, matchSitemapUrl, parseDeadline, dropDeadUrls };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
