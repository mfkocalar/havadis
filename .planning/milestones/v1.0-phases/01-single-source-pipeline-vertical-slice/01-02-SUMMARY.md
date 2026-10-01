---
phase: 01-single-source-pipeline-vertical-slice
plan: 02
subsystem: ui
tags: [nextjs, tailwind, clsx, server-components, article-card, source-tier-badge]

# Dependency graph
requires:
  - phase: 01-01
    provides: "getFrontPage()'s FrontPageResult/Article shapes and the real Krebs on Security pipeline this plan renders"
provides:
  - "formatRelativeTime(isoDate): pure 3-case relative-time formatter (just now / Nm ago / Nh ago) with a future-timestamp clock-skew guard"
  - "SourceTierBadge({ tier }): clsx-branched coloured pill, tier-keyed colour map ready for Phase 2's remaining five tiers"
  - "ArticleCard({ article }): the complete six-field UI-02 card in the Modern editorial direction, zero client JavaScript"
  - "Havadis masthead + real page metadata in the root layout"
  - "Front page card list plus the D-03 quiet empty-state line, same outer structure for the ok/empty/error branches"
affects: [01-03-hermetic-redirect-fixture-and-production-contract, 02-full-ingestion-failure-isolation, 03-dedup-classify-rank, 04-full-seven-section-layout-polish]

# Actuals (#2632)
actuals:
  tokens: 2968
  tasks: 3
  commits: 3
  plan_head_before: 48c0c9c81ed5fb90710fd26f37977aff70e02650

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SourceTierBadge's tier-keyed Record<SourceTier, string> colour map — Phase 2 extends the map, never the JSX"
    - "Native <time dateTime title> for absolute-time-on-hover — zero client JavaScript, no tooltip component"
    - "Page renders getFrontPage()'s discriminant only; internal error detail (reason string) never reaches JSX"
    - "Same outer <main> structure across the populated/empty/error branches so D-03's empty state never visibly restructures the page"

key-files:
  created:
    - src/lib/formatRelativeTime.ts
    - src/lib/formatRelativeTime.test.ts
    - src/components/SourceTierBadge.tsx
    - src/components/ArticleCard.tsx
  modified:
    - src/app/page.tsx
    - src/app/layout.tsx
    - src/app/globals.css

key-decisions:
  - "Security Research tier gets a distinct indigo pill; the other five tiers share one neutral slate default (CONTEXT.md D-04/A2 — explicitly deferred, not an omission)"
  - "Chose slate-700-on-slate-100 (not slate-600) for the neutral badge variant to keep AA contrast margin comfortable at the pill's small text size"
  - "Native <time title> attribute for absolute-time-on-hover over a custom tooltip component, keeping ArticleCard a pure zero-JS Server Component (Claude's Discretion per CONTEXT.md)"
  - "Single generic 'Latest' header above the flat article list, since real section grouping doesn't exist until Phase 3 (Claude's Discretion per CONTEXT.md)"
  - "article.url used as the React list key (not index), matching the plan's explicit instruction that duplicate keys are an honest signal deferred to Phase 3's NORM-02 dedup"

patterns-established:
  - "Tier-to-colour-classes map as the single extension point for Phase 2's five remaining tiers"
  - "Discriminant-only branching on FrontPageResult in app/page.tsx — never render the error variant's reason string"

requirements-completed: [UI-02, UI-06]

coverage:
  - id: D1
    description: "formatRelativeTime covers all three 24h-window cases (just now / Nm ago / Nh ago), the 59/60-minute boundary, and a future-timestamp clock-skew guard"
    requirement: "UI-02"
    verification:
      - kind: unit
        ref: "src/lib/formatRelativeTime.test.ts (6 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "SourceTierBadge renders a coloured pill (not plain text, not icon+label) with a distinct Security Research colour and a neutral default for the other five tiers"
    requirement: "UI-02"
    verification:
      - kind: other
        ref: "grep assertions in Task 2's verify block: clsx import, tier-keyed map, no tailwind.config.js/.ts; npm run build && npm run lint both exit 0"
        status: pass
    human_judgment: true
    rationale: "WCAG AA contrast and the visual quality of the colour choice itself (D-02's Modern editorial direction) are design judgments no automated gate in this plan checks numerically — flagged for the phase-end UAT pass, consistent with 01-01's own human_verify_mode:end-of-phase handling."
  - id: D3
    description: "ArticleCard renders all six UI-02 fields (source, tier badge, verbatim untruncated title, summary, relative+absolute time, outbound link with rel=noopener noreferrer) with zero client JavaScript and no raw-HTML injection path"
    requirement: "UI-02"
    verification:
      - kind: other
        ref: "Task 2 verify block: CARD_FIELDS_OK grep gate (6 field checks), negative grep for dangerouslySetInnerHTML/use client, negative grep for line-clamp/truncate/.slice(/substring(; npm run build && npm run lint both exit 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "The front page shows the Havadis masthead, real metadata, and renders ArticleCards in getFrontPage() order (or the D-03 empty-state line on the error/zero-article branches) with no auth surface anywhere under src/app"
    requirement: "UI-06"
    verification:
      - kind: other
        ref: "Task 3 verify block: PAGE_WIRED grep gate, negative grep for .sort(/.reverse(/reason, STILL_PUBLIC grep gate (no cookies()/headers()/next-auth/@clerk, no middleware.ts); npm run build && npm run lint both exit 0"
        status: pass
      - kind: manual_procedural
        ref: "npm run build && curl -D- http://localhost:3000/ (attempted): HTTP 200, Cache-Control/x-nextjs-cache headers matched the 900s revalidate config, body contained the Havadis masthead and the D-03 empty-state line (Krebs's latest post is still >24h old at this session's time, same as 01-01's finding)"
        status: pass
    human_judgment: true
    rationale: "This plan's own Task 3 <human-check> asks for a real browser visit (visual read of the Modern editorial direction, a 360px-viewport look, and a live click-through to krebsonsecurity.com). Port 3000 was contended by a concurrent sibling worktree's dev server during this session, so `npm start`'s own bind failed (EADDRINUSE) and the curl probe above actually hit the sibling process rather than this plan's build — its output is corroborating evidence only, not a substitute for this plan's own server. Per workflow.human_verify_mode:end-of-phase, the real browser check is deferred to the phase-end UAT pass, same disposition 01-01 already used for its own human-check."

# Metrics
duration: 18min
completed: 2026-09-18
status: complete
---

# Phase 1 Plan 2: UI Card, Masthead, and Empty State Summary

**Complete six-field UI-02 article card, tier-coloured pill, Havadis masthead, and the D-03 quiet empty state, in a zero-client-JS "Modern editorial" front page.**

## Performance

- **Duration:** ~18 min
- **Tasks:** 3 planned tasks, all completed
- **Files modified:** 4 created, 3 modified

## Accomplishments

- Built `formatRelativeTime`, a hand-rolled 3-case relative-time formatter with a future-timestamp clock-skew guard, pinned by 6 passing unit tests — no date-formatting library added
- Built `SourceTierBadge`, a `clsx`-branched coloured pill with a distinct Security Research colour and a neutral default for the other five tiers, ready for Phase 2 to extend by map entry rather than JSX edit
- Built the complete `ArticleCard` — all six UI-02 fields, verbatim/untruncated title and summary as plain JSX text nodes, native `<time dateTime title>` for absolute-time-on-hover, and an outbound anchor with `rel="noopener noreferrer"` — as a zero-client-JavaScript Server Component
- Added the Havadis masthead and real page metadata to the root layout, still with no provider, session, cookie read, or middleware
- Replaced the tracer's linked-title list in `page.tsx` with the real card list, mapping in `getFrontPage()`'s exact order (`article.url` as key, no sort/reverse), and rendering the D-03 quiet empty-state line with the same outer structure for both the error variant and the zero-article variant — never surfacing the error variant's internal reason string
- Added base heading/paragraph line-height to `globals.css` for the Modern editorial direction, without touching the Tailwind v4 `@import`/PostCSS setup

## Task Commits

Each task was committed atomically:

1. **Task 1: Relative-time formatter with the 24-hour window's three cases** - `75d867b` (test)
2. **Task 2: Source-tier badge and the complete UI-02 article card** - `1340643` (feat)
3. **Task 3: Masthead, card list, and the quiet empty state** - `702eb9b` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `src/lib/formatRelativeTime.ts` - pure 3-case relative-time formatter with negative-diff clamp
- `src/lib/formatRelativeTime.test.ts` - boundary tests (just-now, 1m, 59m, 60m→1h, 23h, future)
- `src/components/SourceTierBadge.tsx` - tier-keyed coloured pill, `clsx`-branched
- `src/components/ArticleCard.tsx` - complete six-field UI-02 card, zero client JS
- `src/app/page.tsx` - card list in feed order + D-03 empty-state line, no error-detail leak
- `src/app/layout.tsx` - Havadis masthead + real `metadata` title/description
- `src/app/globals.css` - base typography for the Modern editorial direction

## Decisions Made

- Only the Security Research tier's colour is decided (indigo); the other five tiers share a neutral slate default, per CONTEXT.md D-04/A2's explicit deferral to Phase 2/4 — not an omission
- Used slate-700-on-slate-100 rather than the initially-considered slate-600 for the neutral badge variant, for a safer AA contrast margin at the pill's small text size
- Native `<time title>` chosen over a custom tooltip component for absolute-time-on-hover, keeping `ArticleCard` a pure Server Component with zero client JavaScript (Claude's Discretion)
- A single generic "Latest" header sits above the flat article list, since real section grouping is Phase 3's concern (Claude's Discretion)
- `article.url` used as the React list key rather than index, per the plan's explicit instruction — a future duplicate-key warning on identical articles is the honest signal Phase 3's NORM-02 dedup resolves, not a bug to paper over here

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree had no `node_modules` — build/lint could not run**
- **Found during:** Task 2 (first `npm run build` attempt)
- **Issue:** This worktree was created from the git tree only; `node_modules/` (and thus `next`) did not exist, so Turbopack failed with "Could not find the Next.js package"
- **Fix:** Ran `npm ci` against the existing `package-lock.json` — no dependency versions changed, only the local install was materialized
- **Files modified:** none (node_modules is gitignored)
- **Verification:** `npm run build` and `npm run lint` both exit 0 afterward
- **Committed in:** not applicable (no tracked files changed)

**2. [Rule 1 - Bug] JSDoc block comments accidentally matched the plan's own negative-grep security gates**
- **Found during:** Task 2 and Task 3 verify blocks
- **Issue:** `ArticleCard.tsx`'s doc comment named `dangerouslySetInnerHTML` literally, and `page.tsx`'s doc comment used the word "reason" — both inside `/** */` block comments, which the plan's negative-grep gates (correctly) only exempt for `//`-style comments. This tripped the "no raw-HTML injection prop" and "no error-reason leak" gates on documentation text, not real code
- **Fix:** Reworded both comments to describe the same guarantee without using the literal matched strings ("no raw-HTML injection prop is used" / "none of the error variant's internal diagnostic detail")
- **Files modified:** src/components/ArticleCard.tsx, src/app/page.tsx
- **Verification:** both negative-grep gates pass with zero matches; comment meaning is unchanged
- **Committed in:** 1340643, 702eb9b (part of each task's own commit — caught before committing)

---

**Total deviations:** 2 auto-fixed (1 blocking install, 1 gate-safe comment wording)
**Impact on plan:** Neither changed application behavior. The `npm ci` was required for any verification to run at all in this worktree; the comment rewording only affected documentation text, not the security guarantees themselves (which the code already satisfied).

## Issues Encountered

- Port 3000 was occupied by a concurrent sibling worktree's `next start`/`next dev` process during this session (a parallel wave-2 plan running in another agent worktree). This plan's own `npm start` failed with `EADDRINUSE` and exited immediately — no server from this plan ever bound the port, and no files were affected. The `curl` probe recorded in coverage item D4 above hit the sibling process, not this plan's build, so it is recorded as corroborating evidence only, not as this plan's own verification. The full browser-based `<human-check>` (visual read of the Modern editorial direction, 360px-viewport look, live click-through to the real Krebs article) is deferred to the phase-end UAT pass, consistent with `workflow.human_verify_mode: "end-of-phase"` and matching how 01-01's own SUMMARY handled the same situation.

## Human Verification Deferred (human_verify_mode: end-of-phase)

Task 3's `<human-check>` asks for a real browser visit after `npm run build && npm start`. Because port 3000 was contended by a concurrent sibling worktree this session, this executor could not bind its own server to verify directly. What was confirmed instead:
- `npm run build` and `npm run lint` both exit 0 across all three tasks
- Every grep-based structural gate in the plan's `<verify>` blocks passes (CARD_FIELDS_OK, PAGE_WIRED, STILL_PUBLIC, TAILWIND_V4_SETUP, no-truncation, no-client-directive)
- The sibling worktree's server response (same repo state family, not this plan's own build) showed HTTP 200, correct `Cache-Control`/`x-nextjs-cache` headers, the Havadis masthead string, and the D-03 empty-state line in the body — consistent with, but not proof of, this plan's own build

A real browser click-through against this specific worktree's build (visual direction, 360px viewport, outbound link behavior, no login prompt) is still required at the phase-end UAT pass — flagged as coverage items D2 and D4 above with `human_judgment: true`.

## Next Phase Readiness

- The front page now renders the real six-field UI-02 card, the tier badge, and the masthead against Plan 01's live `Article[]` data — no stub or placeholder data anywhere in this plan's files
- `SourceTierBadge`'s tier-keyed map is the documented extension point for Phase 2's remaining five tiers (append map entries, no JSX changes)
- The "Modern editorial" visual direction (D-02) is now concretely established in `ArticleCard`/`SourceTierBadge`/the masthead for Phase 3's `SectionGroup` and Phase 4's polish pass to extend, not redefine
- Plan 01-03's stated scope (hermetic redirect/timeout fixture, production-contract verification) is unaffected by this plan and remains open work
- No blockers for Phase 1 Plan 03, other than the standing phase-end UAT items noted above (D2, D4)

## Self-Check: PASSED

- All 7 files listed under `key-files` (created + modified) verified present on disk via `test -f`.
- All 3 task commit hashes (75d867b, 1340643, 702eb9b) verified present via `git log --oneline`.

---
*Phase: 01-single-source-pipeline-vertical-slice*
*Completed: 2026-09-18*
