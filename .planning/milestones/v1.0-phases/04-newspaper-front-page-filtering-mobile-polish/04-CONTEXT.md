# Phase 4: Newspaper Front Page, Filtering & Mobile Polish - Context

**Gathered:** 2026-09-30
**Status:** Ready for planning

<domain>
## Phase Boundary

The Phase 3 interim page (plain stacked sections in one column, every article rendered, no metadata, no filter) becomes the finished v1 newspaper front page: a responsive multi-column card grid per section in urgency order, a "last updated" timestamp and per-section article counts, a client-side multi-select section filter that never touches the server, and a layout verified readable at real mobile (~360-390px) and desktop widths. No new data sources, pipeline stages, or persistence. Search, archive, accounts, sharing and feeds stay out of scope.

Requirements covered: UI-01, UI-04, UI-05, FILTER-01.

</domain>

<decisions>
## Implementation Decisions

### Section Layout (UI-01)
- **D-01:** Each section's articles render as a **multi-column card grid**, not the single column from Phase 3 D-16. Section headings and urgency order (Phase 3 D-12) are unchanged; empty sections are still skipped.
- **D-02:** Breakpoints are **1 column on mobile, 2 on tablet, 3 on desktop** (Tailwind `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`). Cards keep the existing `ArticleCard` design, including the D-08 (Phase 2) three-line title and summary clamps.
- **D-03:** The page shell **widens from `max-w-4xl` to `max-w-6xl` or `max-w-7xl`** so three columns have comfortable card width. The masthead in `layout.tsx` widens to the same value so header and content stay aligned. The exact value is Claude's discretion.
- **D-04:** Sections with only 1-2 articles **leave the empty grid cells as they are**. No stretch-to-fill logic. — **Reversibility:** reversible — a grid-class change.

### Section Length / "Show all N"
- **D-05:** Each section shows its **top 6 ranked cards** (two full desktop rows, three tablet rows, no ragged last row at 2 or 3 columns), followed by a client-side **"Show all N" expander** for the rest. This adopts the direction Phase 3 recorded under Deferred Ideas. There is no server round-trip and no pagination.
- **D-06:** **Tiny-overflow rule:** if hiding would save fewer than about 3 cards (e.g. a section of 7 or 8 with a cap of 6), render them all and show no expander. Claude picks the exact threshold.
- **D-07:** **All cards are in the initial server-rendered HTML.** The expander only toggles visibility through client state. This satisfies FILTER-01's "no new server fetch" and keeps content accessible and crawlable. The larger payload is accepted. The Phase 3 ranking order is preserved; the cap always shows the highest-ranked N.

### Filter (FILTER-01)
- **D-08:** The control is a **row of toggle pills**, one per section (emoji + section name), each an on/off button with `aria-pressed`. Multi-select. Always visible, single-tap on mobile. Pills reuse the existing pill visual language (shape, size, focus ring) and must meet WCAG AA contrast in both states.
- **D-09:** **No pills selected = no filter: all sections show.** Selecting pills narrows the page to those sections; deselecting the last pill returns to everything. There is no "nothing selected" empty state to design.
- **D-10:** **No persistence.** Filter state is in-memory client state only. No URL query sync, no localStorage. Reload resets to all sections. This keeps the page fully cacheable and stateless. — **Reversibility:** reversible — URL sync can be added later without touching the pipeline.
- **D-11:** The pill bar is a **sticky bar below the masthead**, pinned while scrolling so users can re-filter anywhere on a long page. On narrow viewports the pills are a single horizontally scrollable row rather than wrapping to several lines, to save vertical space.

### Freshness & Counts (UI-04)
- **D-12:** The **"last updated" timestamp lives in the sticky filter bar**, as small muted text at its trailing edge. On mobile it may drop below the pills or be compacted; Claude decides the exact responsive treatment.
- **D-13:** The timestamp is shown as **relative text ("Updated 4 min ago") with the absolute time on hover** (`title` attribute and a `<time dateTime>`), reusing `formatRelativeTime` and matching the article-card convention. **Caveat for research/planning:** the page is server-rendered and cached for about 15 minutes, so the relative string is computed at snapshot build time and does not track the viewer's clock. The planner must decide how to keep it honest (e.g. rendering it from a snapshot timestamp on the client, or accepting the snapshot-time value) and must thread a snapshot timestamp (`generatedAt`) through `getFrontPage()`'s result.
- **D-14:** Each section heading shows its **total article count as a muted number beside the heading** (e.g. "VULNERABILITIES 12"). The count is the section's full total, not the capped 6, and is unaffected by the expander. The same count also appears on each filter pill so users see volume before filtering.

### Claude's Discretion
- The exact container width (`max-w-6xl` vs `max-w-7xl`) and exact tiny-overflow threshold (D-03, D-06).
- Client/server component split. `page.tsx` and `ArticleCard` are Server Components; the filter and the expanders need a client boundary. Keep cards server-rendered where possible (pass them as children into the client wrapper) and keep the never-throws contract of `getFrontPage`.
- How the filter and the per-section expanders interact (e.g. whether the expander state survives a pill toggle).
- The sticky bar's exact offset, background and shadow, and how the `last updated` text compacts on mobile (D-11, D-12).
- How UI-05 is verified at real device widths. The criterion says "not just a resized desktop browser window", so the plan must include a concrete mobile verification step (real viewport emulation at 360-390px plus a human check) rather than relying on responsive classes alone.
- Accessibility details for the pills and expanders (keyboard operation, focus order, `aria-expanded`/`aria-controls`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project scope & requirements
- `.planning/REQUIREMENTS.md` — UI-01, UI-04, UI-05, FILTER-01 (this phase). Also the Out of Scope table (no infinite scroll, no dark-mode toggle, no personalization).
- `.planning/ROADMAP.md` — Phase 4 goal and 4 success criteria (the UI-05 "real device widths" wording is binding).
- `.planning/PROJECT.md` — core value, stateless/free-tier constraints, "Active" requirements list for this phase.

### Prior phase context (must not contradict)
- `.planning/phases/03-deduplication-classification-ranking/03-CONTEXT.md` — D-12 (section display order), D-16 (interim rendering this phase replaces), D-15 (red reserved for CVE chips), and the Deferred Ideas entry that seeded D-05.
- `.planning/phases/02-full-ingestion-failure-isolation/02-CONTEXT.md` — D-08 (three-line card clamps), D-02 (red/orange reserved; Phase 4 may use them for urgency cues), D-05/D-06 (silent degradation, quiet empty state).
- `.planning/phases/01-single-source-pipeline-vertical-slice/01-CONTEXT.md` — D-02 "Modern editorial" visual direction (TechCrunch/The Verge feel), D-03 quiet empty state.
- `.planning/phases/03-deduplication-classification-ranking/03-UI-REVIEW.md` — the Phase 3 audit's confirmed spacing, typography and color baselines the new layout should extend.

### Research (project init, still governs)
- `.planning/research/PITFALLS.md` — Pitfall 11 (mobile layout) and any caching pitfalls relevant to a client filter over a cached snapshot.
- `.planning/research/STACK.md` — Tailwind 4 / Next.js 16 constraints; Cache Components stays off; dependency-minimalism bias (no UI kit needed for pills or expanders).
- `AGENTS.md` — Next.js 16 has breaking changes; read the relevant guide in `node_modules/next/dist/docs/` before writing any code (especially for Server/Client component boundaries).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/ArticleCard.tsx` — finished card (clamps, meta row, CVE chips, `<time>` hover). Reused unchanged inside the grid. Stays a Server Component.
- `src/components/SourceTierBadge.tsx` and `src/components/CveChips.tsx` — pill styling (`rounded-full px-2.5 py-0.5 text-xs font-medium`, `-50/-700/-200` shade steps) that the filter pills should match.
- `src/lib/formatRelativeTime.ts` — reuse for the "Updated N min ago" text (D-13).
- `src/lib/config/sections.ts` — `SECTION_DISPLAY_ORDER` and `SECTION_EMOJI`, the source of truth for pill order, labels and emoji.
- `src/lib/types.ts` — `SectionGroup`, `SectionedFrontPageResult`; needs a snapshot timestamp added (D-13).

### Established Patterns
- One pure function per pipeline stage with a colocated `*.test.ts`; `getFrontPage.ts` is the single orchestrator and never throws. A snapshot timestamp should be threaded through the same way `now` already is.
- Only Tailwind scale values, no arbitrary values, no hardcoded colors; dark theme classes are present on every surface (Phase 3 audit, 24/24).
- All feed text renders as plain JSX text nodes, never raw HTML (threat T-01-07). The new client code must keep that.
- `page.tsx` keys cards by `article.url`, safe because dedupe guarantees uniqueness.
- Tests: `npm test` runs hermetic tests; `E2E=1 npm test` adds live feeds. `test/productionPage.test.ts` asserts `data-section` order against a production build and will need updating for the grid, caps and filter bar.

### Integration Points
- `src/app/page.tsx` — replaces the `flex flex-col gap-6` card list with the grid, adds counts, and mounts the client filter/expander wrapper.
- `src/app/layout.tsx` — masthead container width (`max-w-4xl`) must change together with the page shell (D-03).
- `src/lib/pipeline/getFrontPage.ts` and `src/lib/types.ts` — thread a `generatedAt` snapshot timestamp into `SectionedFrontPageResult`.
- New client component(s) for the sticky filter bar and per-section expanders (no existing client components in the codebase yet).

</code_context>

<specifics>
## Specific Ideas

- Desktop grid should read like a modern tech-news front page (Phase 1 D-02 direction), not a literal broadsheet.
- The cap of 6 was chosen because it fills complete rows at both the 2-column and 3-column breakpoints.
- Filter pills show the section's article count so users can see volume before filtering (D-14).

</specifics>

<deferred>
## Deferred Ideas

- **URL-synced filter state (shareable filtered views):** considered and declined for v1 (D-10). Revisit only with a clear driver; it must stay client-only to preserve caching.
- **Featured "lead story" card per section:** offered as a hybrid layout and not chosen (D-01). Could be revisited as polish after v1.
- **Stretch-to-fill cards for sparse sections:** considered and declined (D-04).
- **Per-article share/copy-link, own RSS feed, source health signal, keyword search, archive:** already tracked as v2 requirements in REQUIREMENTS.md (SHARE-01, FEED-01, HEALTH-01, SEARCH-01, ARCHIVE-01).

### Reviewed Todos (not folded)
None — no todos matched this phase.

</deferred>

---

*Phase: 4-Newspaper Front Page, Filtering & Mobile Polish*
*Context gathered: 2026-09-30*
