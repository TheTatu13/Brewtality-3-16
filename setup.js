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
const { spawnSync } = require("child_process");
const http = require("http");
const https = require("https");

const ROOT = __dirname;
const SKIP_DIRS = new Set([".git", "node_modules", "__pycache__", ".pytest_cache", ".venv"]);
const SELECTOR_KEYWORD_RX = /job|position|career|vacan|post|listing|ofert|anunt/i;

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
// git: worktree detection + fresh independent history on `main`
// ---------------------------------------------------------------------------

// True if ROOT/.git is a linked-worktree pointer file, not a real git dir.
//
// A plain clone has .git/ as a directory. A linked `git worktree` checkout
// has .git as a *file* containing `gitdir: ...`. Deleting that pointer (as
// the transform step below does, to detach from the template's history)
// makes git silently fall through to whatever repo owns the parent
// directory - so `git add -A && git commit` afterwards could land in the
// template's own history instead of the new scraper's.
function isGitWorktree() {
  const gitPath = path.join(ROOT, ".git");
  let stat;
  try {
    stat = fs.lstatSync(gitPath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  let content;
  try {
    content = fs.readFileSync(gitPath, "utf-8").trim();
  } catch {
    return false;
  }
  if (!content.startsWith("gitdir:")) return false;
  const res = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: 5000,
  });
  if (res.error || res.status !== 0) return !res.error; // can't confirm via git, but the gitfile shape is enough
  return res.stdout.trim() === "true";
}

// Give the derived scraper its own, independent git history on `main`.
//
// Runs right after the old .git (template history, or a worktree's gitdir
// pointer) is removed, so there is no window where the folder could fall
// through to a parent repository. Branch name is forced to `main` via
// `symbolic-ref` (safe on a just-initialised repo with zero commits) rather
// than relying on the user's `init.defaultBranch` config, which may say
// `master` or anything else.
function reinitGit(wasWorktree) {
  const init = spawnSync("git", ["init", "-q"], { cwd: ROOT, encoding: "utf-8", timeout: 10000 });
  const branch =
    !init.error && init.status === 0
      ? spawnSync("git", ["symbolic-ref", "HEAD", "refs/heads/main"], {
          cwd: ROOT,
          encoding: "utf-8",
          timeout: 10000,
        })
      : null;
  if (init.error || init.status !== 0 || !branch || branch.error || branch.status !== 0) {
    const detail = init.error ? init.error.message : (init.stderr || "").trim() || "unknown error";
    console.log(
      `\n  ! could not initialise a fresh git repository automatically (${detail}).\n` +
        "    Run this yourself before committing:\n      git init -b main\n"
    );
    return;
  }
  const note = wasWorktree ? " (this clone was a git worktree - it now has its own, independent history)" : "";
  console.log(`\n  -> fresh git repo initialised on branch 'main'${note}.`);
}

// ---------------------------------------------------------------------------
// optional: best-effort CSS selector auto-detection
// ---------------------------------------------------------------------------

function fetchHtml(url, { timeoutMs = 10000, maxRedirects = 5 } = {}) {
  return new Promise((resolve) => {
    const attempt = (target, redirectsLeft) => {
      let parsed;
      try {
        parsed = new URL(target);
      } catch {
        console.log(`    - invalid URL (${target}).`);
        resolve(null);
        return;
      }
      const mod = parsed.protocol === "http:" ? http : https;
      const req = mod.get(
        target,
        { headers: { "User-Agent": "Mozilla/5.0 (compatible; Brewtality-setup/1.0)" }, timeout: timeoutMs },
        (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
            res.resume();
            attempt(new URL(res.headers.location, target).toString(), redirectsLeft - 1);
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            console.log(`    - could not fetch the page (HTTP ${res.statusCode}).`);
            res.resume();
            resolve(null);
            return;
          }
          let data = "";
          let size = 0;
          const cap = 2_000_000; // ~2MB, plenty for a listing page
          res.setEncoding("utf-8");
          res.on("data", (chunk) => {
            size += Buffer.byteLength(chunk);
            if (size > cap) {
              req.destroy();
              return;
            }
            data += chunk;
          });
          res.on("end", () => resolve(data));
        }
      );
      req.on("timeout", () => req.destroy(new Error("timed out")));
      req.on("error", (err) => {
        console.log(`    - could not fetch the page (${err.message}).`);
        resolve(null);
      });
    };
    attempt(url, maxRedirects);
  });
}

// Heuristic, regex-only (no deps yet) scan for a repeated job-card selector.
//
// Looks for a CSS class that (a) repeats at least 3 times, the way one
// card/row per job would, and (b) contains a job-related keyword. Falls
// back to counting <article> tags. Same heuristic as setup.py, by design.
function bestSelectorCandidate(html) {
  const counts = new Map();
  const classAttrRx = /class=["']([^"']+)["']/g;
  let m;
  while ((m = classAttrRx.exec(html))) {
    for (const tok of m[1].split(/\s+/).filter(Boolean)) {
      counts.set(tok, (counts.get(tok) || 0) + 1);
    }
  }
  let best = null;
  for (const [tok, count] of counts) {
    if (count >= 3 && SELECTOR_KEYWORD_RX.test(tok)) {
      if (!best || count > best.count) best = { token: tok, count };
    }
  }
  if (best) return { selector: `.${best.token}`, count: best.count };
  const articleCount = (html.match(/<article[\s>]/gi) || []).length;
  if (articleCount >= 3) return { selector: "article", count: articleCount };
  return null;
}

async function detectJobSelector(careerUrl) {
  console.log("\n    fetching the careers page ...");
  const html = await fetchHtml(careerUrl);
  if (html == null) return "";
  const candidate = bestSelectorCandidate(html);
  if (!candidate) {
    console.log("    - no confident candidate found; keeping the generic fallbacks.");
    return "";
  }
  const { selector, count } = candidate;
  const accept = (
    await ask(
      `    Found \`${selector}\` repeated ${count}x on the page - use it as the ` +
        "primary job-card selector? (Y/n): "
    )
  ).toLowerCase();
  if (accept === "" || accept === "y" || accept === "yes" || accept === "da") return selector;
  console.log("    - discarded; keeping the generic fallbacks.");
  return "";
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\nBrewtality-3-16 - derive a scraper\n=================================\n");

  const wasWorktree = isGitWorktree();
  if (wasWorktree) {
    console.log(
      "  ! detected: this clone's .git is a worktree pointer, not a real git\n" +
        "    directory. That's fine - this script gives the derived scraper its\n" +
        "    own independent git history (step 3 below), so nothing can leak\n" +
        "    into the worktree's parent repository.\n"
    );
  }

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

  let detectedArticle = "";
  const tryDetect = (
    await ask("  Try to auto-detect a CSS selector for job cards by fetching this page now? (y/N): ")
  ).toLowerCase();
  if (["y", "yes", "da"].includes(tryDetect)) {
    detectedArticle = await detectJobSelector(career);
  }

  const sitemap = await prompt("Job sitemap URL (Enter if the site has none)");
  const jobPrefix = await prompt("Canonical job-permalink prefix", { def: `${website}/jobs/` });
  const city = await prompt("HQ city", { required: true });
  console.log("\n  CSS selectors - Enter to rely on the generic fallbacks and tune later:\n");
  const selArticle = await prompt("Primary selector for one job card/row", { def: detectedArticle });
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
  for (const f of [
    ".github", "README.md", "CLAUDE.md", ".gitignore", "setup.py",
    // fleet-management files that live at the template root only -- a
    // derived repo gets none of this (bug found by
    // tools/derive_new_scraper.py's first real test run: these were
    // silently carried into the derived repo because this list never got
    // updated when Faza 4 added them to the template root).
    "SCRAPERS.md", "DEFINITION_OF_DONE.md", "fleet.json", "tools", "changes",
  ]) {
    rmrf(path.join(ROOT, f));
  }
  rmrf(path.join(ROOT, ".git"));
  reinitGit(wasWorktree);
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
  console.log("    git add -A && git commit -m \"Initial scraper for " + company + "\"");
  console.log(`    gh repo create ${owner}/${repo} --public --source=. --push\n`);
  console.log("  IMPORTANT -- gh repo create does NOT set these, and the consistency");
  console.log("  tests in CI will fail on first push without them (see ai/UPDATE-REPO-ABOUT.md):");
  console.log(`    gh repo edit ${owner}/${repo} --add-topic job-seeker-ro-spider --add-topic peviitor-ro \\`);
  console.log(`      --homepage "https://${owner.toLowerCase()}.github.io/${repo}/" \\`);
  console.log(`      --description "Scraper pentru ${company} - peViitor.ro"`);
  console.log(`    gh api -X POST repos/${owner}/${repo}/pages -f build_type=legacy -f "source[branch]=main" -f "source[path]=/docs"\n`);
  console.log("  Also apply branch protection (blocks force-push + deletion on main;");
  console.log("  does NOT require PRs/reviews -- this fleet pushes directly to main):");
  console.log(`    gh api -X PUT repos/${owner}/${repo}/branches/main/protection \\`);
  console.log("      -F required_status_checks=null -F enforce_admins=false \\");
  console.log("      -F required_pull_request_reviews=null -F restrictions=null \\");
  console.log("      -F allow_force_pushes=false -F allow_deletions=false\n");
  console.log("  Next: tune the selectors in " + (lang === "js" ? "scraper/config/scraper.json" : "config/scraper.json"));
  console.log("        and adapt " + (lang === "js" ? "parseListing in scraper/index.js" : "parse_listing in scraper/parse.py") + ",");
  console.log("        then run the tests (" + (lang === "js" ? "npm install && npm run test:unit" : "pip install -e \".[dev]\" && pytest -q") + ").");
  console.log("\n  This scraper isn't done until DEFINITION_OF_DONE.md's checklist is");
  console.log("  clear (it didn't come along in the derivation -- it's a template-repo");
  console.log("  doc, not a per-scraper one; read it at github.com/TheTatu13/Brewtality-3-16).\n");
}

main().catch((err) => {
  console.error("\n  x", err.message);
  process.exit(1);
});
