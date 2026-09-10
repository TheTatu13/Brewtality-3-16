#!/usr/bin/env node
/**
 * Brewtality-3-16 — interactive derivation script.
 *
 *   node setup.js
 *
 * Asks for a language and the company details, then turns this template repo
 * *in place* into a ready-to-commit scraper for one company:
 *   - deletes the language folder you did not pick
 *   - promotes the one you did pick to the repo root
 *   - fills every {{PLACEHOLDER}} with your answers
 *   - names the package after the company
 *   - removes itself, the sibling setup.py and the template's git history
 *
 * Node built-ins only — no install step.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const ROOT = __dirname;
const SKIP_DIRS = new Set([".git", "node_modules", "__pycache__", ".pytest_cache", ".venv"]);

// ---------------------------------------------------------------------------
// prompt helper — works interactively (TTY) and with piped stdin
// ---------------------------------------------------------------------------

let ask;
let closeInput = () => {};

if (process.stdin.isTTY) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  ask = (q) => new Promise((res) => rl.question(q, (a) => res(a.trim())));
  closeInput = () => rl.close();
} else {
  // buffered: read everything, serve one line per prompt
  const lines = fs.readFileSync(0, "utf-8").split(/\r?\n/);
  let i = 0;
  ask = (q) => {
    process.stdout.write(q);
    const line = i < lines.length ? lines[i++] : "";
    process.stdout.write(line + "\n");
    return Promise.resolve(line.trim());
  };
}

async function prompt(label, { def = "", required = false } = {}) {
  const suffix = def ? ` [${def}]` : required ? " (required)" : " (optional, Enter to skip)";
  for (let attempt = 0; attempt < 100; attempt++) {
    const a = (await ask(`  ${label}${suffix}: `)) || def;
    if (a || !required) return a;
    console.log("    - this one is required.");
  }
  throw new Error(`no value provided for "${label}"`);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/\b(s\.?r\.?l\.?|s\.?a\.?|p\.?f\.?a\.?|s\.?n\.?c\.?|inc\.?|ltd\.?|llc)\b/g, "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function moveContents(fromDir, toDir) {
  for (const entry of fs.readdirSync(fromDir)) {
    const src = path.join(fromDir, entry);
    const dst = path.join(toDir, entry);
    rmrf(dst);
    fs.renameSync(src, dst);
  }
}

function replaceInFile(file, map) {
  let text;
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch {
    return; // unreadable / binary — skip
  }
  if (!text.includes("{{")) return;
  const out = text.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in map ? map[k] : m));
  if (out !== text) fs.writeFileSync(file, out, "utf-8");
}

function setJsonName(file, name) {
  if (!fs.existsSync(file)) return;
  const json = JSON.parse(fs.readFileSync(file, "utf-8"));
  json.name = name;
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n", "utf-8");
}

function setPyprojectName(file, name) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf-8").replace(/^name = ".*"$/m, `name = "${name}"`);
  fs.writeFileSync(file, text, "utf-8");
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\nBrewtality-3-16 - derive a scraper\n=================================\n");

  // 1. language
  let langInput = "";
  for (let attempt = 0; attempt < 20 && !["js", "py", "1", "2"].includes(langInput.toLowerCase()); attempt++) {
    langInput = (await ask("  JavaScript or Python?  (js / py  or  1 / 2): ")).toLowerCase();
  }
  if (!["js", "py", "1", "2"].includes(langInput)) throw new Error("no language chosen");
  const lang = ["js", "1"].includes(langInput) ? "js" : "py";
  const keepDir = lang === "js" ? "scraper-js" : "scraper-py";
  const dropDir = lang === "js" ? "scraper-py" : "scraper-js";

  if (!fs.existsSync(path.join(ROOT, keepDir))) {
    console.error(`\n  x ${keepDir}/ not found - run this from a fresh clone of the template.`);
    process.exit(1);
  }

  console.log(`\n  -> ${lang === "js" ? "JavaScript" : "Python"} it is. Now the company details:\n`);

  // 2. company details / placeholders
  const company = await prompt("Company legal name (UPPERCASE, e.g. EXAMPLE COMPANY SRL)", { required: true });
  const slug = slugify(company);
  const brand = await prompt("Commercial brand", { def: company.split(/\s+/)[0] });
  const cif = await prompt("CIF / CUI (digits only, no RO prefix)", { required: true });
  const website = await prompt("Company website (https://...)", { required: true }).then((s) => s.replace(/\/+$/, ""));
  const career = await prompt("Careers / open-positions page URL", { required: true });
  const sitemap = await prompt("Job sitemap URL (Enter if the site has none)");
  const jobPrefix = await prompt("Canonical job-permalink prefix", { def: `${website}/jobs/` });
  const city = await prompt("HQ city", { required: true });
  console.log("\n  CSS selectors - Enter to rely on the generic fallbacks and tune later:\n");
  const selArticle = await prompt("Primary selector for one job card/row");
  const selTitle = await prompt("Primary selector for the job title");
  const selMeta = await prompt("Primary selector for the deadline/meta text");
  console.log();
  const owner = await prompt("GitHub owner / org", { required: true });
  const repo = await prompt("GitHub repo name", { def: `${slug}-${lang === "js" ? "nodejs" : "python"}-scraper` });

  const map = {
    COMPANY_NAME: company,
    COMPANY_BRAND: brand,
    CIF: cif,
    WEBSITE_URL: website,
    CAREER_URL: career,
    SITEMAP_URL: sitemap,
    JOB_URL_PREFIX: jobPrefix,
    DEFAULT_CITY: city,
    SELECTOR_JOB_ARTICLE: selArticle,
    SELECTOR_JOB_TITLE: selTitle,
    SELECTOR_JOB_META: selMeta,
    GITHUB_OWNER: owner,
    GITHUB_REPO: repo,
  };

  console.log("\n  Summary\n  -------");
  console.log(`  language : ${lang === "js" ? "JavaScript (scraper-js)" : "Python (scraper-py)"}`);
  for (const [k, v] of Object.entries(map)) console.log(`  ${k.padEnd(20)} ${v || "(blank -> fallbacks)"}`);
  const ok = (await ask("\n  Apply? This rewrites the repo in place and cannot be undone. (y/N): ")).toLowerCase();
  if (ok !== "y" && ok !== "yes") {
    console.log("  Aborted - nothing changed.");
    closeInput();
    return;
  }

  closeInput();

  // 3. transform
  const pkgName = `${slug}-scraper`;

  rmrf(path.join(ROOT, dropDir));
  // template-only root files — the variant brings its own
  for (const f of [".github", "README.md", "CLAUDE.md", ".gitignore", "setup.py", ".git"]) {
    rmrf(path.join(ROOT, f));
  }
  moveContents(path.join(ROOT, keepDir), ROOT);
  rmrf(path.join(ROOT, keepDir));

  for (const file of walk(ROOT)) {
    if (path.basename(file) === "setup.js") continue;
    replaceInFile(file, map);
  }

  setJsonName(path.join(ROOT, "package.json"), pkgName);
  setPyprojectName(path.join(ROOT, "pyproject.toml"), pkgName);

  rmrf(path.join(ROOT, "setup.js"));

  // 4. done
  console.log(`\n  OK - Scraper generated for ${company} in ${lang === "js" ? "JavaScript" : "Python"}.`);
  console.log(`    package/module name: ${pkgName}`);
  console.log(`    intended repo:       github.com/${owner}/${repo}\n`);
  console.log("  Ready for the first commit:");
  console.log("    git init && git add -A && git commit -m \"Initial scraper for " + company + "\"");
  console.log(`    gh repo create ${owner}/${repo} --public --source=. --push\n`);
  console.log("  Next: tune the selectors in " + (lang === "js" ? "scraper/config/scraper.json" : "config/scraper.json"));
  console.log("        and adapt " + (lang === "js" ? "parseListing in scraper/index.js" : "parse_listing in scraper/parse.py") + ",");
  console.log("        then run the tests (" + (lang === "js" ? "npm install && npm run test:unit" : "pip install -e \".[dev]\" && pytest -q") + ").\n");
}

main().catch((err) => {
  console.error("\n  x", err.message);
  process.exit(1);
});
