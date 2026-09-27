---
phase: 03-deduplication-classification-ranking
plan: 02
subsystem: deduplication
tags: [nextjs, typescript, dedupe, union-find, html-entities, tdd]

# Dependency graph
requires:
  - phase: 03-deduplication-classification-ranking
    provides: "03-01's composeFrontPage seam (classify -> groupBySection), Section/ClassifiedArticle types, TIER_WEIGHT config"
provides:
  - "decodeHtmlEntities() — hand-rolled, zero-import, bounded-regex HTML entity decoder"
  - "normalize.ts's title now entity-decoded exactly once (D-04), closing the STATE.md CrowdStrike &trade; blocker"
  - "canonicalizeUrl() — dedupe comparison-key builder (scheme/host-case/fragment/trailing-slash/tracking-param insensitive)"
  - "normalizeTitleForDedupe() — NFKC/lowercase/punctuation-fold title comparison-key builder"
  - "dedupe() — path-compressed union-find over the canonical-URL-or-normalized-title equivalence relation, D-02 earliest-wins tiebreak"
  - "composeFrontPage() now dedupes before classifying — page.tsx's key={article.url} is provably unique post-dedupe"
  - "hermetic fixture suites (decodeHtmlEntities.test.ts, dedupe.test.ts, canonicalizeUrl.test.ts, normalizeTitleForDedupe.test.ts, getFrontPage.test.ts) plus a live e2e uniqueness invariant"
affects: [03-03-cve-chips, 04-ui-filter-and-counts]

# Actuals (#2632)
actuals:
  tokens: 11900
  tasks: 3
  commits: 5
  plan_head_before: 4b0469ca133c73611a716f6ebb4bcb18b7cea8f2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Zero-import pure string transform (decodeHtmlEntities, canonicalizeUrl, normalizeTitleForDedupe), same shape as truncateSummary.ts"
    - "Path-compressed union-find for an 'either key matches' equivalence relation, rather than two independent Maps, to correctly catch transitive duplicate chains"
    - "Comparison keys (canonical URL, normalized title) are ALWAYS internal to a pipeline stage — never assigned to a field, never replace the rendered url/title"
    - "RED-GREEN TDD per task: failing test file committed first (module-not-found confirmed as the intentional RED), then the implementation as a separate feat commit"

key-files:
  created:
    - src/lib/pipeline/decodeHtmlEntities.ts
    - src/lib/pipeline/decodeHtmlEntities.test.ts
    - src/lib/pipeline/canonicalizeUrl.ts
    - src/lib/pipeline/canonicalizeUrl.test.ts
    - src/lib/pipeline/normalizeTitleForDedupe.ts
    - src/lib/pipeline/normalizeTitleForDedupe.test.ts
    - src/lib/pipeline/dedupe.ts
    - src/lib/pipeline/dedupe.test.ts
    - src/lib/pipeline/getFrontPage.test.ts
  modified:
    - src/lib/pipeline/normalize.ts
    - src/lib/pipeline/normalize.test.ts
    - src/lib/pipeline/truncateSummary.ts
    - src/lib/pipeline/getFrontPage.ts
    - src/lib/pipeline/frontpage.e2e.test.ts

key-decisions:
  - "decodeHtmlEntities is a single ~15-entry named-entity map plus a numeric (decimal/hex) branch via String.fromCodePoint, all under one bounded, linear-time regex — no new dependency, per STACK.md's dependency-minimalism bias and 03-RESEARCH.md's Package Legitimacy Audit flagging entities@latest as too-new/SUS."
  - "normalize.ts decodes the title before trimming (decode-then-trim), so an entity-encoded leading/trailing &nbsp; is trimmed away too; an empty-after-decode title returns null exactly like a missing title."
  - "dedupe() uses path-compressed union-find over two key maps (canonical URL, normalized title), per 03-RESEARCH.md Pattern 1 — two independent Maps checked sequentially would silently under-dedupe a transitive 3+-outlet chain."
  - "D-02's tiebreak (earliest publishedAt -> higher TIER_WEIGHT -> earlier input index) treats an unparseable publishedAt as +Infinity, so a malformed date can never win over a copy with a valid date, and the winner is fully order-independent for identical inputs."
  - "canonicalizeUrl compares on host (not hostname), which preserves a non-default port as a distinguishing key, while dropping scheme and fragment and stripping tracking params + trailing slash — never throws, falling back to the trimmed raw string on a parse failure (T-03-10)."
  - "normalizeTitleForDedupe deliberately does not decode entities — it operates on the already-decoded Article.title, so a second decode pass never runs (single-decode-point guarantee, D-04)."
  - "Task 3's edge-case test files (canonicalizeUrl.test.ts, normalizeTitleForDedupe.test.ts, getFrontPage.test.ts) needed zero implementation changes — Task 2's dedupe/canonicalizeUrl/normalizeTitleForDedupe already satisfied every pinned edge on first run, the same 'lock already-correct behavior' pattern 03-01's Task 3 established; both commits are test(03-02), not feat(03-02)."
  - "[Rule 3 - Blocking] Ran npm ci in this freshly created worktree before any build/test/lint verify command — no node_modules existed at all (same known worktree-creation gap 03-01 hit). Restores the exact versions already pinned in the committed package-lock.json (365 packages, 0 vulnerabilities); no new or unpinned package introduced, so this is not the package-legitimacy exclusion."

requirements-completed: [NORM-02]

coverage:
  - id: D1
    description: "decodeHtmlEntities(): hand-rolled named+numeric HTML entity decoder, linear-time/ReDoS-safe, wired into normalize.ts's title (closes STATE.md CrowdStrike &trade; blocker)"
    requirement: "NORM-02"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/decodeHtmlEntities.test.ts (16 tests: named/decimal/hex entities, trademark case, unknown/malformed/out-of-range/surrogate entities left untouched, single-pass decoding, markup-looking-entity-to-plain-text, 200K-char timing guard)"
        status: pass
      - kind: unit
        ref: "src/lib/pipeline/normalize.test.ts (6 new tests: decode-once, trademark, decode-then-trim, whitespace-only-title-to-null, summary-not-redecoded)"
        status: pass
    human_judgment: false
  - id: D2
    description: "dedupe(): union-find over canonical-URL-or-normalized-title equivalence, D-02 earliest-then-tier-then-order tiebreak, silent D-03 collapse returning original references"
    requirement: "NORM-02"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/dedupe.test.ts (16 tests: exact/URL-only/title-only match, transitive chain, D-02 tiebreak chain incl. either input order, order preservation, ShinyHunters negative case, empty/single edges, idempotency, reference-identity/six-key/unchanged-url, empty-title-key non-participation, malformed-date safety, no-mutation)"
        status: pass
    human_judgment: false
  - id: D3
    description: "canonicalizeUrl()/normalizeTitleForDedupe(): the two comparison-key builders, edge-pinned (scheme/host-case/fragment/trailing-slash/tracking-params/query-order/path-case/port/malformed-URL; NFKC fullwidth/ligature/curly-quote/nbsp folding, no second entity decode, emoji-only empty key)"
    requirement: "NORM-02"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/canonicalizeUrl.test.ts (13 tests) + src/lib/pipeline/normalizeTitleForDedupe.test.ts (9 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "composeFrontPage() dedupes before classifying; the three-outlet Foo Corp fixture proves the collapse through the composed pipeline (ROADMAP SC-1)"
    requirement: "NORM-02"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/getFrontPage.test.ts (4 tests: three-outlet Foo Corp collapse to one Breaches article, ShinyHunters two-card survival, empty-input ok variant, n-distinct-stories SECTION_DISPLAY_ORDER + flatten equality)"
        status: pass
      - kind: e2e
        ref: "src/lib/pipeline/frontpage.e2e.test.ts (new test: post-dedupe every article.url, canonicalizeUrl key, and non-empty normalizeTitleForDedupe key is unique on live feed data — the assumption-delta invariant)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Reader-level 'does the page read as de-duplicated' visual check (Task 3's <human-check>)"
    requirement: "NORM-02"
    verification: []
    human_judgment: true
    rationale: "Whether the page reads as de-duplicated on today's live headlines is a reader-level judgment, not a grep-checkable fact (Task 3's own <human-check> clause). human_verify_mode=end-of-phase defers this to end-of-phase UAT harvesting rather than a synthesized mid-plan checkpoint; the automated sibling (npm run lint) ran clean this session."

duration: ~30min
completed: 2026-09-27
status: complete
---

# Phase 3 Plan 2: Deduplication and Entity Decoding Summary

**Titles now decode their HTML entities exactly once in `normalize.ts` (closing the CrowdStrike `&trade;` blocker), and a new union-find `dedupe()` stage collapses the same story arriving from several outlets down to its single earliest copy — proven through a three-outlet composed-pipeline fixture and a live uniqueness invariant against today's real feed data.**

## Performance

- **Duration:** ~30min
- **Started:** 2026-09-27T09:22:00Z (approx.)
- **Completed:** 2026-09-27T09:31:00Z (task commits) + verification/build time
- **Tasks:** 3/3 complete
- **Files modified:** 14 (9 created, 5 modified)

## Accomplishments

- `decodeHtmlEntities.ts` decodes HTML/XML named and numeric entities in one bounded, linear-time regex pass, wired into `normalize.ts`'s title construction — closing the STATE.md "CrowdStrike `&trade;`" blocker and giving `NORM-02`'s dedupe stage an already-decoded title to key on.
- `canonicalizeUrl.ts` and `normalizeTitleForDedupe.ts` build the two comparison keys D-01 needs (scheme/host-case/fragment/trailing-slash/tracking-param-insensitive URL key; NFKC/lowercase/punctuation-folded title key), never replacing the displayed `url`/`title`.
- `dedupe.ts` collapses the "shares a canonical URL OR a normalized title" equivalence relation via path-compressed union-find, correctly catching transitive multi-outlet chains that two independent maps would miss, and picks the D-02 winner (earliest `publishedAt`, then higher `TIER_WEIGHT`, then earlier input order) — silently (D-03), returning the original `Article` object unmodified.
- `composeFrontPage()` now dedupes before classifying, so `page.tsx`'s `key={article.url}` React key is provably unique once dedupe runs — proven by a three-outlet Foo Corp fixture collapsing to one Breaches card end to end, and a new live e2e assertion that no two post-dedupe articles share a `url`, a canonical URL key, or a non-empty normalized title key.

## Task Commits

Each task was committed atomically (RED test commit, then GREEN implementation commit):

1. **Task 1: Readers see publisher titles with HTML entities decoded (D-04)**
   - `e81ad22` (test) — failing `decodeHtmlEntities.test.ts`, confirmed RED via `ERR_MODULE_NOT_FOUND`
   - `49e6ccb` (feat) — `decodeHtmlEntities.ts` + `normalize.ts`/`normalize.test.ts`/`truncateSummary.ts` wiring, GREEN
2. **Task 2: Show the same story from several outlets once (NORM-02)**
   - `d97690c` (test) — failing `dedupe.test.ts`, confirmed RED via `ERR_MODULE_NOT_FOUND`
   - `e552e6b` (feat) — `canonicalizeUrl.ts` + `normalizeTitleForDedupe.ts` + `dedupe.ts` + `getFrontPage.ts` wiring, GREEN
3. **Task 3: Pin dedupe-key edges and prove the collapse through the composed pipeline and the live page**
   - `9bfef3f` (test) — `canonicalizeUrl.test.ts`, `normalizeTitleForDedupe.test.ts`, `getFrontPage.test.ts` (new), `frontpage.e2e.test.ts` (extended) — all passed on first run against Task 2's already-correct implementation

**Plan metadata:** commit created after this SUMMARY (see below)

_Note: Task 3's tests needed no implementation change (Task 2's modules already satisfied every pinned edge case), so both of its commits (the test file additions) are `test(03-02)` rather than `feat(03-02)` — the same pattern 03-01's Task 3 established._

## Files Created/Modified

- `src/lib/pipeline/decodeHtmlEntities.ts` - zero-import HTML entity decoder (D-04)
- `src/lib/pipeline/decodeHtmlEntities.test.ts` - 16 hermetic tests
- `src/lib/pipeline/normalize.ts` - title now `decodeHtmlEntities(item.title).trim()`; empty-after-decode -> `null`
- `src/lib/pipeline/normalize.test.ts` - rewrote the pre-D-04 verbatim-entity test, added 4 new D-04 tests
- `src/lib/pipeline/truncateSummary.ts` - comment-only fix (stale "title kept as a plain trim" claim)
- `src/lib/pipeline/canonicalizeUrl.ts` - URL dedupe comparison-key builder
- `src/lib/pipeline/canonicalizeUrl.test.ts` - 13 hermetic edge tests
- `src/lib/pipeline/normalizeTitleForDedupe.ts` - title dedupe comparison-key builder
- `src/lib/pipeline/normalizeTitleForDedupe.test.ts` - 9 hermetic edge tests
- `src/lib/pipeline/dedupe.ts` - union-find dedupe stage (NORM-02, D-01/D-02/D-03)
- `src/lib/pipeline/dedupe.test.ts` - 16 hermetic fixture tests
- `src/lib/pipeline/getFrontPage.ts` - `composeFrontPage` dedupes before classifying
- `src/lib/pipeline/getFrontPage.test.ts` - 4 hermetic composed-pipeline tests (new)
- `src/lib/pipeline/frontpage.e2e.test.ts` - added the live post-dedupe uniqueness invariant

## Decisions Made

See `key-decisions` in frontmatter for the full list. Summary: the entity decoder is a small named-entity map plus a numeric branch, no new dependency; `normalize.ts` decodes then trims so an entity-encoded nbsp trims away; `dedupe.ts` uses union-find (not two independent maps) specifically to catch transitive multi-outlet chains; D-02's tiebreak treats a malformed date as +Infinity so it never wins; `canonicalizeUrl` compares on `host` (preserving port) and never throws; `normalizeTitleForDedupe` deliberately never re-decodes entities; Task 3's edge tests needed zero implementation changes; and `npm ci` was run once to restore this freshly created worktree's pinned `node_modules` (Rule 3, not the package-legitimacy exclusion).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Ran `npm ci` in this worktree before any build/test/lint verify command**
- **Found during:** Task 1, running `npm run build`.
- **Issue:** This git worktree was created fresh with no `node_modules` at all (the same gap 03-01's Task 3 hit) — Turbopack's hermetic build resolution refuses to resolve `next` from an ancestor directory outside the worktree.
- **Fix:** Ran `npm ci`, restoring the exact versions already pinned in the committed `package-lock.json` (365 packages, 0 vulnerabilities). No new or unpinned package was introduced, so this is not the package-legitimacy exclusion in Rule 3's own carve-out.
- **Files modified:** none tracked by git (`node_modules/` is gitignored).
- **Verification:** `npm run build`, `npm test` (176/176 pass), and `npm run lint` (clean) all subsequently succeeded.

### Out-of-scope items (not fixed, logged only)

**2. [Pre-existing, out of scope] Krebs on Security `fetchSource` content-type gate**
- Re-confirmed still present (per `deferred-items.md` from 03-01) but out of this plan's `files_modified` scope; not touched. This session's live e2e run happened to succeed against Krebs regardless — the underlying `allowHtmlContentType` gap remains unresolved and still flagged for a future plan/maintainer.

---

**Total deviations:** 1 auto-fixed (1 blocking, environment-only, no tracked files changed), plus 1 pre-existing out-of-scope item re-confirmed.
**Impact on plan:** No scope creep; both were necessary purely to run this worktree's own verification commands or were explicitly out of file scope.

## Issues Encountered

None beyond the `npm ci` blocker above, resolved immediately.

## User Setup Required

None — no external service configuration required.

## Blocker Closed

**The STATE.md "CrowdStrike `&trade;`" blocker is now CLOSED by Task 1 (D-04).** `normalize.ts`'s title is now `decodeHtmlEntities(item.title).trim()`, decoded exactly once, before it is used as both the display string and the dedupe input. The orchestrator should clear this entry from STATE.md's Blockers/Concerns section after merge.

## Next Phase Readiness

- `dedupe()` runs as `composeFrontPage`'s first stage, ahead of `classify`/`groupBySection`, so Plan 03-03 (CVE chips) composes on an already-deduplicated, already-decoded article list without any reshaping of the pipeline seam.
- NORM-02 is fully proven: 16 hermetic dedupe fixture tests, 22 hermetic edge-case tests across the two key builders, 4 hermetic composed-pipeline tests, and a live e2e uniqueness invariant against today's real feed data.
- One coverage item (D5: reader-level "does the page read as de-duplicated" visual check) is flagged `human_judgment: true` and will surface at end-of-phase UAT per `human_verify_mode=end-of-phase` — nothing further needed from this plan to unblock 03-03.
- Ready for 03-03.

## Self-Check: PASSED

- FOUND: `src/lib/pipeline/decodeHtmlEntities.ts`
- FOUND: `src/lib/pipeline/dedupe.ts`
- FOUND: `src/lib/pipeline/canonicalizeUrl.ts`
- FOUND: `src/lib/pipeline/normalizeTitleForDedupe.ts`
- FOUND: `src/lib/pipeline/getFrontPage.test.ts`
- FOUND: `.planning/phases/03-deduplication-classification-ranking/03-02-SUMMARY.md`
- FOUND: commit `e81ad22` (test(03-02): add failing tests for decodeHtmlEntities (D-04))
- FOUND: commit `49e6ccb` (feat(03-02): decode title HTML entities once in normalize (D-04))
- FOUND: commit `d97690c` (test(03-02): add failing tests for dedupe (NORM-02, D-01/D-02/D-03))
- FOUND: commit `e552e6b` (feat(03-02): collapse multi-outlet duplicates to one card (NORM-02))
- FOUND: commit `9bfef3f` (test(03-02): pin dedupe-key edges and prove the collapse end to end)

---
*Phase: 03-deduplication-classification-ranking*
*Completed: 2026-09-27*
