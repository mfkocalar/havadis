---
phase: 02-full-ingestion-failure-isolation
plan: 03
subsystem: api
tags: [nextjs, typescript, node-test, promise-allsettled, hermetic-fixture]

# Dependency graph
requires:
  - phase: 02-full-ingestion-failure-isolation
    provides: "Plan 02-01's fanOut() injected-fetcher seam and Plan 02-02's full 13-source SOURCES array"
provides:
  - "Hermetic proof (real sockets, no live feed hostnames) that fanOut() isolates a broken source from healthy ones, per ROADMAP Phase 2 Success Criterion 2"
  - "Hermetic proof that fanOut() runs sources concurrently, not sequentially, per ROADMAP Phase 2 Success Criterion 1"
  - "Three new hostileRedirectServer.ts fixture routes (/delayed-feed, /status-500, /malformed-xml) and the taggedRss(tag) helper, reusable by future plans"
affects: [phase-3-classification-ranking]

# Actuals (#2632)
actuals:
  tokens: 4831
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Memoized single async run shared across two node:test test() blocks, so an ~8s stall-isolation case is paid once and asserted on twice, rather than re-run per assertion"
    - "Three independent fixture-server instances (three ephemeral ports) started per timing test file to rule out per-origin HTTP connection pooling from defeating a concurrency assertion"

key-files:
  created:
    - src/lib/pipeline/fanOut.test.ts
    - src/lib/pipeline/fanOutTiming.test.ts
  modified:
    - test/fixtures/hostileRedirectServer.ts

key-decisions:
  - "Rewrote every code comment mentioning the fixture's never-responding route to avoid the literal substring \"/hang\" in fanOut.test.ts, since the plan's own FAST_FAILURE_MODES_ONLY gate greps for that literal string's absence — a comment referencing the route by name would have failed the gate despite the route never actually being used in that file"
  - "Split fanOutTiming.test.ts's stall-isolation proof into two test() blocks (which article set returns; whether the budget is serialised) that share one memoized ~8s fetch run, rather than either merging into one test (violating the plan's literal three-test-block acceptance criterion) or re-running the ~8s stall fetch twice"
  - "Used a top-level await to start the shared hermetic fixture server(s) once per file (matching the plan's explicit instruction), closed via an after() hook rather than per-test setup/teardown"

patterns-established:
  - "A grep-based hermeticity/no-real-hostname gate on a test file's own comments, not just its executable code — future fixture-driven test files in this repo should avoid literal route-name substrings in prose when a sibling file's gate greps for their absence"

requirements-completed: [INGEST-01, INGEST-02]

coverage:
  - id: D1
    description: "A deliberately broken source (HTTP error, malformed XML, refused connection, dead 404 path) among healthy ones never prevents the healthy sources' articles from returning; fanOut resolves rather than rejecting"
    requirement: "INGEST-02"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/fanOut.test.ts#mixed health: two healthy sources among four broken ones yield exactly the healthy sources' articles"
        status: pass
      - kind: unit
        ref: "src/lib/pipeline/fanOut.test.ts#D-07: one healthy source among five broken ones yields exactly one article, with no minimum-article floor"
        status: pass
      - kind: unit
        ref: "src/lib/pipeline/fanOut.test.ts#D-06: every source broken yields an empty array, and fanOut still resolves"
        status: pass
    human_judgment: false
  - id: D2
    description: "A thrown rejection and a returned {status:'error'} value are handled identically by fanOut's injected-fetcher seam — the mechanism proof INGEST-02 depends on"
    requirement: "INGEST-02"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/fanOut.test.ts#rejected settlement: a throwing fetcher for one source does not block the others' results"
        status: pass
      - kind: unit
        ref: "src/lib/pipeline/fanOut.test.ts#injected error variant: a returned {status:'error'} value is swallowed identically to a thrown rejection"
        status: pass
    human_judgment: false
  - id: D3
    description: "Returned Article objects carry exactly the six Article fields — no per-source failure, status, count, or diagnostic metadata (D-05)"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/fanOut.test.ts#D-05: returned Article objects carry no failure, status, count, or diagnostic field"
        status: pass
    human_judgment: false
  - id: D4
    description: "page.tsx still renders the exact verbatim Phase 1 empty-state copy that D-06 reuses for the all-sources-failed case"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/fanOut.test.ts#D-06 copy contract: page.tsx still renders the verbatim Phase 1 empty-state copy"
        status: pass
    human_judgment: false
  - id: D5
    description: "Sources are fetched concurrently: wall-clock elapsed for 3 equally-delayed (900ms) sources on 3 distinct origins is close to one delay (measured 938-944ms across runs), not the ~2700ms a sequential run would take"
    requirement: "INGEST-01"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/fanOutTiming.test.ts#concurrency: three 900ms-delayed sources on three distinct origins resolve in well under their summed delay"
        status: pass
    human_judgment: false
  - id: D6
    description: "A fully stalled source does not block or extend the healthy sources' results, and its own ~8s SOURCE_TIMEOUT_MS budget is not serialised behind or added to theirs (measured elapsed ~8003-8005ms, well under the 12s ceiling that would indicate serialisation)"
    requirement: "INGEST-02"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/fanOutTiming.test.ts#stall isolation: a stalled source does not block or extend the healthy sources' results"
        status: pass
      - kind: unit
        ref: "src/lib/pipeline/fanOutTiming.test.ts#stall isolation: the stalled source's own timeout budget is not serialised behind or added to the healthy sources' budget"
        status: pass
    human_judgment: false
  - id: D7
    description: "The three new fixture routes preserve the fixture's hermeticity contract: 127.0.0.1-only, ephemeral port, timer-lifecycle discipline, and no import from shipped src/ code"
    verification:
      - kind: unit
        ref: "grep gates: NEW_ROUTES_PRESENT, TIMER_HYGIENE_KEPT, STILL_LOOPBACK_EPHEMERAL, FIXTURE_NOT_SHIPPED (all passed against test/fixtures/hostileRedirectServer.ts)"
        status: pass
      - kind: unit
        ref: "node --test src/lib/pipeline/fetchWithValidatedRedirect.test.ts (all 14 pre-existing tests still pass unaffected)"
        status: pass
    human_judgment: false

duration: 32min
completed: 2026-09-22
status: complete
---

# Phase 2 Plan 3: Failure Isolation and Concurrency Proof Against Real Sockets Summary

**Three new hermetic fixture routes plus two new test files prove — against real sockets, not by reading the code — that `fanOut()` isolates a broken source and runs all sources concurrently, closing out Phase 2.**

## Performance

- **Duration:** 32 min
- **Started:** 2026-09-22T11:25:00Z
- **Completed:** 2026-09-22T11:57:00Z
- **Tasks:** 3
- **Files modified:** 3 (2 created, 1 modified)

## Measured Timings

From the final passing run of `fanOutTiming.test.ts`:

| Test | Measured elapsed | Bound(s) asserted |
|------|-------------------|--------------------|
| Concurrency (3× `/delayed-feed?ms=900` on 3 distinct origins) | 938–944ms (varied slightly across repeated runs) | `>= 900ms` (rules out a vacuous pass) and `< 2000ms` (a sequential run would take ~2700ms) |
| Stall isolation (2 healthy + 1 `/hang`, shared/memoized run) | 8003–8005ms | `< 12000ms` (comfortably above one 8s `SOURCE_TIMEOUT_MS` budget, far below two) |

Both bounds held with comfortable margin on every run observed this session — the concurrency test's ~940ms result sits well inside its `[900, 2000)` window, and the stall-isolation test's ~8004ms result sits well inside its `< 12000ms` ceiling (a serialised/doubled-budget failure would have landed near 16000ms).

## Accomplishments
- `test/fixtures/hostileRedirectServer.ts` gained `taggedRss(tag)` and three routes — `/delayed-feed` (healthy, tagged, delay-capped-at-10s), `/status-500` (HTTP-error failure mode), `/malformed-xml` (parse-failure mode) — all following the existing `/drip-then-complete` timer-lifecycle pattern (`unref()`, `activeTimers` tracking, cleared on response close)
- `src/lib/pipeline/fanOut.test.ts` hermetically proves mixed-health failure isolation, D-07 (one-of-many, no floor), D-06 (all-broken, verbatim empty-state copy), the rejected-settlement-vs-error-variant equivalence via the injected fetcher seam, and the six-field-only `Article` shape contract (D-05) — 7 tests, all passing in ~190ms
- `src/lib/pipeline/fanOutTiming.test.ts` hermetically proves wall-clock concurrency (3 sources, 3 distinct origins, bounded elapsed) and stall isolation (a `/hang` source does not block or extend the healthy sources' results, and its own timeout budget is not serialised behind theirs) — 3 tests, all passing (~9.1s total, dominated by the by-design ~8s stall case)
- Zero production symbols changed: `SOURCE_TIMEOUT_MS` (8_000) and `MAX_BODY_BYTES` (2 * 1024 * 1024) verified unchanged by literal-match gates
- Full regression suite: 73/73 tests pass across every Phase 1 and Phase 2 test file; `npm run build` and `npm run lint` both exit 0

## Task Commits

Each task was committed atomically:

1. **Task 1: Three new hermetic fixture routes — delayed-ok, HTTP error, malformed XML** - `97e5860` (test)
2. **Task 2: Prove failure isolation against real sockets** - `0e887e9` (test)
3. **Task 3: Prove the fetches are concurrent, and that a stalled source does not stall the rest** - `6cbd53b` (test)

## Files Created/Modified
- `test/fixtures/hostileRedirectServer.ts` - added `taggedRss(tag)`, `/delayed-feed`, `/status-500`, `/malformed-xml`; header comment extended; all pre-existing routes, exported surface, and bind/listen behavior untouched
- `src/lib/pipeline/fanOut.test.ts` - new, 7 hermetic tests over the mixed-health, D-05/D-06/D-07, and rejected-settlement-vs-error-variant behaviors
- `src/lib/pipeline/fanOutTiming.test.ts` - new, 3 hermetic tests over concurrency and stall isolation, using 3 separate fixture-server instances

## Decisions Made
- Rewrote every code comment in `fanOut.test.ts` that referenced the fixture's never-responding route by its literal path so it no longer contains the substring `/hang` — the plan's own `FAST_FAILURE_MODES_ONLY` verify gate greps for that literal string's absence across the whole file (not just executable code), and a prose comment matched it on the first pass
- Split the timing file's stall-isolation proof into two `test()` blocks sharing one memoized ~8s fetch run (via a lazily-initialized, cached promise), satisfying the plan's literal "at least 3 test() blocks" acceptance criterion without paying the ~8s stall cost twice
- Used a top-level `await startHostileServer()` (three times, once per origin) per file, closed in an `after()` hook, per the plan's explicit instruction to mirror `fetchWithValidatedRedirect.test.ts`'s fixture lifecycle

## Deviations from Plan

None — plan executed exactly as written. The `/hang`-substring comment rewrite above is a literal-compliance detail within Task 2's own verify gate, not a deviation from the plan's specified behavior, tests, or acceptance criteria.

## Issues Encountered
- The worktree had no `node_modules` (created before dependencies were installed into it, same pattern as Plans 02-01 and 02-02). Ran `npm ci` against the existing `package-lock.json` before the first test run — restores already-locked dependencies, not a new package install, so it is not gated by the Rule 3 package-legitimacy exclusion. No `package.json`/`package-lock.json` changes resulted.
- `npm test`'s first run (before any production build existed in this worktree) failed 4 of `test/productionPage.test.ts`'s tests with "Could not find a production build in the '.next' directory" — a pre-existing environmental precondition of that test file, not a regression from this plan's changes. Ran `npm run build` (already required by Task 3's own verify gate) before re-running `npm test`; all 73 tests then passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- ROADMAP Phase 2's three Success Criteria are now all proven against real sockets: parallel fetch (Criterion 1, this plan), failure isolation (Criterion 2, this plan), and the unified multi-source render path (Criterion 3, Plans 02-01/02-02's e2e tests)
- Phase 2 is complete pending the orchestrator's phase-level verification and the plan's own deferred human-check item (deliberately pointing one `sources.ts` entry at a dead URL on a running dev server, confirming the page still renders the other sources' articles with no visible error anywhere, then reverting)
- Full regression suite (73 tests) passes with zero failures; `npm run build` and `npm run lint` both exit 0
- No new `WINDOWS.md` entries needed — no stubs, skipped tests, or unrun `<verify>` gates were introduced by this plan

## Self-Check: PASSED

All created/modified files exist (`fanOut.test.ts`, `fanOutTiming.test.ts`, `hostileRedirectServer.ts`) and all three task commit hashes (`97e5860`, `0e887e9`, `6cbd53b`) are present in `git log`.

---
*Phase: 02-full-ingestion-failure-isolation*
*Completed: 2026-09-22*
