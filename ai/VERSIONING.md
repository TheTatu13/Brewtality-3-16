# Template versioning: `@v1` and beyond

Every derived scraper's caller workflows (`scrape.yml`, `tests.yml`,
`automation-health-summary.yml`) reference the template's reusable
workflows by tag, e.g.:

```yaml
uses: TheTatu13/Brewtality-3-16/.github/workflows/scrape-reusable.yml@v1
```

`v1` is a **floating tag** — it gets moved forward (`git tag -f v1 <sha> &&
git push origin v1 --force`) whenever a fix or improvement lands in a
reusable workflow. Every derived repo picks it up automatically on its
*next scheduled run* — that's the entire point of the reusable-workflow
architecture (see `scrape-reusable.yml`'s own header comment): a fix
written once reaches every scraper without touching N repos.

## When to move `v1` forward (the common case)

Any backward-compatible fix or addition: a bug fix in `scrape-reusable.yml`,
a new step, a new reusable workflow (like `health-summary-reusable.yml`).
Move the tag right after merging to `main`, same commit range. This is
what happened for every fix in this fleet's Faza 2/3 audit — no derived
repo needed a single edit to pick up the sync-check fix or gain the
health-summary workflow; only their own thin caller files needed adding
once, and only because those files didn't exist yet at all.

## When to cut `v2` instead (the rare case)

A **breaking** change to a reusable workflow's inputs/outputs/behavior that
an existing caller can't absorb silently — e.g. renaming the `dry_run`
input, changing what `scrape-reusable.yml` writes back to the repo, or a
new *required* input with no default. In that case:

1. Cut `v2` pointing at the new commit; leave `v1` where it is.
2. Update `scraper-js/.github/workflows/*.yml` and
   `scraper-py/.github/workflows/*.yml` (the master caller copies new
   scrapers derive from) to reference `@v2`.
3. Migrate existing derived repos to `@v2` deliberately, one at a time or
   in a batch — this is the one case where a real "fix N repos" pass is
   correct, because a floating tag can't silently carry a breaking change
   without risking a scraper waking up broken on its next scheduled run.
4. Document the breaking change and the migration in the template's
   CHANGELOG under a `### Changed` heading, explicitly calling out that
   it's `@v2`-only.

## Checking what's actually pinned where

```bash
gh api search/code -q 'repo:TheTatu13/<repo> "Brewtality-3-16/.github/workflows" language:YAML' \
  --jq '.items[].path'
# then grep the matched files for the @vN suffix
```

Or simpler, since every derived repo's caller files are ~20 lines: just
`grep -r "Brewtality-3-16/.github/workflows" .github/workflows/` in each
repo. There is currently no automated fleet-wide report of "which repo is
pinned to which tag" — see the scraper registry doc (`SCRAPERS.md`) for
the closest thing, which is a point-in-time snapshot, not a live query.
