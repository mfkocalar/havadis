---
phase: 03-deduplication-classification-ranking
fixed_at: 2026-09-28T15:04:23Z
review_path: .planning/phases/03-deduplication-classification-ranking/03-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 03: Code Review Fix Report

**Fixed at:** 2026-09-28T15:04:23Z
**Source review:** .planning/phases/03-deduplication-classification-ranking/03-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (all Warning-tier; `fix_scope: critical_warning` excludes IN-01/IN-02)
- Fixed: 5 (3 in a prior session, 2 in this session)
- Skipped: 0

Note on scope: this run's isolated worktree/branch (`gsd-reviewfix/03-98972`) was created from `main` at commit `db06688`, which already contained WR-01/WR-02/WR-03 committed by a prior fixer session that was interrupted by an unrelated OAuth/infra error (not a work failure). This session verified those three commits were present at the branch tip, did not re-touch their lines, and fixed the two remaining findings (WR-04, WR-05).

## Fixed Issues

### WR-01: `summary`'s `item.content` fallback is not HTML-stripped like `contentSnippet`

**Files modified:** `src/lib/pipeline/normalize.ts`
**Commit:** `f910514` (prior session)
**Applied fix:** Stopped falling back to unstripped `item.content` for summary.

### WR-02: CVE sequence-number regex caps at 7 digits, silently truncating 8+-digit IDs

**Files modified:** `src/lib/pipeline/extractCves.ts`, `src/lib/cveChips.ts`
**Commit:** `f225a46` (prior session)
**Applied fix:** `CVE_PATTERN` now rejects 8+-digit CVE sequence numbers via a `(?!\d)` negative lookahead instead of truncating them into a shorter, still-valid-looking ID.

### WR-03: `getFrontPage`'s error path has zero logging

**Files modified:** `src/lib/pipeline/getFrontPage.ts`
**Commit:** `db06688` (prior session)
**Applied fix:** Added `console.error` logging of the caught failure before returning the `{ status: "error" }` variant, so a total/sustained failure is now visible in Vercel function logs even though the rendered page stays quiet by design (D-03).

### WR-04: `hasArticleAnchor` uses an exact, attribute-order-sensitive string match

**Files modified:** `test/productionPage.test.ts`
**Commit:** `101b335` (this session)
**Applied fix:** Extracted a shared `hasArticleAnchorTag(body)` helper that uses the same tag-then-substring approach already proven in the file's own NVD-anchor check — `matchAll(/<a\b[^>]*>/g)` to get each `<a>` tag, then independently test each tag for `target="_blank"` and `rel="noopener noreferrer"` rather than one exact adjacent/ordered regex. Replaced both call sites (the render-state test and the `data-section` ordering test) with this helper. Verified via `npx tsc --noEmit` (no errors in the modified file; one pre-existing, unrelated `layout.tsx` error was present before this edit and is untouched) and a manual re-read of the diff.

### WR-05: `frontpage.e2e.test.ts` makes unmocked live network calls with no opt-in gate

**Files modified:** `src/lib/pipeline/frontpage.e2e.test.ts`
**Commit:** `1d90228` (this session)
**Applied fix:** Added an `e2eOptions = { skip: process.env.E2E === "1" ? false : "<reason>" }` object, passed as the `node:test` options argument to all 7 `test()` calls in the file. By default (no `E2E` env var) every test in the suite now reports as explicitly skipped with a clear reason instead of attempting live network calls, so a network-restricted `npm test` no longer fails on infrastructure it doesn't control. Running `E2E=1 npm test` (or a scheduled job with egress) still exercises the suite against the live feeds as before. Verified by running `npx tsx --test src/lib/pipeline/frontpage.e2e.test.ts` without `E2E` set: all 7 tests report `skipped` with the expected reason string, 0 pass/fail/cancelled — confirming the gate works. Also confirmed via `npx tsc --noEmit` that no type errors were introduced in this file.

## Skipped Issues

None — all 5 in-scope (Warning-tier) findings were fixed.

---

_Fixed: 2026-09-28T15:04:23Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
