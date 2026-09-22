---
phase: 02-full-ingestion-failure-isolation
plan: 04
subsystem: ui
tags: [nextjs, typescript, tailwindcss, node-test, unicode, gap-closure]

# Dependency graph
requires:
  - phase: 01-single-source-pipeline-vertical-slice
    provides: "normalize.ts (summary field) and ArticleCard.tsx (title/summary rendering), both amended here per D-08"
provides:
  - "truncateSummary.ts / SUMMARY_MAX_CHARS: a pure, code-point-safe 400-char cap applied to Article.summary before it enters the RSC payload"
  - "ArticleCard.tsx bounded to three lines on both title and summary via Tailwind's line-clamp-3, with the empty-summary paragraph omitted entirely"
  - "D-08: the written amendment superseding Phase 1's no-clamp UI-02 mandate, recorded in REQUIREMENTS.md, 02-CONTEXT.md, PROJECT.md, and cited in ArticleCard.tsx itself"
affects: [phase-3-classification-ranking]

# Actuals (#2632)
actuals:
  tokens: 6043
  tasks: 3
  commits: 3
plan_head_before: a968fc6dba7fa2c5b3ea726e06b946c451c860e5

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Data-layer length cap measured in Unicode code points (Array.from, never raw-string index slicing), to guarantee well-formed output even when a cut lands inside an astral-plane character"
    - "Complementary two-layer bound: a data-layer cap (400 code points, sized generously above the visual bound) sitting behind a presentational CSS clamp (line-clamp-3, the bound the reader actually perceives) — documented explicitly so neither is later 'simplified away' as the other's duplicate"

key-files:
  created:
    - src/lib/pipeline/truncateSummary.ts
    - src/lib/pipeline/truncateSummary.test.ts
  modified:
    - src/lib/pipeline/normalize.ts
    - src/lib/pipeline/normalize.test.ts
    - src/components/ArticleCard.tsx
    - .planning/REQUIREMENTS.md
    - .planning/PROJECT.md
    - .planning/phases/02-full-ingestion-failure-isolation/02-CONTEXT.md

key-decisions:
  - "D-08 (02-CONTEXT.md): article card title and summary are bounded visually (three-line CSS clamp) and the summary is additionally capped at the data layer (400 Unicode code points), deliberately superseding Phase 1's 01-02-PLAN.md:157/184 no-clamp mandate and its 01-02-SUMMARY.md:82 passing verify record. UI-02's 'verbatim' guarantee is narrowed to mean no editorial rewriting, not unbounded display length."
  - "SUMMARY_MAX_CHARS = 400: chosen to sit above the card's ~318-character three-line visual capacity at its widest desktop measure, so the CSS clamp — not the data-layer cap — is what a reader ever visually perceives; the cap's own job is narrower (keeping a measured 26,744-code-point CISA worst case out of the RSC payload, a ~98.5% reduction)."
  - "Title is deliberately NOT capped at the data layer (only visually clamped): its measured cross-source spread is ~3.1x vs. the summary's ~94x, and truncating it would violate UI-02's surviving verbatim-content guarantee."
  - "A source supplying no summary (CrowdStrike, measured 0 chars) renders no <p> element at all, via an explicit length>0 check with an explicit null alternative — never a bare truthy && and never placeholder copy, consistent with D-05's 'never show the reader machinery' principle."

requirements-completed: [UI-02]

coverage:
  - id: D1
    description: "UI-02's no-clamp mandate amendment (D-08) recorded in writing in REQUIREMENTS.md, 02-CONTEXT.md, and PROJECT.md before any code changed"
    requirement: "UI-02"
    verification:
      - kind: other
        ref: "grep gates AMENDMENT_RECORDED / REQ_UI02_AMENDED / PROJECT_DECISION_LOGGED / NO_COLLATERAL_EDITS (Task 1 <verify>)"
        status: pass
    human_judgment: false
  - id: D2
    description: "truncateSummary()/SUMMARY_MAX_CHARS: pure, code-point-safe 400-char cap with word-boundary cut, ellipsis marker, idempotency, and well-formed surrogate-pair handling"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/truncateSummary.test.ts (8/8 passing)"
        status: pass
    human_judgment: false
  - id: D3
    description: "normalize.ts wires truncateSummary() into Article.summary; title path (title: item.title.trim()) is left byte-identical"
    requirement: "UI-02"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/normalize.test.ts (14/14 passing, 12 pre-existing + 2 new wiring cases)"
        status: pass
      - kind: other
        ref: "grep gates NORMALIZE_WIRED / TITLE_UNTOUCHED_AT_DATA_LAYER / NO_NEW_RUNTIME_DEP (Task 2 <verify>)"
        status: pass
    human_judgment: false
  - id: D4
    description: "ArticleCard.tsx clamps both title and summary to three lines and omits the summary element entirely when the publisher supplied none, restoring comparable card heights across all 13 sources"
    requirement: "UI-02"
    verification:
      - kind: unit
        ref: "npm test (83/83 passing, full Phase 1 + Phase 2 suite) + npm run build + npm run lint, all exit 0"
        status: pass
      - kind: other
        ref: "grep gates BOTH_FIELDS_CLAMPED / EMPTY_SUMMARY_OMITTED / SUPERSEDING_DECISION_CITED_IN_CODE / STILL_SERVER_TEXT_NODES_ONLY (Task 3 <verify>)"
        status: pass
    human_judgment: true
    rationale: "Visual card-height consistency across sources, the ellipsis's visibility, the CrowdStrike card's absent dead-space, and focus-ring clipping at mobile widths are genuine judgment calls requiring a real browser render (the plan's own <human-check>) — no automated test can assert 'looks comparable to a human'. Logged as WINDOWS.md entry #4 (kind: unrun-verify) pending a real dev-server visual pass."

duration: 32min
completed: 2026-09-22
status: complete
---

# Phase 2 Plan 4: Bound Article Card Text Length (UAT Gap G-02-5) Summary

**A 400-Unicode-code-point data-layer cap on `Article.summary` plus a three-line Tailwind `line-clamp-3` on both card fields, closing a ~94x cross-source summary-length spread that Phase 1's single-source no-clamp mandate never anticipated.**

## Performance

- **Duration:** 32 min
- **Started:** 2026-09-22T16:08:49Z
- **Completed:** 2026-09-22T16:40:00Z
- **Tasks:** 3
- **Files modified:** 8 (2 created, 6 modified)

## Accomplishments
- Amended Phase 1's explicit "no ellipsis, no line clamp" UI-02 mandate in writing, in all three documents a future reader consults (`REQUIREMENTS.md`, `02-CONTEXT.md` D-08, `PROJECT.md`), *before* any code changed — so the code changes in Tasks 2-3 land as a deliberate, cited amendment rather than an unexplained contradiction of a passed Phase 1 gate.
- Added `truncateSummary()` / `SUMMARY_MAX_CHARS` (400): a pure, dependency-free, code-point-safe cap that keeps a measured 26,744-code-point CISA worst case out of the RSC payload entirely (a ~98.5% reduction), cutting on a word boundary, marking the cut with a single ellipsis, and remaining idempotent and well-formed under Unicode surrogate pairs — proven by 8 hermetic unit tests.
- Wired the cap into `normalize.ts`'s summary assignment while leaving `title: item.title.trim()` byte-identical, and added 2 wiring assertions to `normalize.test.ts` proving the cap is actually applied to the field that reaches the page (14/14 passing).
- Bounded `ArticleCard.tsx`'s title and summary to three lines each via Tailwind's core `line-clamp-3` utility (no plugin dependency), and stopped rendering an empty `<p>` for sources with no summary (CrowdStrike, measured 0 chars) — the card now runs straight from headline to timestamp instead of showing 8px of dead margin.

## Task Commits

Each task was committed atomically:

1. **Task 1: Amend the UI-02 display requirement in writing, before any code changes** - `d0d8585` (docs)
2. **Task 2: Cap the summary at the data layer with a pure, code-point-safe truncator** - `300bfb2` (feat)
3. **Task 3: Bound the card visually and stop rendering the empty-summary element** - `ba62a49` (fix — includes a Rule 1 auto-fix, see Deviations)

**Plan metadata:** committed in this SUMMARY's own commit (see below).

## Files Created/Modified
- `src/lib/pipeline/truncateSummary.ts` - New pure module: `truncateSummary()` + `SUMMARY_MAX_CHARS` (400), code-point-safe cap with word-boundary cut and ellipsis marker
- `src/lib/pipeline/truncateSummary.test.ts` - 8 hermetic unit tests covering the cap invariant, word-boundary cut, idempotency, and surrogate-pair safety
- `src/lib/pipeline/normalize.ts` - Wires `truncateSummary()` into the `summary` field; `title` deliberately untouched
- `src/lib/pipeline/normalize.test.ts` - 2 new wiring cases (under-cap pass-through, over-cap capping), 12 pre-existing cases unedited
- `src/components/ArticleCard.tsx` - `line-clamp-3` on title `h2` and summary `p`; summary `p` now conditionally rendered on `article.summary.length > 0`; header doc comment cites D-08
- `.planning/REQUIREMENTS.md` - UI-02 bullet amended in place, citing `G-02-5` and `D-08`
- `.planning/PROJECT.md` - New Key Decisions row naming plan `02-04`
- `.planning/phases/02-full-ingestion-failure-isolation/02-CONTEXT.md` - New `D-08` decision entry

## Decisions Made
See `key-decisions` in frontmatter above — the central one is D-08's amendment of Phase 1's UI-02 no-clamp mandate, made necessary by the ~94x median summary-length spread UAT G-02-5 reported once the source list widened from 1 to 13.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed an ES2018-only regex flag incompatible with this repo's ES2017 TypeScript target**
- **Found during:** Task 3 (running `npm run build` as part of Task 3's verification gate)
- **Issue:** `truncateSummary.ts`'s word-boundary search used `/\s(?!.*\s)/su` — the `s` (dotAll) flag requires targeting `es2018` or later, but `tsconfig.json` targets `ES2017`. `npm run build`'s type-check step failed with `TS1501: This regular expression flag is only available when targeting 'es2018' or later.`
- **Fix:** Replaced `.` + the `s` flag with the target-independent `[\s\S]` character class, which matches any character including newlines without needing dotAll. Behaviorally identical for this pattern.
- **Files modified:** `src/lib/pipeline/truncateSummary.ts`
- **Verification:** Re-ran all 8 `truncateSummary.test.ts` cases, all 14 `normalize.test.ts` cases, the full 83-test suite (`npm test`), `npm run build`, and `npm run lint` — all pass/exit 0.
- **Committed in:** `ba62a49` (part of Task 3's commit, since the bug was introduced in Task 2 but only surfaced by Task 3's build-verification gate)

---

**Total deviations:** 1 auto-fixed (1 bug).
**Impact on plan:** Necessary correctness fix caught by the plan's own build-verification gate before it reached a commit boundary undetected. No scope creep — same function, same behavior, same test coverage.

## Issues Encountered
None beyond the deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness

- UAT gap G-02-5 is closed at both the data layer (400-code-point cap) and the presentation layer (three-line clamp on both fields); the amendment is on the record in `REQUIREMENTS.md`, `02-CONTEXT.md` (D-08), and `PROJECT.md`, and cited from `ArticleCard.tsx` itself.
- **Pending human verification (WINDOWS.md entry #4, kind `unrun-verify`):** load the running dev server and visually confirm (1) no card's text block is dramatically taller than its neighbours' — in particular CISA/CSO Online vs. Bleeping Computer/Ars Technica, (2) a clamped summary shows a visible ellipsis, (3) the CrowdStrike card shows no dead gap between headline and timestamp, and (4) a tabbed-to headline's focus ring is not clipped, at both desktop and a ~375px mobile width. This is a genuine judgment call the plan's own `<human-check>` calls out — no automated test asserts "looks comparable to a human."
- **Carried forward, intentionally out of scope for this plan:**
  - The CrowdStrike title's undecoded `&trade;` HTML entity (a separate cosmetic bug on a different axis — `rss-parser` decodes entities for `contentSnippet` but not for `item.title`) remains unfixed, as the plan's own prohibitions require.
  - Phase 3's UI-03 CVE scan will operate on the now-capped summary; a CVE identifier appearing beyond the 400-code-point cap inside an unusually long publisher body will not produce a chip. This is deliberately accepted per D-08 — titles (never capped) are unaffected, which covers the common advisory-feed case (e.g. CISA).

---
*Phase: 02-full-ingestion-failure-isolation*
*Completed: 2026-09-22*

## Self-Check: PASSED

- All 9 key files (2 created, 7 modified) confirmed present on disk with `[ -f ]`.
- All 3 task commits (`d0d8585`, `300bfb2`, `ba62a49`) confirmed in `git log --oneline --all`.
- All task-level `<acceptance_criteria>` re-verified passing (see Task Commits / Deviations above).
- Plan-level `<verification>` re-run: `truncateSummary.test.ts` (8/8), `normalize.test.ts` (14/14), `npm test` (83/83), `npm run build` and `npm run lint` (exit 0 each), `ArticleCard.tsx` grep gates (all 4 pass), UI-02 amendment grep gates (all 4 pass), dependency list unchanged. The plan's `<human-check>` is intentionally not run by this automated executor — logged as WINDOWS.md entry #4 (`unrun-verify`).
