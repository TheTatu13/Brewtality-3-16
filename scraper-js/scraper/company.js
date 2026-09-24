/**
 * Company Module - Company Validation and Data Management
 *
 * Handles company data validation from ANAF, caches company information,
 * and validates companies against the Peviitor API.
 */

import fetch from "node-fetch";
import fs from "fs";
import { querySOLR, deleteJobsByCIF } from "./api.js";
import { getCompanyFromANAF } from "./anaf.js";
import companyConfig from "./config/company.js";
import { userAgent } from "./config/scraper.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

const Peviitor_API_URL = "https://api.peviitor.ro/v1/company/";

const COMPANY_CIF = companyConfig.id;
const COMPANY_BRAND = companyConfig.brand;
const COMPANY_LEGAL_NAME = companyConfig.company;

const CACHE_MAX_AGE_DAYS = 7;
const ROOT_CACHE_PATH = "company.json";
const TMP_CACHE_PATH = "tmp/company.json";

// ============================================================================
// COMPANY MODEL - schema for the peviitor company-core document
// ============================================================================

/**
 * Declarative schema for a peviitor company-core document, mirrored from the
 * shape "Ensure company exists in company core" (scrape.yml) upserts and
 * from api.peviitor.ro/v1/company/'s response shape. Used by
 * validateCompanyModel() so a consistency test can assert the *live* record
 * still has the fields/types/status the fleet relies on, instead of only
 * checking that our own upsert payload looked right.
 */
export const COMPANY_MODEL_FIELDS = [
  { name: "id", required: true, type: "string" },
  { name: "company", required: true, type: "string" },
  { name: "brand", required: false, type: "string" },
  { name: "group", required: false, type: "string" },
  { name: "status", required: false, type: "string", allowed: ["activ", "suspendat", "inactiv", "radiat"] },
  { name: "location", required: false, type: "array" },
  { name: "website", required: false, type: "array" },
  { name: "career", required: false, type: "array" },
  { name: "lastScraped", required: false, type: "string" },
  { name: "scraperFile", required: false, type: "string" }
];

/**
 * Validates a company-core document against COMPANY_MODEL_FIELDS.
 * @param {Object} data - the document to check (e.g. a live peviitor record).
 * @returns {{ valid: boolean, errors: string[], extraFields: string[] }}
 */
export function validateCompanyModel(data) {
  const errors = [];

  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["No company document provided"], extraFields: [] };
  }

  for (const field of COMPANY_MODEL_FIELDS) {
    const value = data[field.name];

    if (field.required && (value === undefined || value === null || value === "")) {
      errors.push(`Missing required field: ${field.name}`);
      continue;
    }
    if (value === undefined || value === null) continue;

    if (field.type === "string" && typeof value !== "string") {
      errors.push(`Field ${field.name} should be string, got ${typeof value}`);
    }
    if (field.type === "array" && !Array.isArray(value)) {
      errors.push(`Field ${field.name} should be array, got ${typeof value}`);
    }
    if (field.allowed && !field.allowed.includes(value)) {
      errors.push(`Field ${field.name} has invalid value "${value}". Allowed: ${field.allowed.join(", ")}`);
    }
  }

  const allowedFields = COMPANY_MODEL_FIELDS.map((f) => f.name);
  const extraFields = Object.keys(data).filter((k) => !allowedFields.includes(k));

  return { valid: errors.length === 0, errors, extraFields };
}

// ============================================================================
// PEVIITOR API
// ============================================================================

async function getCompanyFromPeviitor(companyName) {
  const url = `${Peviitor_API_URL}?name=${encodeURIComponent(companyName)}`;
  const res = await fetch(url, {
    headers: {
      origin: "https://peviitor.ro",
      referer: "https://peviitor.ro/",
      "User-Agent": userAgent
    }
  });

  if (!res.ok) {
    throw new Error(`Peviitor API error: ${res.status}`);
  }

  const data = await res.json();
  return data.companies?.[0] || null;
}

// ============================================================================
// DATA PERSISTENCE
// ============================================================================

function saveCompanyData(anafData, peviitorData) {
  const companyData = {
    validatedAt: new Date().toISOString(),
    source: "ANAF",
    brand: COMPANY_BRAND,
    anaf: anafData,
    peviitor: peviitorData,
    summary: {
      company: anafData?.name || null,
      cif: anafData?.cui?.toString() || null,
      active: !anafData?.inactive,
      inactiveSince: anafData?.inactiveSince || null,
      address: anafData?.address || null
    }
  };

  const json = JSON.stringify(companyData, null, 2);

  fs.mkdirSync("tmp", { recursive: true });
  fs.writeFileSync(TMP_CACHE_PATH, json, "utf-8");
  console.log(`\n✅ Saved company data to ${TMP_CACHE_PATH}`);

  fs.writeFileSync(ROOT_CACHE_PATH, json, "utf-8");
  console.log(`✅ Updated root cache ${ROOT_CACHE_PATH}\n`);

  return companyData;
}

function isValidCache(data) {
  return Boolean(data?.anaf?.cui && data?.anaf?.name);
}

function isCacheFresh(data) {
  if (!data?.validatedAt) return false;
  const ageMs = Date.now() - new Date(data.validatedAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return ageDays < CACHE_MAX_AGE_DAYS;
}

function loadCachedCompanyData() {
  for (const cachePath of [TMP_CACHE_PATH, ROOT_CACHE_PATH]) {
    if (!fs.existsSync(cachePath)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      if (!isValidCache(data)) continue;
      if (isCacheFresh(data)) {
        console.log(`Found fresh cached company data in ${cachePath}`);
        return data;
      }
      console.log(`Found stale cached company data in ${cachePath} (older than ${CACHE_MAX_AGE_DAYS} days)`);
      return { ...data, _stale: true };
    } catch (e) {
      console.log(`Warning: Could not parse ${cachePath}`);
    }
  }
  return null;
}

// ============================================================================
// COMPANY DATA RETRIEVAL
// ============================================================================

export async function getCompanyData() {
  const cachedData = loadCachedCompanyData();

  if (cachedData && !cachedData._stale && cachedData.summary?.cif) {
    console.log(`Using cached company data for CIF: ${cachedData.summary.cif}`);
    const anafData = cachedData.anaf;

    console.log(`Cached name: ${anafData.name}`);
    console.log(`Cached status: ${anafData.inactive ? "INACTIVE" : "ACTIVE"}`);

    return {
      company: anafData.name.toUpperCase(),
      cif: anafData.cui.toString(),
      active: !anafData.inactive,
      anafData
    };
  }

  console.log(`Fetching fresh company data from ANAF for CIF: ${COMPANY_CIF}`);
  let anafData;
  try {
    anafData = await getCompanyFromANAF(COMPANY_CIF);
  } catch (err) {
    if (cachedData?.anaf) {
      console.log(`⚠️ ANAF unreachable (${err.message}) — falling back to cached data`);
      const a = cachedData.anaf;
      return {
        company: a.name.toUpperCase(),
        cif: a.cui.toString(),
        active: !a.inactive,
        anafData: a
      };
    }
    console.log(`⚠️ ANAF unreachable (${err.message}) — no cache available, proceeding with company config`);
    return {
      company: COMPANY_LEGAL_NAME,
      cif: COMPANY_CIF,
      active: true,
      anafData: null
    };
  }

  if (!anafData) {
    throw new Error("No data from ANAF - cannot proceed with scraping");
  }
  if (!anafData.name) {
    throw new Error("ANAF returned no company name - cannot proceed with scraping");
  }

  console.log(`ANAF returned name: ${anafData.name}`);
  console.log(`ANAF status: ${anafData.inactive ? "INACTIVE" : "ACTIVE"}`);

  return {
    company: anafData.name.toUpperCase(),
    cif: anafData.cui.toString(),
    active: !anafData.inactive,
    anafData
  };
}

// ============================================================================
// COMPANY VALIDATION WORKFLOW
// ============================================================================

/**
 * @param {boolean} dryRun - when true, skips the CIF-wide delete below for an
 * ANAF-inactive company. This function never had a dry-run path at all before
 * -- callers had no way to safely check a company's status without risking a
 * real, CIF-wide DELETE against peviitor's live API (deleteJobsByCIF removes
 * every job under that CIF, including ones scraped by other, unrelated
 * scrapers, not just this one's).
 */
export async function validateAndGetCompany(dryRun = false) {
  console.log("=== Step 1: Validate company via ANAF ===\n");

  const companyData = await getCompanyData();
  let company = companyData.company;
  const { cif, active, anafData } = companyData;

  console.log("\n=== Step 2: Check existing jobs in SOLR ===\n");
  const solrResult = await querySOLR(cif);
  console.log(`Jobs found in SOLR for CIF ${cif}: ${solrResult.numFound}`);

  console.log("\n=== Step 3: Validate via Peviitor ===\n");
  let peviitorData = null;
  try {
    // Peviitor's own search is an exact, case-sensitive match against the
    // legal name it already has stored (uppercase) -- querying with the
    // brand (e.g. "Hochland" against a stored "HOCHLAND ...") never
    // matches, so this silently returned no record, and every job/company
    // write below fell back to ANAF's freshly fetched name instead of
    // whatever peviitor already had indexed.
    peviitorData = await getCompanyFromPeviitor(COMPANY_LEGAL_NAME.toUpperCase());
    console.log("Peviitor data fetched successfully");
  } catch (e) {
    console.log("Peviitor API error:", e.message);
  }

  if (anafData) {
    saveCompanyData(anafData, peviitorData);
  }

  // Prefer the name peviitor already has on file for this CIF: ANAF's
  // spelling (diacritics, spacing) can drift from what's already indexed
  // and faceted on the site, and peviitor's company-core upsert does not
  // reliably rewrite an existing "company" field -- so a job tagged with
  // ANAF's fresh name can permanently mismatch the site's "Companie"
  // filter even though free-text search still finds it. Only fall back to
  // ANAF's name for a company peviitor has never seen before.
  if (peviitorData?.company) {
    company = peviitorData.company;
  }

  if (!active) {
    if (dryRun) {
      console.log(`\n⚠️ Company is INACTIVE in ANAF -- dry-run, so NOT deleting the ${solrResult.numFound} job(s) under this CIF (would run deleteJobsByCIF on a real run)`);
    } else {
      console.log("\n⚠️ Company is INACTIVE in ANAF - deleting jobs from SOLR and stopping");
      if (solrResult.numFound > 0) {
        await deleteJobsByCIF(cif);
      }
    }
    return { status: "inactive", company, cif, existingJobsCount: solrResult.numFound };
  }

  const address = anafData?.address || "";

  console.log(`\n✅ Company validated: ${company}, CIF: ${cif}`);
  console.log("Ready to scrape jobs...\n");

  return { status: "active", company, cif, existingJobsCount: solrResult.numFound, address, anafData };
}
