---
phase: 01-single-source-pipeline-vertical-slice
plan: 04
subsystem: ingestion-pipeline-timeout
tags: [node-test, abortcontroller, abortsignal-any, hermetic-fixture, gap-closure]

# Dependency graph
requires:
  - phase: 01-01
    provides: "fetchWithValidatedRedirect and fetchSource this plan patches"
  - phase: 01-03
    provides: "test/fixtures/hostileRedirectServer.ts and fetchWithValidatedRedirect.test.ts this plan extends"
provides:
  - "One continuous per-source AbortController budget (8000ms) spanning connect, every redirect hop, and the full body read in fetchSource.ts"
  - "fetchWithValidatedRedirect.ts composes a caller-supplied AbortSignal into each hop's own signal via AbortSignal.any, instead of discarding it"
  - "Two new hermetic fixture routes: /slow-body (headers instantly, then drips forever) and /drip-then-complete (finishes well inside budget)"
  - "Four new tests proving the budget fires on a stall, does not over-fire on a slow-but-finishing body, and that the caller-signal composition is live on both the follow path and the pre-aborted-signal reject path"
  - "Corrected doc comments in both source files describing the one continuous budget that now exists, replacing the prior per-hop-only claim 01-VERIFICATION.md flagged as an overclaim"
affects: [02-full-ingestion-failure-isolation]

# Actuals (#2632)
actuals:
  tokens: 4959
  tasks: 3
  commits: 3
  plan_head_before: 6d1171c3a52a23f8aa75fe310c2640809ddbcdc1

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AbortSignal.any(...) to compose a caller-owned budget into a callee's own per-hop timer, so a wider timeout survives past a narrower one's boundary without changing the callee's exported signature"
    - "One AbortController armed at the outermost caller (fetchSource) rather than per-layer, cleared in a single finally on the outer try so every exit path (ok, four error variants, thrown) clears it uniformly"
    - "Positive-control tests (a slow-but-finishing body, a never-aborted caller signal) paired with every new negative-path/timeout test, so a guard that over-fires cannot pass by accident"

key-files:
  created: []
  modified:
    - src/lib/pipeline/fetchWithValidatedRedirect.ts
    - src/lib/pipeline/fetchSource.ts
    - test/fixtures/hostileRedirectServer.ts
    - src/lib/pipeline/fetchWithValidatedRedirect.test.ts

key-decisions:
  - "Composed the caller's AbortSignal into the per-hop signal via AbortSignal.any rather than replacing the per-hop timer outright — this is a four-line, additive change that preserves today's exact behavior for any caller that supplies no signal, keeping the original 10 tests green with zero edits to their bodies"
  - "Left the per-hop clearTimeout in its existing finally untouched — it was never the defect. The defect was that nothing else stayed armed after it fired; composing in the caller's signal fixes that without touching the per-hop timer's own lifecycle"
  - "readBodyWithCap's in-loop signal.aborted check is documented as a narrow safety net only, not the fix itself — the load-bearing mechanism is the runtime tearing down the response body stream when the composed signal aborts, which is what actually rejects a pending reader.read()"
  - "Named the 8s timeout value in prose in only fetchSource.ts (next to SOURCE_TIMEOUT_MS); fetchWithValidatedRedirect.ts's comments refer to TIMEOUT_MS symbolically so the two comments cannot drift out of sync with each other"
  - "Task 3 touched only doc comments in the two source files — no behavioral code changed after Task 2; verified via git diff before committing"

patterns-established:
  - "When a narrower-scoped timer's boundary needs a wider budget to survive past it, compose signals with AbortSignal.any at the call boundary rather than restructuring the narrower function's own timer lifecycle"

requirements-completed: [INGEST-03]

coverage:
  - id: D1
    description: "An origin that sends 200 headers instantly and then drips one byte per ~250ms forever is aborted within the ~8s per-source budget (7000-11000ms) and fetchSource resolves to the error variant with an attributable, distinctive timeout reason — the exact branch 01-VERIFICATION.md reproduced still-pending at 12,000ms"
    requirement: "INGEST-03"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/fetchWithValidatedRedirect.test.ts (stalled-body abort test)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A body that drips across a few chunks but finishes well inside the budget still resolves ok with at least one article, in well under 3000ms — proving the new budget does not over-fire on a legitimately slow-but-finishing source"
    requirement: "INGEST-03"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/fetchWithValidatedRedirect.test.ts (drips-then-completes control)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The caller-signal composition (Task 1) is live on the follow path every successful fetch takes: a fresh never-aborted signal still lets a legitimate same-host HTTPS redirect complete, and an already-aborted signal prevents the call from silently succeeding"
    requirement: "INGEST-03"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/fetchWithValidatedRedirect.test.ts (caller-supplied-signal follow-path and pre-aborted-signal controls)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every other Phase 1 behavior is unchanged: the pre-existing 10 redirect/timeout tests pass unedited, all four fast test files and the live-source e2e test pass, the caching configuration (revalidate: 900, no companion cache option, Cache Components off, string-only rss-parser) is unmoved, the fixture is still absent from shipped code, and the production build plus its HTTP contract test pass"
    requirement: "INGEST-03"
    verification:
      - kind: unit
        ref: "node --test src/lib/formatRelativeTime.test.ts src/lib/pipeline/normalize.test.ts src/lib/pipeline/filterLookback.test.ts src/lib/pipeline/fetchWithValidatedRedirect.test.ts (42 tests, 0 fail)"
        status: pass
      - kind: e2e
        ref: "node --test src/lib/pipeline/frontpage.e2e.test.ts (2 tests, 0 fail, live Krebs feed)"
        status: pass
      - kind: other
        ref: "REVALIDATE_SET, NO_COMPANION_CACHE_OPTION, CACHE_COMPONENTS_OFF, STRING_PARSER_ONLY, FIXTURE_NOT_SHIPPED grep gates — all emitted"
        status: pass
      - kind: e2e
        ref: "npm run build (0 errors) + node --test test/productionPage.test.ts (4 tests, 0 fail)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Both source files' doc comments describe the one continuous per-source budget that now exists rather than the per-hop-only claim 01-VERIFICATION.md flagged as an overclaim; the guard's comment states plainly that its own per-hop timer covers only the header phase; the timeout value is named in prose in only one file"
    requirement: "INGEST-03"
    verification:
      - kind: other
        ref: "git diff eacea99~1 eacea99 -- src/lib/pipeline/fetchWithValidatedRedirect.ts src/lib/pipeline/fetchSource.ts (comments-only diff, manually inspected)"
        status: pass
    human_judgment: false

# Metrics
duration: ~28min (Tasks 1-2 in a prior interrupted session: ~23min; Task 3 in this session: ~5min)
completed: 2026-09-20
status: complete
---

# Phase 1 Plan 4: Continuous Per-Source Time Budget Summary

**Closed the one gap 01-VERIFICATION.md found in Success Criterion 5: a per-source `AbortController` now spans connect, every redirect hop, and the full body read as one continuous ~8s window, composed into `fetchWithValidatedRedirect`'s per-hop signal via `AbortSignal.any` — proven against a hermetic fixture that reproduces the exact still-pending-at-12s branch the verifier found, plus positive controls proving the budget doesn't over-fire.**

## Performance

- **Duration:** ~28 min total across two sessions — Tasks 1-2 completed and committed in a prior interrupted session (~23 min), Task 3 completed in this session (~5 min)
- **Started:** 2026-09-20T12:21:35Z (Task 1 commit)
- **Completed:** 2026-09-20T12:49:04Z (Task 3 commit)
- **Tasks:** 3 planned, all completed
- **Files modified:** 4 (2 source files, 1 fixture, 1 test file)

## Accomplishments

- `fetchWithValidatedRedirect.ts` now reads the caller's `AbortSignal` off `init` before it is spread, and composes it with each hop's own per-hop signal via `AbortSignal.any` — so a wider, caller-owned budget survives past the per-hop timer's boundary into the body read, with zero change to the exported signature or return type
- `fetchSource.ts` now arms one `AbortController`/timer (`SOURCE_TIMEOUT_MS = 8000`) at function entry, passes its signal through the init object into the guard and into `readBodyWithCap`, and clears the timer in a single `finally` on the outer `try` — covering the ok path, all four early-return error variants, and the thrown path alike
- Extended `test/fixtures/hostileRedirectServer.ts` with `/slow-body` (200 + XML headers instantly, then one byte every ~250ms forever) and `/drip-then-complete` (the minimal RSS document across ~3 chunks ~100ms apart, then ends) — both routes' repeating timers are tracked, `unref()`-ed, and cleared on `close`
- Added four tests to `fetchWithValidatedRedirect.test.ts`: the stalled-body abort (asserts error variant, 7000-11000ms elapsed, distinctive timeout reason), the drip-then-complete positive control (ok variant, ≥1 article, <3000ms), a never-aborted caller-signal follow-path control, and an already-aborted caller-signal reject control — 14 tests total in the file, 0 failures
- Corrected both files' doc comments to describe the one continuous per-source budget that now exists, replacing the stale "per-hop timeout" framing 01-VERIFICATION.md's Anti-Patterns table flagged as an overclaim in 01-03-SUMMARY.md
- Re-ran the full phase-wide regression sweep: 42 tests across the four fast test files (0 fail), the 2-test live-source e2e suite (0 fail), all four caching-configuration gates, the corrected fixture-not-shipped gate, and `npm run build` + the 4-test production page contract suite (0 fail)

## Task Commits

Each task was committed atomically:

1. **Task 1: One continuous per-source time budget, proven end-to-end against a headers-then-stalled-body origin** - `d98c75e` (feat) — completed in a prior interrupted session
2. **Task 2: The positive controls — a slow-but-finishing body still succeeds, and a caller signal never breaks the follow path** - `6a764a1` (test) — completed in a prior interrupted session
3. **Task 3: Phase-wide non-regression sweep and correcting the two doc comments that made the false claim** - `eacea99` (docs) — completed in this session

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `src/lib/pipeline/fetchWithValidatedRedirect.ts` - composes a caller-supplied `AbortSignal` into each hop's signal via `AbortSignal.any`; header doc comment now states the per-hop timer covers only the header phase and names the caller's signal as what carries a wider budget past it
- `src/lib/pipeline/fetchSource.ts` - declares `SOURCE_TIMEOUT_MS = 8000`, arms one controller/timer at entry, threads the signal through `readBodyWithCap`, clears the timer in a `finally` on the outer `try`; function doc comment no longer lists a stale "per-hop timeout" among its failure paths
- `test/fixtures/hostileRedirectServer.ts` - added `/slow-body` and `/drip-then-complete` routes with tracked, `unref()`-ed, close-cleaned repeating timers
- `src/lib/pipeline/fetchWithValidatedRedirect.test.ts` - added the stalled-body abort test, the drip-then-complete positive control, and the two caller-signal composition controls (14 tests total, up from 10)

## Decisions Made

- Composed signals via `AbortSignal.any` rather than restructuring `fetchWithValidatedRedirect`'s per-hop timer lifecycle — the smallest change that preserves exact prior behavior for callers supplying no signal
- Left the per-hop `clearTimeout` exactly where it was; the defect was the absence of anything else staying armed after it fired, not the timer's own placement
- Documented the in-loop `signal.aborted` check in `readBodyWithCap` as a narrow safety net, not the fix itself, to prevent a future reader from over-crediting it
- Named the 8s timeout value in prose in only `fetchSource.ts`, so the two files' comments describe the same fact from two vantage points without being able to drift apart on the number itself
- Task 3 changed comments only in both source files — confirmed via `git diff` before committing that no behavioral line moved

## Deviations from Plan

None - plan executed exactly as written. Task 3's regression sweep found no failing gate and required no root-cause fixes; the doc-comment correction was the task's own stated deliverable, not a deviation.

## Issues Encountered

None. The suite the orchestrator asked me to independently re-verify (14/14 passing, ~24.5s) matched exactly on this run (42/42 across the four fast files including the redirect suite, live e2e passing, all gates emitting their tokens, build and production-page test passing).

## Next Phase Readiness

- ROADMAP Success Criterion 5 is now fully true: a deliberately slow fetch is aborted by the per-source timeout whether the origin withholds headers entirely or sends them instantly and then stalls mid-body, and the page never hangs on either branch
- INGEST-03's checkbox in REQUIREMENTS.md (`[x] Complete`) is now accurate — 01-VERIFICATION.md's judgment that it was previously inaccurate is resolved by this plan's gap closure
- Phase 1 is now complete: all 4 plans (01-01 through 01-04) executed and committed, all 5 ROADMAP success criteria hold (4 fully verified in-process, 1 correctly deferred as a `backstop` truth requiring a real Vercel deployment)
- `.planning/WINDOWS.md` entries #2 (15-min stale-while-revalidate timing) and #3 (real browser click-through) remain open, both platform-governed/human-verification items carried forward per `human_verify_mode: end-of-phase` — not blockers for Phase 2's start
- 01-REVIEW.md's WR-01 (feed-item link host not validated against source domain), WR-02 (XML entity-expansion hardening), and WR-03 (charset handling) remain deliberately out of scope for this gap-closure plan, as recorded in 01-04-PLAN.md's Source Coverage table — these are real, recorded findings for a future decision, not silently dropped
- No blockers for Phase 2 (full ingestion fan-out to the other 12 sources)

## Self-Check: PASSED

- Both modified source files (`src/lib/pipeline/fetchWithValidatedRedirect.ts`, `src/lib/pipeline/fetchSource.ts`) verified present on disk via `test -f`.
- All 3 task commit hashes (`d98c75e`, `6a764a1`, `eacea99`) verified present via `git log --oneline`.
- `git rev-list --count 6d1171c3a52a23f8aa75fe310c2640809ddbcdc1..HEAD` reports 3, matching `actuals.commits`.

---
*Phase: 01-single-source-pipeline-vertical-slice*
*Completed: 2026-09-20*
