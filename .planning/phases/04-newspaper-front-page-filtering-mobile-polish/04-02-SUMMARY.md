---
phase: 04-newspaper-front-page-filtering-mobile-polish
plan: 02
subsystem: ui
tags: [nextjs, react-19, use-sync-external-store, hydration, disclosure-widget, utc-time]

requires:
  - phase: 04-newspaper-front-page-filtering-mobile-polish
    provides: "SectionFilterBar, SectionVisibility, CARD_GRID_CLASSES, filterControlStyles constants, production-test helpers (04-01)"
  - phase: 03-classification-ranking
    provides: "composeFrontPage with single threaded now (D-09); ranked SectionGroup lists"
provides:
  - "generatedAt ISO snapshot timestamp on the ok result, stamped from the single injected now"
  - "Hydration-safe Updated text: UTC in server HTML and during hydration, relative and ticking afterwards"
  - "Deterministic locale-free UTC formatters (formatUtcTime, formatUtcDateTime)"
  - "formatRelativeTime with a back-compatible optional now"
  - "Top-6 cap per long section behind a client-side Show all N expander, all cards in initial HTML"
affects: [04-03]

actuals:
  tokens: 5100
  tasks: 3
  commits: 5
plan_head_before: c63af4c74e5f5dd5f0123b16ccbcabf32617635a

tech-stack:
  added: []
  patterns:
    - "useSyncExternalStore clock with a null server snapshot: lint-clean, hydration-safe time-dependent text"
    - "Disclosure widget: server-rendered children toggled only by the plain hidden attribute, flushSync then scrollIntoView on collapse"
    - "Pure planner (planSectionCap) plus config constants for section length policy"

key-files:
  created:
    - src/lib/formatUtcTime.ts
    - src/lib/formatUtcTime.test.ts
    - src/components/LastUpdated.tsx
    - src/lib/config/frontPageLayout.ts
    - src/lib/planSectionCap.ts
    - src/lib/planSectionCap.test.ts
    - src/components/SectionExpander.tsx
  modified:
    - src/lib/types.ts
    - src/lib/pipeline/getFrontPage.ts
    - src/lib/pipeline/getFrontPage.test.ts
    - src/lib/formatRelativeTime.ts
    - src/lib/formatRelativeTime.test.ts
    - src/components/SectionFilterBar.tsx
    - src/app/page.tsx
    - test/productionPage.test.ts

key-decisions:
  - "Updated text is never server-computed relative: server HTML and hydration carry the UTC form, the client switches to relative after hydration (D-13)"
  - "Collapsed overflow cards use plain hidden, so find-in-page skips them until expanded; accepted v1 limitation"
  - "Post-mount hover title uses new Date(generatedAt).toLocaleString() (local time); it lints clean, so no UTC fallback was needed"

patterns-established:
  - "External-store clock instead of effect-plus-state mount flag (repo lint rules reject the latter)"
  - "Production-HTML invariants for cap split: 6 cards before the hidden region, count-6 inside it, none under 9"

requirements-completed: [UI-04, UI-01]

coverage:
  - id: D1
    description: "Sticky bar states when the snapshot was built: Updated HH:MM UTC in served HTML with ISO dateTime and UTC hover title, threaded from the single now"
    requirement: UI-04
    verification:
      - kind: unit
        ref: "src/lib/pipeline/getFrontPage.test.ts#composeFrontPage stamps generatedAt from the injected now, never from the wall clock"
        status: pass
      - kind: unit
        ref: "src/lib/formatUtcTime.test.ts"
        status: pass
      - kind: integration
        ref: "test/productionPage.test.ts#the bar's Updated text is the snapshot's deterministic UTC time in the served HTML"
        status: pass
    human_judgment: false
  - id: D2
    description: "After hydration the text switches to Updated just now / Nm ago / Nh ago and re-evaluates every 60 s, with no hydration mismatch"
    requirement: UI-04
    verification:
      - kind: unit
        ref: "src/lib/formatRelativeTime.test.ts (explicit-now cases)"
        status: pass
      - kind: other
        ref: "grep gate CLOCK_IS_EXTERNAL_STORE; npm run lint (no set-state-in-effect or purity finding)"
        status: pass
    human_judgment: true
    rationale: "The post-hydration switch and the 60 s tick are runtime browser behaviour; verified in the real browser/preview pass in plan 04-03"
  - id: D3
    description: "Sections of 9 or more show the 6 highest-ranked cards, then Show all N revealing the rest from the initial HTML; 1-8 render fully with no region or button"
    requirement: UI-01
    verification:
      - kind: unit
        ref: "src/lib/planSectionCap.test.ts"
        status: pass
      - kind: integration
        ref: "test/productionPage.test.ts#sections of 9 or more articles show exactly 6 cards before a hidden overflow region holding the rest; smaller sections have neither region nor button"
        status: pass
    human_judgment: false
  - id: D4
    description: "Expander press reveals/collapses instantly, keeps the button in view on collapse, and its state survives filtering"
    requirement: UI-01
    verification:
      - kind: other
        ref: "grep gate EXPANDER_TOGGLES_HIDDEN_ONLY (hidden, aria-expanded, aria-controls, flushSync)"
        status: pass
    human_judgment: true
    rationale: "Click, scroll position and filter-survival are interactive; verified at real viewports in plan 04-03"
  - id: D5
    description: "Route stays static with 900 s revalidation and byte-identical HTML after the new client leaves"
    verification:
      - kind: integration
        ref: "test/productionPage.test.ts#the front page is still statically prerendered with the 900-second revalidation window"
        status: pass
    human_judgment: false

duration: 4 min
completed: 2026-10-01
status: complete
---

# Phase 4 Plan 02: Snapshot freshness and section length handling Summary

**An honest "Updated" clock in the sticky bar (exact UTC in cached HTML, relative and ticking after hydration via useSyncExternalStore) plus a top-6 cap per long section behind a hidden-attribute "Show all N" expander.**

## Performance

- **Duration:** about 4 minutes of active work
- **Started:** 2026-10-01T07:24:55Z
- **Completed:** 2026-10-01T07:28:24Z (code); close-out follows
- **Tasks:** 3 (Task 1 tracer, Tasks 2 and 3 auto, all TDD)
- **Files modified:** 15

## Accomplishments

- `composeFrontPage` stamps `generatedAt: new Date(now).toISOString()` from the one threaded `now`; nothing in the composition reads the clock. The value flows through `page.tsx` to `SectionFilterBar` to `LastUpdated`.
- `LastUpdated` renders `Updated HH:MM UTC` (with ISO `dateTime` and a `YYYY-MM-DD HH:MM UTC` title) on the server and during hydration, then `Updated just now / Nm ago / Nh ago` with a local-time title, re-evaluated every 60 s. It uses `useSyncExternalStore` with a null server snapshot, no effect and no state, and lints clean.
- Sections with 9 or more articles render 6 cards, then a `hidden` overflow region holding the rest and a 44px `Show all N` / `Show fewer` button (`aria-expanded`, `aria-controls`, after the region in tab order). Sections of 1 to 8 render in full. Every card stays in the initial HTML.
- The route stays static at 900 s; byte-identical HTML test still green.

## Verification Build Facts (requested by the plan)

- **Sections with an expander on the verification build:** 3 of 7 (diagnostic line: `expanders on this build: 3 of 7 sections`).
- **Post-mount hover title:** uses the local-time format (`new Date(generatedAt).toLocaleString()`). Lint accepted it, so the UTC fallback was not needed.

## Task Commits

1. **Task 1 (tracer): bar states when the snapshot was built** - `feffef7` (test, RED) then `fa4b209` (feat, GREEN)
2. **Task 2: Updated text turns relative after hydration** - `8fdd203` (test, RED) then `73ebcc3` (feat, GREEN)
3. **Task 3: top-6 cap with Show all N** - `8dfd38d` (feat)

**Plan metadata:** recorded in the final docs commit.

## Files Created/Modified

- `src/lib/types.ts`, `src/lib/pipeline/getFrontPage.ts` and its test - `generatedAt` on the ok variant
- `src/lib/formatUtcTime.ts` and `.test.ts` - UTC formatters
- `src/lib/formatRelativeTime.ts` and `.test.ts` - optional `now`, three new cases
- `src/components/LastUpdated.tsx` - hydration-safe Updated text
- `src/components/SectionFilterBar.tsx` - trailing-edge wrapper, `generatedAt` prop
- `src/lib/config/frontPageLayout.ts`, `src/lib/planSectionCap.ts` and `.test.ts` - cap policy and planner
- `src/components/SectionExpander.tsx` - overflow region and button
- `src/app/page.tsx` - passes `generatedAt`, splits each section at the cap
- `test/productionPage.test.ts` - UTC-in-HTML test and cap/overflow invariants test

## Decisions Made

- UTC text on the server, relative text only on the client (D-13); the age shown is the page snapshot's age, so an idle cached page honestly reads for example `72h ago`.
- Plain `hidden` for collapsed cards; find-in-page does not search them until expanded (accepted v1 limitation, documented in `SectionExpander.tsx`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Task 1's SNAPSHOT_TIME_FROM_INJECTED_NOW gate could never pass as written**
- **Found during:** Task 1 verification
- **Issue:** The gate greps `Date.now` with an unescaped dot, which also matches the plan-mandated line `generatedAt: new Date(now).toISOString()` (`Date(now`). The sentinel never printed even though the code was correct.
- **Fix:** Ran the intended check with the dot escaped (`Date\.now`). It confirms composeFrontPage and the UTC formatter contain no wall-clock read, and the sentinel printed. No source change.
- **Files modified:** none
- **Commit:** n/a

### Process notes

- `planSectionCap`, its config and its test were written together in one step, so a separate failing-test run was not captured for Task 3 (the other two tasks have distinct RED commits). The function is a few lines and the 10 unit tests plus the production invariants cover it.
- The Task 1 tracer has no `gate` attribute and an automated-only verify, so under `end-of-phase` mode the verify was re-run and passed rather than pausing for a human check. Interactive behaviour (post-hydration switch, expander click, filter survival) is deferred to the 04-03 real-browser pass.

**Total deviations:** 1 auto-fixed (verification gate defect), 0 code changes.
**Impact on plan:** none on scope or behaviour.

## Issues Encountered

None. Full suite: `npm test` reports 251 tests, 244 pass, 0 fail, 7 skipped by their own guards; build and lint clean.

## Known Stubs

None.

## Threat Flags

None. No new endpoints, auth paths or storage. Client props added are the server-generated `generatedAt` ISO string, a closed section name and a count; CLIENT_SURFACE_CLEAN passes (T-04-06, T-04-03 mitigations hold).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for 04-03 (viewport verification and sign-off). Items for the real-browser pass: confirm the Updated text switches to relative without a hydration warning and ticks, the expander toggles and keeps its place on collapse, expanded state survives filtering, and `generatedAt` against the newest article time on the preview (Assumption A2). The ring-zinc-500 amendment from 04-01 still awaits sign-off there, and the expander reuses it.

---
*Phase: 04-newspaper-front-page-filtering-mobile-polish*
*Completed: 2026-10-01*

## Self-Check: PASSED

Created files exist (formatUtcTime.ts/.test.ts, LastUpdated.tsx, frontPageLayout.ts, planSectionCap.ts/.test.ts, SectionExpander.tsx); commits feffef7, fa4b209, 8fdd203, 73ebcc3, 8dfd38d exist on the phase branch; build, full test suite, lint and gates pass.
