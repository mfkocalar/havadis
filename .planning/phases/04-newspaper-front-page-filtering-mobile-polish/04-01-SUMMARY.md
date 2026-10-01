---
phase: 04-newspaper-front-page-filtering-mobile-polish
plan: 01
subsystem: ui
tags: [nextjs, react-context, tailwind, accessibility, wcag-contrast, client-filter]

requires:
  - phase: 03-classification-ranking
    provides: "Sectioned, ranked getFrontPage() result; ArticleCard; SECTION_EMOJI and SECTION_DISPLAY_ORDER"
provides:
  - "Client-side multi-select section filter (pills, DOM-less provider, hidden-attribute visibility wrapper)"
  - "Sticky count-bearing filter bar under the masthead"
  - "1/2/3-column card grid per section in an aligned max-w-7xl container"
  - "Per-section full article count on heading and pill"
  - "WCAG contrast gate over the installed Tailwind zinc palette"
affects: [04-02, 04-03]

actuals:
  tokens: 9700
  tasks: 2
  commits: 3
plan_head_before: 705b9ef2c8265d230420025faba4c4b5e972d93e

tech-stack:
  added: []
  patterns:
    - "DOM-less client context provider; server-rendered sections passed as children and hidden via the hidden attribute, never unmounted"
    - "Class-string constants in a pure module, with a test that resolves their tokens against the installed Tailwind palette"
    - "Count invariants asserted from production HTML (section, heading and pill counts must agree)"

key-files:
  created:
    - src/lib/sectionFilter.ts
    - src/lib/sectionFilter.test.ts
    - src/lib/filterControlStyles.ts
    - src/lib/filterControlStyles.test.ts
    - src/components/FrontPageFilter.tsx
    - src/components/SectionFilterBar.tsx
  modified:
    - src/app/page.tsx
    - src/app/layout.tsx
    - src/app/globals.css
    - test/productionPage.test.ts

key-decisions:
  - "Unpressed pill and neutral-control outline uses ring-zinc-500 in both themes (amends UI-SPEC zinc-400 / dark zinc-600); enforced by the contrast gate"
  - "Filtered sections are hidden with the hidden attribute on a bare wrapper div, never unmounted, so all cards stay in the server HTML"
  - "Scroll-after-filter runs after a flushSync commit, only when the bar is stuck, relying on html scroll-padding-top: 6rem"
  - "Plan work committed on gsd/phase-04-newspaper-front-page-filtering-mobile-polish, not main (see Deviations)"

patterns-established:
  - "Client props limited to section names, emoji and counts (T-01-07); client files never import the sections config or article types"
  - "Test hooks in markup: data-filter-bar, data-filter-pill, data-count, data-heading-count"

requirements-completed: [FILTER-01, UI-01, UI-04, UI-05]

coverage:
  - id: D1
    description: "Sticky bar of per-section pills in urgency order with counts; tapping narrows the page client-side, multi-select, deselecting the last pill shows all sections"
    requirement: FILTER-01
    verification:
      - kind: unit
        ref: "src/lib/sectionFilter.test.ts#isSectionVisible shows every section when nothing is selected (D-09)"
        status: pass
      - kind: integration
        ref: "test/productionPage.test.ts#the filter bar renders one unpressed pill per rendered section, in section order, inside the labelled group, above main"
        status: pass
    human_judgment: false
  - id: D2
    description: "Tracer interaction on the production build: one pill, two pills, deselect, no network request, sticky bar scroll behaviour"
    requirement: FILTER-01
    verification: []
    human_judgment: true
    rationale: "Interactive behaviour in a real browser; the user ran the tracer human-check and replied approved"
  - id: D3
    description: "Full article count shown on each section heading and pill, equal to the cards rendered in the HTML"
    requirement: UI-04
    verification:
      - kind: integration
        ref: "test/productionPage.test.ts#every rendered section carries one full article count on its section, heading and pill, and every card is in the initial HTML"
        status: pass
    human_judgment: false
  - id: D4
    description: "Section cards in a 1/2/3-column grid inside a shared max-w-7xl masthead/bar/main container"
    requirement: UI-01
    verification:
      - kind: other
        ref: "grep gates CONTAINERS_ALIGNED_7XL and GRID_AND_FOCUS_OFFSET_OK"
        status: pass
    human_judgment: true
    rationale: "Visual layout at real widths is verified in plan 04-03 (emulated and real devices); this plan only proves the class structure"
  - id: D5
    description: "Filter control colour pairs meet 4.5:1 (text) and 3:1 (non-text) against the real Tailwind palette in light and dark"
    requirement: UI-05
    verification:
      - kind: unit
        ref: "src/lib/filterControlStyles.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "Route stays statically prerendered with a 900-second revalidation window and byte-identical HTML"
    verification:
      - kind: integration
        ref: "test/productionPage.test.ts#the front page is still statically prerendered with the 900-second revalidation window"
        status: pass
    human_judgment: false

duration: 5 min active (plus the tracer human-check pause)
completed: 2026-10-01
status: complete
---

# Phase 4 Plan 01: Filterable newspaper front page Summary

**Sticky count-bearing section pills with a client-only multi-select filter (hidden attribute, no unmounting, no network), a 1/2/3-column card grid in an aligned max-w-7xl shell, and a WCAG contrast gate measured against the installed Tailwind zinc palette.**

## Performance

- **Duration:** about 5 minutes of active work, plus the pause for the tracer human-check
- **Started:** 2026-10-01T07:18:41Z
- **Completed:** 2026-10-01T07:23:15Z (code); close-out follows
- **Tasks:** 2 (Task 1 tracer, Task 2 auto)
- **Files modified:** 10

## Accomplishments

- Pure filter logic (`toggleSection`, `isSectionVisible`, `filterStatusMessage`, `articleCountLabel`) with 12 hermetic tests; D-09 "nothing selected means all" is the reset, so no clear button exists.
- `FrontPageFilter` is a DOM-less context provider; `SectionVisibility` wraps each server-rendered section in a bare div with `hidden`, so every card stays in the initial HTML. `SectionFilterBar` renders `aria-pressed` pills with a visually hidden `, N articles` suffix and a `role="status"` live region.
- `page.tsx` computes one count per section and reuses it for pill, heading and markup hooks. Empty and error states render only the verbatim empty copy with no bar.
- Cards sit in `grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3`; masthead, bar and main share `max-w-7xl`; `html { scroll-padding-top: 6rem }` keeps focus clear of the bar.
- Production tests (run against `next start`) assert pill order, unpressed state, count agreement, all cards in HTML, and `/` static at 900s. The live build rendered all 7 sections.

## Tracer Human-Check Result

Task 1 tracer human-check (pill toggling on the production server, zero network requests, sticky bar scroll): **approved** by the user. Note the sticky-bar scroll landing was checked before Task 2 added `scroll-padding-top`.

## UI-SPEC amendments pending sign-off

**Unpressed control outline: `ring-zinc-500` in both themes** instead of the approved 04-UI-SPEC.md Color values (`ring-zinc-400` light, `dark:ring-zinc-600`). Reverting is a one-constant edit in `NEUTRAL_CONTROL_CLASSES` (`src/lib/filterControlStyles.ts`). It is also used by the 04-02 "Show all N" expander. To be collected for sign-off at 04-03 Task 3.

Measured ratios from the installed palette (the contrast gate asserts these):

| Pair | Ratio |
|------|-------|
| Original UI-SPEC ring, zinc-400 on white | 2.63 (below 3.0) |
| Original UI-SPEC ring, zinc-600 on zinc-900 | 2.29 (below 3.0) |
| Amended ring zinc-500 on white / page (light) | 4.83 |
| Amended ring zinc-500 on zinc-900 / zinc-950 / page (dark) | 3.67 / 4.12 / 4.10 |
| Neutral text zinc-700 on white / on hover zinc-100 | 10.46 / 9.50 |
| Neutral text zinc-300 on zinc-900 / on hover zinc-800 | 11.99 / 10.07 |
| Muted text zinc-600 on white / on hover zinc-100 | 7.73 / 7.02 |
| Muted text zinc-400 on zinc-900 / on hover zinc-800 | 6.74 / 5.66 |
| Pressed text zinc-50 on zinc-900 | 16.98 |
| Pressed count zinc-300 on zinc-900 / (dark) zinc-600 on zinc-50 | 11.99 / 7.40 |
| Section heading zinc-500 on white / zinc-400 on dark page | 4.83 / 7.53 |

## Task Commits

1. **Task 1 (tracer): tap a section pill and the page narrows** - `fe65af8` (test, RED) then `6d532c0` (feat, GREEN)
2. **Task 2: newspaper grid, 7xl container, focus offset, contrast gate** - `0522de8` (feat)

**Plan metadata:** recorded in the final docs commit.

## Files Created/Modified

- `src/lib/sectionFilter.ts` and `.test.ts` - pure filter logic and 12 tests
- `src/lib/filterControlStyles.ts` and `.test.ts` - control class constants and the oklch-based contrast gate
- `src/components/FrontPageFilter.tsx` - provider, `useSectionFilter`, `SectionVisibility`
- `src/components/SectionFilterBar.tsx` - sticky pill bar with live status region
- `src/app/page.tsx` - provider, bar, visibility wrappers, counts, `CARD_GRID_CLASSES` grid
- `src/app/layout.tsx` - masthead container `max-w-7xl`
- `src/app/globals.css` - `scroll-padding-top: 6rem`
- `test/productionPage.test.ts` - three production-build invariants added

## Decisions Made

- `ring-zinc-500` ring amendment (see above).
- Pill count rendered `aria-hidden` with the accessible count in one `sr-only` suffix so the section name is read once (Pitfall 8).
- Scroll-after-filter uses `flushSync` rather than an effect (Pitfall 11).

## Deviations from Plan

### Process deviation: work committed on a phase branch, not main

**[Process] Executor commit-safety gate refused `main`**
- **Found during:** start of Task 1
- **Issue:** `git.base-branch --is-protected main` returns true and `git.allow_default_branch_commits` is unset, so the executor protocol forbids committing on `main`. The orchestrator instructed committing on main, which cannot override the guard or change config.
- **Fix:** created and switched to `gsd/phase-04-newspaper-front-page-filtering-mobile-polish` (the config's `phase_branch_template`). The user confirmed keeping this branch with no config change and will merge to `main` themselves.
- **Files modified:** none
- **Commits:** all plan commits are on that branch

No code deviations from the plan.

**Total deviations:** 1 process deviation, 0 code auto-fixes.
**Impact on plan:** none on scope; the user must merge the branch to `main`.

## Issues Encountered

None. The full suite (`npm test`) reports 222 passing, 0 failing; remaining tests are skipped by their own guards.

## Known Stubs

None.

## Threat Flags

None. No new endpoints, auth paths or storage; client props are section names, emoji and counts only, and the CLIENT_SURFACE_CLEAN and CLIENT_GRAPH_MINIMAL gates pass.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for 04-02 (freshness timestamp and "Show all N" expander): `CARD_GRID_CLASSES`, `SectionVisibility` and the bar's trailing edge are the seams. The ring amendment awaits sign-off in 04-03 Task 3, and layout at real widths is verified there.

---
*Phase: 04-newspaper-front-page-filtering-mobile-polish*
*Completed: 2026-10-01*

## Self-Check: PASSED

Created files exist (sectionFilter.ts/.test.ts, filterControlStyles.ts/.test.ts, FrontPageFilter.tsx, SectionFilterBar.tsx); commits fe65af8, 6d532c0, 0522de8 exist on the phase branch; build, production tests, lint and gates pass.
