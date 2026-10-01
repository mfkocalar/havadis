# Milestones

## v1.0 MVP (Shipped: 2026-10-01)

**Phases completed:** 4 phases, 14 plans, 40 tasks

**Key accomplishments:**

- Krebs on Security flows live through validated-redirect fetch, `next.revalidate:900` caching, RSS normalization, and a 24h lookback filter onto a public, unauthenticated Next.js 16 Server Component.
- Complete six-field UI-02 article card, tier-coloured pill, Havadis masthead, and the D-03 quiet empty state, in a zero-client-JS "Modern editorial" front page.
- A hermetic local HTTP fixture proves the redirect-reject and timeout branches real Krebs traffic never exercises; a real `next start` server proves the no-auth contract and cold-cache render — closing out Phase 1's last untested corners.
- Closed the one gap 01-VERIFICATION.md found in Success Criterion 5: a per-source `AbortController` now spans connect, every redirect hop, and the full body read as one continuous ~8s window, composed into `fetchWithValidatedRedirect`'s per-hop signal via `AbortSignal.any` — proven against a hermetic fixture that reproduces the exact still-pending-at-12s branch the verifier found, plus positive controls proving the budget doesn't over-fire.
- Parallel `Promise.allSettled` fan-out over Krebs + CISA feeding one recency-sorted list, plus the complete 6-colour `SourceTierBadge` palette.
- All 13 PROJECT.md sources wired with live-verified canonical URLs, a hermetic config-integrity test, per-source HTML content-type opt-in, and an unconditional body-size cap on every `readBodyWithCap` return path.
- Three new hermetic fixture routes plus two new test files prove — against real sockets, not by reading the code — that `fanOut()` isolates a broken source and runs all sources concurrently, closing out Phase 2.
- A 400-Unicode-code-point data-layer cap on `Article.summary` plus a three-line Tailwind `line-clamp-3` on both card fields, closing a ~94x cross-source summary-length spread that Phase 1's single-source no-clamp mandate never anticipated.
- Every article is now classified into one of 7 urgency-ordered sections by tuned, word-bounded keyword rules and ranked within each section by tier weight x recency decay — proven end to end against live feeds, hermetic fixtures, and a real `next start` production page.
- Titles now decode their HTML entities exactly once in `normalize.ts` (closing the CrowdStrike `&trade;` blocker), and a new union-find `dedupe()` stage collapses the same story arriving from several outlets down to its single earliest copy — proven through a three-outlet composed-pipeline fixture and a live uniqueness invariant against today's real feed data.
- CVE identifiers in article titles/summaries now surface as validated, NVD-linked red chips in the card meta row (capped at 3 plus overflow), and the phase's documentation corrections (D-12 section order, D-01 dedupe widening) plus its no-external-API COVERAGE.md declaration are recorded.
- Sticky count-bearing section pills with a client-only multi-select filter (hidden attribute, no unmounting, no network), a 1/2/3-column card grid in an aligned max-w-7xl shell, and a WCAG contrast gate measured against the installed Tailwind zinc palette.
- An honest "Updated" clock in the sticky bar (exact UTC in cached HTML, relative and ticking after hydration via useSyncExternalStore) plus a top-6 cap per long section behind a hidden-attribute "Show all N" expander.
- Ad hoc Playwright run over six widths against the production build, which found and fixed a mobile layout-widening bug; the user then passed the page on real iOS Safari and Android Chrome and signed off the three UI-SPEC decisions.

**Closeout type:** override_closeout
**Known verification overrides:** 0 newly acknowledged, 0 carried forward (see STATE.md Deferred Items). Phases 1, 3 and 4 had stale verification reports at close (files changed after verification: for Phase 4, the code-review fixes WR-01..WR-04). No milestone audit was run. The Phase 4 fixer re-ran build, lint, tests and the six-width viewport check after those fixes.

**Delivered:** A public, stateless daily security newspaper: 13 RSS feeds, deduplicated, classified into 7 urgency-ordered sections, with a client-side section filter and a verified mobile layout.

---
