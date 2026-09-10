/**
 * Peviitor API Module
 *
 * PURPOSE: Provides interface to Solr database via the peviitor API for
 * storing and retrieving job listings and company data.
 *
 * This module handles:
 * - Querying jobs by company CIF (via peviitor API)
 * - Querying/upserting company data (via peviitor API)
 * - Adding/updating (upserting) jobs (via peviitor API)
 * - Deleting jobs by CIF or URL (via peviitor API)
 *
 * All Solr operations go through the peviitor API — no direct Solr access.
 *
 * Solr Cores:
 * - job: Stores individual job listings (via API)
 * - company: Stores company metadata (via API gateway)
 */

import fetch from "node-fetch";
import { userAgent } from "./config/scraper.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

const API_BASE_URL = "https://api.peviitor.ro/v1";
const TIMEOUT = 10000;

// Retry policy for transient API failures (network errors, 429, 5xx).
// Base 2s, cap 60s, up to 5 attempts — collapsed to milliseconds under Jest so
// the unit tests that exercise the error path stay fast.
const IS_TEST = Boolean(process.env.JEST_WORKER_ID);
const MAX_RETRIES = IS_TEST ? 2 : 4;
const BASE_DELAY_MS = IS_TEST ? 2 : 2000;
const MAX_DELAY_MS = IS_TEST ? 10 : 60000;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Zero-pads a CIF to exactly 8 digits (Peviitor API requirement)
 */
function padCif(cif) {
  return String(cif).padStart(8, "0");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Full-jitter exponential backoff. Honours a numeric Retry-After (seconds)
 * when the server sent one, otherwise picks a random delay in
 * [0, min(cap, base * 2^attempt)] so concurrent retries don't thunder.
 */
function backoffDelayMs(attempt, retryAfter) {
  const secs = Number(retryAfter);
  if (Number.isFinite(secs) && secs >= 0) {
    return Math.min(secs * 1000, MAX_DELAY_MS);
  }
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return Math.random() * ceiling;
}

/**
 * fetch() with retry + backoff on transient failures. A thrown error
 * (network/timeout) or a retryable status (429, 5xx) triggers another attempt;
 * 4xx and success are handed back to the caller unchanged, which keeps the
 * existing `if (!res.ok) throw` error messages intact. Each attempt gets a
 * fresh AbortSignal timeout unless the caller supplied its own signal.
 */
async function fetchWithRetry(url, options = {}, label = "request") {
  let lastErr;
  let retryAfter = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = backoffDelayMs(attempt - 1, retryAfter);
      console.log(`  ${label}: retry ${attempt}/${MAX_RETRIES} after ${Math.round(delay)}ms (${lastErr?.message})`);
      await sleep(delay);
    }

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), ...options });

      if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_RETRIES) {
        retryAfter = typeof res.headers?.get === "function" ? res.headers.get("retry-after") : null;
        lastErr = new Error(`${label}: HTTP ${res.status}`);
        continue;
      }

      return res;
    } catch (err) {
      retryAfter = null;
      lastErr = err;
    }
  }

  throw lastErr;
}

// ============================================================================
// COMPANY OPERATIONS
// ============================================================================

/**
 * Searches for a company by CIF using the peviitor API
 */
export async function getCompanyByCif(cif) {
  const url = `${API_BASE_URL}/firme/company/?cif=${encodeURIComponent(padCif(cif))}`;
  const res = await fetch(url, {
    headers: { "User-Agent": userAgent }
  });

  if (!res.ok) {
    throw new Error(`API company search error: ${res.status}`);
  }

  const data = await res.json();
  if (!data.success) {
    throw new Error(`API company search failed: ${JSON.stringify(data)}`);
  }

  return data.data?.[0] || null;
}

/**
 * Searches for companies by name using the peviitor API
 */
export async function searchCompanyByName(name) {
  const url = `${API_BASE_URL}/firme/company/?name=${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": userAgent }
  });

  if (!res.ok) {
    throw new Error(`API company search error: ${res.status}`);
  }

  const data = await res.json();
  if (!data.success) {
    throw new Error(`API company search failed: ${JSON.stringify(data)}`);
  }

  return data.data || [];
}

/**
 * Upserts a company document via the peviitor API
 */
export async function upsertCompany(companyDoc) {
  const url = `${API_BASE_URL}/firme/company/add/`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": userAgent
    },
    body: JSON.stringify({ ...companyDoc, id: padCif(companyDoc.id) })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API company upsert error: ${res.status} - ${text}`);
  }

  const data = await res.json();
  if (!data.success) {
    throw new Error(`API company upsert failed: ${JSON.stringify(data)}`);
  }

  console.log(`✅ Company "${companyDoc.company}" upserted via API.`);
}

// ============================================================================
// JOB OPERATIONS
// ============================================================================

/**
 * Queries jobs from Solr by company CIF via the peviitor API
 */
export async function querySOLR(cif) {
  const url = `${API_BASE_URL}/scraper/jobs/?cif=${encodeURIComponent(padCif(cif))}&rows=500`;
  const res = await fetchWithRetry(url, {
    headers: { "User-Agent": userAgent }
  }, "jobs query");

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API jobs query error: ${res.status} - ${text}`);
  }

  const data = await res.json();

  return {
    numFound: data.total ?? 0,
    docs: data.data ?? []
  };
}

// ============================================================================
// DELETE OPERATIONS
// ============================================================================

/**
 * Deletes all jobs for a company by CIF via the peviitor API
 */
export async function deleteJobsByCIF(cif) {
  const url = `${API_BASE_URL}/scraper/jobs/delete/`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": userAgent
    },
    body: JSON.stringify({ cif: padCif(cif) })
  });

  if (res.status === 404) {
    console.log(`⚠️ No jobs found for CIF ${cif} — nothing to delete.`);
    return;
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API jobs delete error: ${res.status} - ${text}`);
  }

  const data = await res.json();
  console.log(`✅ Deleted ${data.count ?? 0} jobs for CIF ${cif} via API.`);
}

/**
 * Deletes a single job by its URL via the peviitor API
 */
export async function deleteJobByUrl(url) {
  const apiUrl = `${API_BASE_URL}/scraper/jobs/delete/`;
  const res = await fetch(apiUrl, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": userAgent
    },
    body: JSON.stringify({ url })
  });

  if (res.status === 404) {
    return;
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API jobs delete error: ${res.status} - ${text}`);
  }
}

// ============================================================================
// UPSERT OPERATIONS
// ============================================================================

/**
 * Upserts (adds or updates) jobs via the peviitor API
 */
export async function upsertJobs(jobs) {
  const url = `${API_BASE_URL}/scraper/jobs/upload/`;

  const paddedJobs = jobs.map(job => ({
    ...job,
    cif: padCif(job.cif)
  }));

  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": userAgent
    },
    body: JSON.stringify(paddedJobs)
  }, "jobs upload");

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API jobs upload error: ${res.status} - ${text}`);
  }

  const data = await res.json();
  console.log(`✅ Upserted ${data.count ?? jobs.length} jobs via API.`);
}

// ============================================================================
// URL VALIDATION
// ============================================================================

async function checkUrl(url) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { "User-Agent": userAgent }
    });
    return { url, status: res.status, valid: res.ok };
  } catch (err) {
    return { url, status: 0, valid: false, error: err.message };
  }
}

// ============================================================================
// VERIFICATION WORKFLOW
// ============================================================================

export async function runVerification(cif) {
  console.log("=== Verify SOLR Jobs ===\n");

  const result = await querySOLR(cif);
  console.log(`Total jobs in SOLR for CIF ${cif}: ${result.numFound}`);

  console.log("\nFirst 5 jobs:");
  result.docs.slice(0, 5).forEach((job, i) => {
    console.log(`${i+1}. ${job.title} (${job.location?.join(', ')}) - ${job.workmode}`);
  });

  const invalidUrls = [];
  for (let i = 0; i < result.docs.length; i++) {
    const job = result.docs[i];
    const res = await checkUrl(job.url);
    console.log(`[${i+1}/${result.docs.length}] ${res.status > 0 ? res.status : 'ERR'} - ${job.url}`);
    if (!res.valid) invalidUrls.push(job.url);
  }

  if (invalidUrls.length > 0) {
    console.log(`\n⚠️ ${invalidUrls.length} invalid URLs found - deleting via API...`);
    for (const url of invalidUrls) {
      await deleteJobByUrl(url);
    }
    console.log(`✅ Deleted ${invalidUrls.length} invalid jobs via API`);
  } else {
    console.log("\n✅ All URLs valid");
  }
}

// ============================================================================
// STANDALONE MODE
// ============================================================================

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("api.js")) {
  const args = process.argv.slice(2);

  if (args[0]) {
    await runVerification(args[0]);
  } else {
    console.error("Usage: node scraper/api.js <CIF>");
  }
}
