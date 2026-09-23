/**
 * Mirrors the Python template's tests/consistency/test_repo.py ::
 * test_required_workflows_exist -- a derived scraper must ship every
 * workflow the fleet-wide audit established as required, not just
 * scrape.yml/tests.yml (checked separately in repo.test.js).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const WORKFLOWS_DIR = path.resolve(ROOT, ".github/workflows");

const REQUIRED_WORKFLOWS = [
  "job-deep-validate.yml",
  "job-recovery-from-disaster.yml",
  "automation-template-sync-check.yml",
  "automation-health-summary.yml",
];

describe("Consistency: Required Workflows", () => {
  for (const file of REQUIRED_WORKFLOWS) {
    it(`must have ${file}`, () => {
      expect(fs.existsSync(path.join(WORKFLOWS_DIR, file))).toBe(true);
    });
  }
});
