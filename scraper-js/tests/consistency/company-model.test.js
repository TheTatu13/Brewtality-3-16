import fetch from "node-fetch";
import companyConfig from "../../scraper/config/company.js";
import { validateCompanyModel, COMPANY_MODEL_FIELDS } from "../../scraper/company.js";

/**
 * Validates the LIVE peviitor company-core record for this scraper's CIF
 * against COMPANY_MODEL_FIELDS. This is a consistency check on peviitor's
 * data, not on our own code -- it exists because a stale or malformed
 * company-core record is otherwise invisible until someone notices the
 * site's company filter behaving oddly (see the 2026-09-24 Hochland
 * investigation: a case-sensitivity bug meant this endpoint silently never
 * matched, and a fleet-adjacent scraper's company record sat stale for
 * weeks with nothing to flag it).
 */

const CIF = companyConfig.id;
// True only in the Brewtality-3-16 template itself, where setup.py hasn't
// filled in a real CIF yet -- never in a derived repo.
const IS_TEMPLATE_CHECKOUT = /\{\{.*\}\}/.test(CIF);

async function fetchLiveCompanyRecord() {
  const res = await fetch(`https://api.peviitor.ro/v1/firme/company/?cif=${CIF}`, {
    headers: { "User-Agent": "jest-test" }
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.data?.[0] || null;
}

describe("Company Model (live peviitor record)", () => {
  it("COMPANY_MODEL_FIELDS declares id and company as required", () => {
    const required = COMPANY_MODEL_FIELDS.filter((f) => f.required).map((f) => f.name);
    expect(required).toEqual(expect.arrayContaining(["id", "company"]));
  });

  it("live company-core record for this CIF matches the model", async () => {
    if (IS_TEMPLATE_CHECKOUT) {
      console.log("Running in the Brewtality-3-16 template itself (CIF not yet filled in) — skipping live check");
      return;
    }

    let record;
    try {
      record = await fetchLiveCompanyRecord();
    } catch (e) {
      console.log(`⚠️ Could not reach api.peviitor.ro (${e.message}) — skipping live check`);
      return;
    }

    if (!record) {
      console.log(`⚠️ No live company-core record yet for CIF ${CIF} — skipping (scraper may not have upserted it yet)`);
      return;
    }

    const { valid, errors, extraFields } = validateCompanyModel(record);

    if (extraFields.length > 0) {
      console.log(`Note: extra fields on live record (not in model): ${extraFields.join(", ")}`);
    }
    if (!valid) {
      console.log("Live company record validation errors:");
      errors.forEach((e) => console.log(`  - ${e}`));
    }

    expect(valid).toBe(true);
  }, 15000);

  it("live record's id matches this scraper's configured CIF", async () => {
    if (IS_TEMPLATE_CHECKOUT) {
      console.log("Running in the Brewtality-3-16 template itself (CIF not yet filled in) — skipping live check");
      return;
    }

    let record;
    try {
      record = await fetchLiveCompanyRecord();
    } catch (e) {
      console.log(`⚠️ Could not reach api.peviitor.ro (${e.message}) — skipping live check`);
      return;
    }
    if (!record) {
      console.log(`⚠️ No live company-core record yet for CIF ${CIF} — skipping`);
      return;
    }
    expect(record.id).toBe(CIF);
  }, 15000);
});
