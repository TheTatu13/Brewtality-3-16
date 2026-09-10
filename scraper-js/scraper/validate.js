/**
 * Pre-publish data validation.
 *
 * "Bad data is worse than missing data" — a job with an empty title or a
 * garbage URL pollutes the peviitor index and is hard to clean up later. Every
 * scraped job passes through `validateJob` before it is mapped to the job model
 * and upserted; `filterValidJobs` drops the failures and logs exactly why.
 *
 * Reused as-is by derived scrapers — the rules are peviitor-wide, not
 * site-specific.
 */

const MAX_TITLE_LEN = 200;

/**
 * @param {object} job  a raw scraped job ({ url, title, location?, salary?, ... })
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateJob(job) {
  const errors = [];

  if (!job || typeof job !== "object") {
    return { valid: false, errors: ["job is not an object"] };
  }

  // --- url: required, must be a real http(s) URL --------------------------
  if (typeof job.url !== "string" || job.url.trim() === "") {
    errors.push("url is empty");
  } else {
    try {
      const u = new URL(job.url);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        errors.push(`url has non-http(s) protocol: ${u.protocol}`);
      }
    } catch {
      errors.push(`url is not a valid URL: ${job.url}`);
    }
  }

  // --- title: required, non-empty, no markup, bounded length -------------
  if (typeof job.title !== "string" || job.title.trim() === "") {
    errors.push("title is empty");
  } else {
    if (/<[a-z][\s\S]*>/i.test(job.title)) errors.push("title contains HTML");
    if (job.title.trim().length > MAX_TITLE_LEN) {
      errors.push(`title exceeds ${MAX_TITLE_LEN} chars`);
    }
  }

  // --- location: optional, but if present must be non-empty strings ------
  if (job.location !== undefined) {
    if (!Array.isArray(job.location)) {
      errors.push("location is not an array");
    } else if (job.location.some((l) => typeof l !== "string" || l.trim() === "")) {
      errors.push("location has an empty entry");
    }
  }

  // --- salary: optional, must be a string, non-negative if numeric ------
  //   A "-" between two digits ("5000-8000") is a range separator; only a "-"
  //   at the start or after whitespace/"(" / ":" is a real negative sign.
  if (job.salary !== undefined) {
    if (typeof job.salary !== "string") {
      errors.push("salary is not a string");
    } else if (/(?:^|[\s(:])-\s*\d/.test(job.salary)) {
      errors.push(`salary has a negative amount: ${job.salary}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Split jobs into the ones worth publishing and the ones to drop, logging
 * each rejection.
 *
 * @returns {{kept: object[], dropped: Array<{job: object, errors: string[]}>}}
 */
export function filterValidJobs(jobs) {
  const kept = [];
  const dropped = [];

  for (const job of jobs) {
    const { valid, errors } = validateJob(job);
    if (valid) {
      kept.push(job);
    } else {
      dropped.push({ job, errors });
      console.warn(`  [validate] dropped "${job?.title ?? "?"}" (${job?.url ?? "no url"}): ${errors.join("; ")}`);
    }
  }

  if (dropped.length) {
    console.warn(`  [validate] ${dropped.length}/${jobs.length} job(s) failed validation and were dropped`);
  }
  return { kept, dropped };
}

/**
 * Canary — a run that scrapes nothing from any source almost always means the
 * page structure changed, not that the company genuinely has zero openings.
 * Throw before any file is written or any API call is made.
 *
 * @param {number|Array} jobsOrCount
 */
export function assertScrapeYieldedJobs(jobsOrCount) {
  const count = Array.isArray(jobsOrCount) ? jobsOrCount.length : Number(jobsOrCount);
  if (!count) {
    throw new Error(
      "canary: 0 jobs scraped from all sources — aborting before any write " +
      "(a broken listing selector is far more likely than a company with no jobs)"
    );
  }
  return count;
}
