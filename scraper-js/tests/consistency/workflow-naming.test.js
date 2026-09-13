/**
 * Consistency tests for .github/workflows/ naming, and cross-checking that
 * docs/index.html never links to a workflow file that doesn't actually exist.
 *
 * Mirrors the Python template's tests/consistency/test_workflow_naming.py --
 * this is the check that would have caught docs/index.html referencing
 * job-seeker-ro-spider.yml / automation-testing.yml (this template's OLD
 * workflow names) after the real files were renamed to scrape.yml / tests.yml.
 * Deliberately does not hardcode either name: what matters is that whatever
 * files exist are named descriptively and that every link in docs/index.html
 * points at one of them.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const WORKFLOWS_DIR = path.resolve(ROOT, ".github/workflows");
const INDEX_HTML = path.resolve(ROOT, "docs/index.html");

const WORKFLOW_LINK_RX = /actions\/workflows\/([a-zA-Z0-9_.-]+\.yml)/g;

function workflowFiles() {
  return fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith(".yml")).sort();
}

describe("Consistency: Workflow File Naming", () => {
  it("should not have a generic test.yml", () => {
    expect(workflowFiles()).not.toContain("test.yml");
  });

  it("should have lowercase, hyphen-separated workflow names", () => {
    for (const f of workflowFiles()) {
      expect(f).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*\.yml$/);
    }
  });

  it("docs/index.html should never link a workflow that doesn't exist", () => {
    if (!fs.existsSync(INDEX_HTML)) return; // no docs page in this checkout

    const html = fs.readFileSync(INDEX_HTML, "utf-8");
    const referenced = new Set([...html.matchAll(WORKFLOW_LINK_RX)].map(m => m[1]));
    const existing = new Set(workflowFiles());

    const missing = [...referenced].filter(f => !existing.has(f));
    expect(missing).toEqual([]);
  });
});
