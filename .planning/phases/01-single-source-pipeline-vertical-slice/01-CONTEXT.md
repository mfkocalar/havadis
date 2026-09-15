# Phase 1: Single-Source Pipeline (Vertical Slice) - Context

**Gathered:** 2026-09-15
**Status:** Ready for planning

<domain>
## Phase Boundary

One real source flows through the entire architecture — fetch → normalize → cache/revalidate → render — proving the pipeline shape end to end on a publicly accessible, unauthenticated page. This is the first vertical slice: no fan-out to all 13 sources (Phase 2), no dedup/classification/ranking (Phase 3), no full 7-section layout or client-side filter (Phase 4). It renders one source's articles as newspaper-style cards in a single flat list/section.

Requirements covered: INGEST-03 (per-source timeout + redirect validation), INGEST-04 (24h lookback), INGEST-05 (fetch+revalidate caching), NORM-01 (common article shape), UI-02 (article card fields), UI-06 (no auth).

</domain>

<decisions>
## Implementation Decisions

### Source Selection
- **D-01:** The single real source for this phase is **Krebs on Security** (`https://krebsonsecurity.com/feed`, Security Research tier). — **Reversibility:** reversible — swapping the one configured source is a one-line change in `lib/config/sources.ts`; no downstream logic depends on which specific source it is.
- Rationale: well-formed RSS, frequent posts (good for exercising the 24h lookback and relative-time display with real variety), and PITFALLS.md already documents the mitigation it needs (browser-like `User-Agent`, since it's Cloudflare-fronted) — that mitigation should be built in from this phase, not deferred.

### Visual Style
- **D-02:** Front page visual direction is **"Modern editorial"** — sans-serif headlines, generous whitespace, card-based layout with subtle shadows. Reads like a modern tech-news site (TechCrunch/The Verge), not a literal broadsheet-newspaper pastiche and not a dark terminal/hacker aesthetic. — **Reversibility:** costly — this sets the direction for every component built across all 4 phases (cards, badges, section headers); changing direction later means restyling everything built so far, not a config flip.
- Applies to: `ArticleCard`, and by extension all future `SectionGroup`/masthead components in later phases — this is the establishing visual decision, not scoped only to Phase 1.

### Failure / Empty State
- **D-03:** If the single configured source times out, fails, or returns zero articles within the 24h lookback, the page still renders its full layout (masthead, structure) with a **quiet empty-state message** (e.g. "No articles in the last 24 hours") rather than a skeleton placeholder or a bare empty section with no copy. — **Reversibility:** reversible — a small, isolated UI component; swapping the empty-state treatment later doesn't touch pipeline logic.
- This applies to both failure modes described in Success Criterion 5 (timeout/redirect abort) and the "genuinely zero articles in window" case — same visual treatment for both since Phase 1 has no per-source health/diagnostics UI yet (that's out of v1 scope entirely per REQUIREMENTS.md HEALTH-01, deferred to v2).

### Source-Tier Badge
- **D-04:** Source tier (e.g. "Security Research") is shown as a **colored text label/pill** next to the source name — distinct color per tier, not a plain-text-only badge and not an icon+label combo. — **Reversibility:** reversible — a presentational component (`SourceTierBadge`); color values can be adjusted without touching data/pipeline code.
- **Claude's Discretion:** Only the "Security Research" tier's color needs to be picked in Phase 1 (only Krebs is wired up). The full 6-tier color palette can be finalized incrementally as more sources are added in Phase 2, or settled in the Phase 4 polish pass — no need to pre-design all 6 colors now.

### Claude's Discretion
- Exact accent color values, spacing scale, and typography choices within the "Modern editorial" direction (D-02) — user confirmed direction, not a specific palette/font.
- Whether the Phase 1 page shows a single generic section header (e.g. "Latest") or no header at all above the flat article list, since real section grouping doesn't exist until Phase 3.
- Mechanism for the absolute-time-on-hover requirement (UI-02) — native `title` attribute vs. a custom tooltip component; either satisfies the requirement.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project scope & requirements
- `.planning/PROJECT.md` — core value, v1 requirements, fixed 13-source list + 7-section taxonomy, constraints (stateless, free-tier, no auth)
- `.planning/REQUIREMENTS.md` — full v1/v2 requirement IDs and traceability; this phase covers INGEST-03, INGEST-04, INGEST-05, NORM-01, UI-02, UI-06
- `.planning/ROADMAP.md` — Phase 1 goal, success criteria, and dependency chain (Phase 1 → 2 → 3 → 4)

### Research (produced during project init, 2026-09-14)
- `.planning/research/ARCHITECTURE.md` — recommended project structure (`lib/pipeline/`, `lib/config/`), fetcher-never-throws pattern, suggested build order (§"Suggested Build Order" steps 1–2 map directly to this phase's scope)
- `.planning/research/PITFALLS.md` — Pitfall 2 (anti-bot/User-Agent, specifically calls out Krebs), Pitfall 3 (SSRF via unvalidated redirects — required for INGEST-03), Pitfall 4 (lenient XML parsing), Pitfall 5 (cold-cache latency), Pitfall 6 (per-region cache), Pitfall 11 (mobile layout) — all directly relevant to this phase's build
- `.planning/research/STACK.md` — pinned versions (Next.js 16.3.5, React 19.3.0, Tailwind 4.3.3, `rss-parser` 3.13.0), and the explicit guidance to fetch raw XML via native `fetch()` + `next.revalidate`, then hand it to `rss-parser.parseString()` (never use `rss-parser`'s own `parseURL()`, which bypasses Next's Data Cache)
- `.planning/research/FEATURES.md` — feature-level detail not yet read in full; consult if planning needs additional detail beyond ARCHITECTURE/PITFALLS
- `.planning/research/SUMMARY.md` — cross-cutting summary of the above four research docs

### Reference implementation
- https://github.com/mfksec/SecureNewspaper — source of the 13-source list and 7-section taxonomy being ported (Slack-webhook mechanism itself is irrelevant and not being ported)

</canonical_refs>

<code_context>
## Existing Code Insights

**No code exists yet.** This is a greenfield project — only `.planning/` and `.claude/CLAUDE.md` exist in the repo. Phase 1 starts from project scaffolding (`create-next-app`) per the pinned stack in `.claude/CLAUDE.md` and `.planning/research/STACK.md`.

### Established Patterns (from research, not yet implemented)
- `ARCHITECTURE.md`'s recommended structure should be followed from the start: `lib/config/sources.ts` (source config as data), `lib/pipeline/fetchSource.ts` (fetch+parse, never throws), `lib/pipeline/normalize.ts`, `lib/pipeline/getFrontPage.ts` (single orchestrator), `app/page.tsx` calling `getFrontPage()` directly — no Route Handler indirection (Anti-Pattern 1 in ARCHITECTURE.md).
- Even with only one source in Phase 1, structure the fetch/normalize stages as if more sources will be added (Phase 2 adds the other 12 to the same `SourceConfig[]` array) — don't hardcode Krebs-specific logic outside `lib/config/sources.ts`.

### Integration Points
- None yet — this phase establishes the integration points for Phase 2 (source fan-out) and Phase 3 (dedupe/classify/rank) to build on.

</code_context>

<specifics>
## Specific Ideas

- Visual reference points named during discussion: TechCrunch / The Verge, as the target feel for "Modern editorial" (D-02) — not a literal newspaper broadsheet, not a dark hacker-terminal look.
- Krebs on Security specifically chosen over CISA (architecture doc's example) because CISA's lower post frequency and extra XML/UA quirks make it a harder first source to debug the pipeline against — save CISA for Phase 2's fan-out when failure-isolation is already proven.

</specifics>

<deferred>
## Deferred Ideas

- Full 6-tier color palette for source-tier badges — deferred to be finalized incrementally as more sources/tiers are added (Phase 2) or in the Phase 4 polish pass; only the Security Research tier's color needs deciding now.
- Per-source health/diagnostics indicator (e.g. "1 source unavailable") — this is REQUIREMENTS.md's HEALTH-01, explicitly a v2 requirement, not in scope for any v1 phase.

### Reviewed Todos (not folded)
None — no todos matched this phase (`todo.match-phase` returned empty).

</deferred>

---

*Phase: 1-Single-Source Pipeline (Vertical Slice)*
*Context gathered: 2026-09-15*
