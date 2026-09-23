/**
 * A derived repo's first commit must have every {{PLACEHOLDER}} filled in by
 * setup.js. One surviving here means setup.js was skipped, aborted partway,
 * or a file it doesn't touch still has a stray token pasted from the
 * template. Skipped in the template itself (Brewtality-3-16), where these
 * tokens are the entire point -- detected via package.json's name, which
 * setup.js always rewrites away from "peviitor-scraper-template" as one of
 * its last edits.
 *
 * Also checks COMMIT_CHECKLIST.md exists -- it lives one level up from here
 * (monorepo root) in the template checkout, but at true repo root once
 * setup.js promotes scraper-js/ there, same as everything else.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SKIP_DIRS = new Set(["node_modules", ".git", "tmp", "coverage"]);
// Excludes the literal "PLACEHOLDER" token itself: real substitutable
// fields are named things like {{COMPANY_NAME}} or {{CIF}}; "{{PLACEHOLDER}}"
// is only ever used as meta-language describing the convention (in docs,
// comments, this file's own error message), never an actual field.
const PLACEHOLDER_RX = /\{\{(?!PLACEHOLDER\}\})[A-Z_]+\}\}/;
const SELF_PATH = fileURLToPath(import.meta.url);

function isTemplateCheckout() {
  const pkgPath = path.join(ROOT, "package.json");
  if (!fs.existsSync(pkgPath)) return false;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  return pkg.name === "peviitor-scraper-template";
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

describe("Consistency: No Leftover Placeholders", () => {
  it("must have COMMIT_CHECKLIST.md", () => {
    if (isTemplateCheckout()) return; // lives at the monorepo root here, not this folder
    expect(fs.existsSync(path.join(ROOT, "COMMIT_CHECKLIST.md"))).toBe(true);
  });

  it("must have no surviving {{PLACEHOLDER}} tokens", () => {
    if (isTemplateCheckout()) return; // placeholders are the entire point here

    const hits = [];
    for (const file of walk(ROOT)) {
      if (file === SELF_PATH) continue; // this file discusses the {{TOKEN}} convention itself
      let text;
      try {
        text = fs.readFileSync(file, "utf-8");
      } catch {
        continue; // binary file
      }
      if (PLACEHOLDER_RX.test(text)) hits.push(path.relative(ROOT, file));
    }
    expect(hits).toEqual([]);
  });
});
