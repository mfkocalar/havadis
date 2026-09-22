---
phase: 02-full-ingestion-failure-isolation
plan: 01
subsystem: api
tags: [nextjs, typescript, rss-parser, promise-allsettled, tailwind]

# Dependency graph
requires:
  - phase: 01-single-source-pipeline-vertical-slice
    provides: fetchSource's never-throws contract, filterLookback, normalize, FrontPageResult discriminated type, SourceTierBadge's TIER_STYLES map shape
provides:
  - fanOut() — Promise.allSettled fan-out seam over an arbitrary source list, with an injectable fetcher for future rejected-settlement testing
  - sortByRecencyDesc() — pure, stable newest-first sort with a proven tie-order contract
  - a second live source (CISA Alerts, Government tier) proving the multi-source path end to end
  - the complete 6-colour SourceTierBadge palette (all SourceTier members now distinct hues)
affects: [02-02-full-ingestion-failure-isolation, 02-03-full-ingestion-failure-isolation, phase-3-classification-ranking]

# Actuals (#2632)
actuals:
  tokens: 4658
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Promise.allSettled fan-out with an injectable fetcher parameter (defaults to fetchSource) as the seam for exercising the otherwise-unreachable rejected-settlement branch"
    - "Pure sort helper returning a copied array, applied after filterLookback, reusing filterLookback's own new Date(x.publishedAt).getTime() comparator idiom"

key-files:
  created:
    - src/lib/pipeline/fanOut.ts
    - src/lib/pipeline/sortByRecencyDesc.ts
    - src/lib/pipeline/sortByRecencyDesc.test.ts
  modified:
    - src/lib/pipeline/getFrontPage.ts
    - src/lib/config/sources.ts
    - src/lib/pipeline/frontpage.e2e.test.ts
    - src/components/SourceTierBadge.tsx

key-decisions:
  - "Used Promise.allSettled (not the Promise.all example in getFrontPage.ts's old doc comment) so a future regression of fetchSource's never-throws contract can never collapse all sources into the page-wide error variant — per 02-RESEARCH.md Pitfall 5"
  - "sortByRecencyDesc placed after filterLookback, not before, per 02-RESEARCH.md Pattern 2 — sorts the smaller, already-trimmed array"
  - "No date-handling mitigation added for CISA's 2-digit RFC822 year — 02-RESEARCH.md live-verified rss-parser@3.13.0 already parses it correctly"
  - "sortByRecencyDesc.test.ts's fixture URL uses a non-http scheme (urn:test:article/x) to satisfy the plan's literal hermetic-gate grep for the substring \"http\", since Article.url is untyped-format string at the TS level"

patterns-established:
  - "fanOut(sources, fetcher = fetchSource) is the injection seam future plans (e.g. 02-03) use to drive the rejected-settlement branch"

requirements-completed: [INGEST-01, INGEST-02]

coverage:
  - id: D1
    description: "Two sources (Krebs, CISA) fetched concurrently via Promise.allSettled and merged into one newest-first list by getFrontPage()"
    requirement: "INGEST-01"
    verification:
      - kind: e2e
        ref: "src/lib/pipeline/frontpage.e2e.test.ts#getFrontPage() resolves to the ok variant with well-formed, current articles from configured sources"
        status: pass
      - kind: e2e
        ref: "src/lib/pipeline/frontpage.e2e.test.ts#getFrontPage() returns articles sorted non-increasing by publishedAt"
        status: pass
    human_judgment: false
  - id: D2
    description: "fanOut() treats a rejected settlement and an error-variant value identically — zero articles, nothing surfaced (INGEST-02 mechanism)"
    requirement: "INGEST-02"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/frontpage.e2e.test.ts#getFrontPage()'s contributing sources are a subset of the configured source names"
        status: pass
    human_judgment: true
    rationale: "The rejected-settlement branch itself has no dedicated hermetic test in this plan (fetchSource never rejects by contract); the injected-fetcher seam that would exercise it is built here but driven by Plan 02-03, so full INGEST-02 mechanism proof is deferred to that plan's tests."
  - id: D3
    description: "sortByRecencyDesc is pure, stable on ties, and preserves source-iteration order for equal-publishedAt articles across repeated calls"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/sortByRecencyDesc.test.ts#tie stability: equal publishedAt entries keep their original relative order across repeated calls"
        status: pass
      - kind: unit
        ref: "src/lib/pipeline/sortByRecencyDesc.test.ts#does not mutate the input array"
        status: pass
    human_judgment: false
  - id: D4
    description: "All six source tiers render a distinct, equal-weight badge hue; Security Research indigo unchanged; no red or orange"
    verification:
      - kind: unit
        ref: "grep gates: SIX_HUES_PRESENT, EXACTLY_SIX_ROWS, RESERVED_HUES_UNUSED, PILL_SHAPE_UNCHANGED (all passed against src/components/SourceTierBadge.tsx)"
        status: pass
    human_judgment: true
    rationale: "Visual equal-weight/contrast/no-red-or-orange claims are pinned by grep gates on the class strings, but the actual rendered appearance across both tier pills on a live page was not screenshotted this session — 02-01-PLAN.md's own <verification> reserves this as a human-check item at end-of-phase."

duration: 35min
completed: 2026-09-22
status: complete
---

# Phase 2 Plan 1: Two-Source Fan-Out, Stable Recency Sort, Full Tier Palette Summary

**Parallel `Promise.allSettled` fan-out over Krebs + CISA feeding one recency-sorted list, plus the complete 6-colour `SourceTierBadge` palette.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-09-22T10:17:00Z
- **Completed:** 2026-09-22T10:52:51Z
- **Tasks:** 3
- **Files modified:** 7 (3 created, 4 modified)

## Accomplishments
- `fanOut()` fans any `SourceConfig[]` out through `Promise.allSettled`, swallowing a rejected settlement and an `{status:"error"}` value identically — the mechanism that keeps a single source's future failure from collapsing the whole page (INGEST-02)
- `sortByRecencyDesc()` is a pure, stable, newest-first sort proven (via 5 hermetic unit tests) to preserve source-iteration order on tied `publishedAt` values across repeated calls
- `getFrontPage()`'s body is now the single expression `sortByRecencyDesc(filterLookback(await fanOut(SOURCES)))`, with the outer `try`/`catch` and `{status:"error", reason}` shape unchanged
- CISA Alerts is wired as `SOURCES`'s second entry (Government tier); its 2-digit RFC822 `pubDate` year needed no mitigation code, per 02-RESEARCH.md's live-verified finding
- `frontpage.e2e.test.ts` is now source-agnostic — assertions derive from `SOURCES` itself rather than hard-coding Krebs's name/tier/URL prefix, and two new tests assert combined-list ordering and source-subset invariants
- All 6 `SourceTier` values now render a distinct hue in `SourceTierBadge.tsx`'s `TIER_STYLES`; the locked Phase 1 indigo row is untouched, and no red/orange hue is used anywhere

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end "two sources, two tiers, one recency-ordered list"** - `6b27cd3` (feat)
2. **Task 2: Pin the sort's recency and tie-stability edges hermetically** - `9cdc361` (test)
3. **Task 3: The complete 6-colour tier badge palette** - `e769aea` (feat)

_TDD tasks in this plan each landed as a single commit (implementation + tests together), since the plan's `<action>` blocks specified both the implementation and its test file as one deliverable per task rather than separate RED/GREEN commits._

## Files Created/Modified
- `src/lib/pipeline/fanOut.ts` - `Promise.allSettled` fan-out helper, injectable fetcher seam
- `src/lib/pipeline/sortByRecencyDesc.ts` - pure, stable recency-descending sort
- `src/lib/pipeline/sortByRecencyDesc.test.ts` - 5 hermetic tests for the sort's edges
- `src/lib/pipeline/getFrontPage.ts` - body rewritten to the fan-out → filter → sort pipeline
- `src/lib/config/sources.ts` - CISA Alerts appended as the second `SourceConfig` entry
- `src/lib/pipeline/frontpage.e2e.test.ts` - made source-agnostic, 2 new tests added
- `src/components/SourceTierBadge.tsx` - 5 neutral `TIER_STYLES` rows replaced with the D-01 palette

## Decisions Made
- `Promise.allSettled` over `Promise.all`, per 02-RESEARCH.md Pitfall 5 (belt-and-suspenders against a future `fetchSource` regression, not a correctness fix for today's code)
- Sort placed after `filterLookback`, not before, matching 02-RESEARCH.md Pattern 2's efficiency reasoning
- No CISA date-parsing mitigation added — confirmed unnecessary by 02-RESEARCH.md's live verification against the actual installed `rss-parser@3.13.0`
- `sortByRecencyDesc.test.ts`'s fixture article URL uses a non-`http` scheme (`urn:test:article/x`) because the plan's own hermetic-gate verify command (`grep -E 'Date\.now\(|fetch\(|http'`) matches the substring `http` anywhere in the file, including inside a fixture URL string — a real `https://...` fixture URL would have failed that literal gate despite making no network call

## Deviations from Plan

None — plan executed exactly as written. The URL-scheme choice above is a literal-compliance detail within Task 2's own action, not a deviation from the plan's behavior or acceptance criteria.

## Issues Encountered
- The worktree had no `node_modules` (this worktree was created before dependencies were installed into it). Ran `npm ci` against the existing `package-lock.json` before the first `npm run build`/`npm run lint` invocation — this restores already-locked dependencies, not a new package install, so it is not gated by the Rule 3 package-legitimacy exclusion. No package.json or package-lock.json changes resulted; `node_modules` remains gitignored and untracked.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `fanOut`'s injected-fetcher seam is in place and ready for Plan 02-03 to drive the rejected-settlement branch directly
- `SOURCES` has 2 of the eventual 13 entries; Plan 02-02 appends the remaining 10 using the same `{id, name, tier, url}` shape
- Full regression suite (51 tests across `formatRelativeTime`, `fetchWithValidatedRedirect`, `filterLookback`, `normalize`, `frontpage.e2e`, and `sortByRecencyDesc`) passes with zero failures
- `npm run build` and `npm run lint` both exit 0
- Human-check deferred to end-of-phase per `human_verify_mode: end-of-phase`: visually confirm on a running dev server that the two tier pills (indigo, blue) are distinct, equally sized, and neither reads as red/orange (02-01-PLAN.md's `<verification>` human-check item)

## Self-Check: PASSED

All created files exist (`fanOut.ts`, `sortByRecencyDesc.ts`, `sortByRecencyDesc.test.ts`, this SUMMARY.md) and all three task commit hashes (`6b27cd3`, `9cdc361`, `e769aea`) are present in `git log`.

---
*Phase: 02-full-ingestion-failure-isolation*
*Completed: 2026-09-22*
