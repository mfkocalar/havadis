# Phase 2: Full Ingestion & Failure Isolation - Context

**Gathered:** 2026-09-21
**Status:** Ready for planning

<domain>
## Phase Boundary

All 13 configured sources are fetched in parallel on every cache revalidation cycle, and a failure in any one of them never prevents the page from rendering the rest. This widens Phase 1's proven single-source pipeline shape (fetch → normalize → cache/revalidate → render) to the full fixed source list, with per-source failure isolation as the new capability. No dedup, no classification into sections, no ranking (Phase 3); no full 7-section layout or client-side filter (Phase 4). The result is still one flat combined list of article cards, just fed by up to 13 sources instead of 1.

Requirements covered: INGEST-01 (parallel fetch of all 13 sources), INGEST-02 (a failure in one source never prevents the page from rendering with the rest).

</domain>

<decisions>
## Implementation Decisions

### Source-Tier Badge Colors
- **D-01:** Claude designs a cohesive 6-color palette for the 5 tiers still using the neutral default (Government, Enterprise Security, Threat Intelligence, Tech & General, Executive News), matching the existing Security Research indigo pill's visual style (soft background, ring, WCAG AA text contrast). No semantic mapping — colors differentiate tiers visually, they don't rank or categorize them.
- **D-02:** Red and orange are reserved — not used for any tier badge. — **Reversibility:** reversible — a palette convention, not a technical constraint. Kept free for CVE-ID chips (Phase 3, CLASSIFY/UI-03) and urgency-tinted cues (Phase 4 section ordering), so tier badges never visually compete with higher-signal elements added later.
- **D-03:** All 6 tier badges are equal visual weight — same pill size/shape/font-weight across all tiers, differentiated only by color. Government (CISA) does not get special prominence. — **Reversibility:** reversible.
- **D-04:** Security Research's shipped indigo pill (`bg-indigo-50 text-indigo-700 ring-indigo-200`) stays locked exactly as-is; the other 5 colors are chosen to complement it, not the reverse. No changes to already-verified Phase 1 code for this component beyond adding new map entries.

### Failure Isolation / Silent Degradation
- **D-05:** Per-source failure stays fully invisible to the reader, reconfirmed now that it's a real situation across 13 sources of very different posting cadence (e.g. CISA posts far less often than Krebs). A quiet source and a broken source look identical: zero contribution to the combined list, no distinction anywhere in the UI, no count, no indicator. This reconfirms HEALTH-01's v2 deferral (REQUIREMENTS.md) under real multi-source variance, not just as an untested assumption from Phase 1's single-source case. — **Reversibility:** reversible — a diagnostics UI is addable later (v2/HEALTH-01) without touching the ingestion pipeline's shape.
- **D-06:** The extreme edge case — all 13 sources fail in the same revalidation cycle — reuses Phase 1's exact quiet-empty-state message verbatim (01-CONTEXT.md D-03). No new UI path distinguishing "everything failed" from "one source failed" or "genuinely zero articles in the window."
- **D-07:** No minimum-article-count floor before rendering. Even if only 1 of 13 sources succeeds and yields a single article, that article renders normally — the same "any success renders, no diagnostics" principle as D-05.

### Article Card Text Length (Gap Closure G-02-5)
- **D-08:** Article card title and summary are displayed within a fixed visual bound (a three-line
  CSS clamp on both fields), and the summary is additionally capped at the data layer, before it
  enters the payload, at 400 Unicode code points. This decision **supersedes** three passing Phase
  1 artefacts: `01-02-PLAN.md:157`'s mandate that the title render "verbatim and untruncated — no
  ellipsis, no line clamp, no rewriting"; the `01-02-PLAN.md:184` verify gate that asserted
  `ArticleCard.tsx` contained no clamp and no slice/substring call; and `01-02-SUMMARY.md:82`,
  which recorded that gate as passing. It also supersedes `01-02-PLAN.md:31`'s companion claim
  that "no byte, code-point or grapheme-cluster length definition applies" to these fields — a
  length definition now does apply, and it is measured in Unicode code points, never UTF-16 code
  units, so a surrogate pair is never split.

  That Phase 1 mandate was correct for a one-source app: Krebs' own summaries clustered around a
  476-character median, so every card looked identically treated regardless of the no-clamp rule.
  At 13 sources, live measurement (debug session `article-card-text-length-inconsistent.md`,
  evidence T6) found summary length spanning 0 characters (CrowdStrike) to 26,744 (CISA) — a
  roughly 94x median spread — which is exactly what UAT G-02-5 reports. Re-adding the Phase 1
  no-clamp gate at this scale is therefore a **regression**, not a fix, and any future reader of
  `01-02-PLAN.md` who is tempted to "restore" it should read this entry first.

  UI-02's verbatim guarantee is narrowed in scope, not revoked: it continues to constrain
  *editorial* rewriting — no re-casing, re-wording, or title truncation at the data layer. The
  full title string still reaches the DOM and the accessibility tree; only its *rendered height*
  is bounded, and only via CSS, never by cutting the string itself.

  Consequence carried into Phase 3: UI-03's CVE scan will operate on the capped summary, so a CVE
  identifier appearing beyond the 400-code-point cap inside an unusually long publisher body will
  not produce a chip. This is deliberately accepted — the chip then always corresponds to text the
  reader can actually reach — and CVE identifiers in titles (the common case for advisory feeds
  such as CISA) are unaffected, because titles are never cut at the data layer.

  — **Reversibility:** the visual bound (CSS clamp) is reversible — deleting the classes restores
  the previous rendering exactly. The data-layer summary cap is **costly** to reverse: it discards
  publisher text before anything downstream can see it, so already-cached payloads keep the capped
  text until the next revalidation, and any later feature wanting the full publisher body back
  (notably a future Phase 3 CVE scan over long summaries) would need the full text re-plumbed
  through `normalize.ts`.

### Claude's Discretion
- **Combined article-list ordering.** `getFrontPage.ts` currently just concatenates articles in source-iteration order with no sorting. User explicitly deferred discussing this — Claude picks a reasonable interim order (most likely recency-descending across all combined sources) for the flat list that exists before Phase 3 builds real classification + ranking. This is a transitional choice Phase 3 will replace, not a lasting product decision.
- Exact hex/Tailwind color tokens for the 5 remaining tier badges, within the constraints above (no red/orange, equal visual weight, complements the locked indigo).
- CISA's specific posting cadence and any XML/feed-format quirks (flagged as a known unknown in 01-CONTEXT.md's Specifics section) — a research/implementation concern, not a product decision. Investigate when actually wiring CISA's `SourceConfig` entry.
- Parallel-fetch mechanism (`Promise.all` vs `Promise.allSettled` vs another pattern) and any concurrency staggering — purely technical, must preserve the existing never-throws-per-source contract `fetchSource` already implements.
- Whether to fetch all 13 sources with uniform per-source timeout (already ~8s, INGEST-03/Phase 1) or whether any source needs a different budget — technical, decide during planning if a specific source's real-world latency demands it.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project scope & requirements
- `.planning/PROJECT.md` — full 13-source list with tiers and feed URLs; core value, constraints (stateless, free-tier, no auth)
- `.planning/REQUIREMENTS.md` — INGEST-01, INGEST-02 (this phase's requirements); HEALTH-01 listed under v2 Requirements as explicitly deferred and not in current roadmap — the basis for D-05
- `.planning/ROADMAP.md` — Phase 2 goal, 3 success criteria, dependency on Phase 1

### Prior phase context (decisions this phase must not contradict)
- `.planning/phases/01-single-source-pipeline-vertical-slice/01-CONTEXT.md` — D-01 (Krebs chosen over CISA specifically to save CISA's lower-frequency/XML quirks for this phase's fan-out, once failure isolation is proven), D-02 ("Modern editorial" visual direction, applies across all phases), D-03 (quiet empty-state pattern, reused verbatim by D-06 above), D-04 (tier badge color deferral this phase resolves for 5 of 6 tiers)
- `.planning/phases/01-single-source-pipeline-vertical-slice/01-SECURITY.md` — Phase 1's threat register; T-01-05's accepted-risk rationale (single hardcoded HTTPS source, full private-IP denylist deferred to "the 13-source hardening pass") explicitly names this phase as where that residual risk becomes material — re-evaluate T-01-05's disposition during this phase's own threat modeling

### Research (produced during project init, 2026-09-14; still governs this phase)
- `.planning/research/ARCHITECTURE.md` — suggested structure and fetcher-never-throws pattern this phase's fan-out must preserve
- `.planning/research/PITFALLS.md` — Pitfall 2 (anti-bot/User-Agent), Pitfall 3 (SSRF via redirects), Pitfall 4 (lenient XML parsing), Pitfall 5 (cold-cache latency), Pitfall 6 (per-region cache) — all apply per-source across all 13 now, not just Krebs
- `.planning/research/STACK.md` — pinned versions and the fetch-raw-then-parse pattern (native `fetch` + `next.revalidate`, never `rss-parser`'s own `parseURL()`)

### Reference implementation
- https://github.com/mfksec/SecureNewspaper — source of the 13-source list and 7-section taxonomy being ported

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/pipeline/fetchSource.ts` — fetch+parse for one source, never throws, already handles per-source timeout (~8s continuous budget, closed in Phase 1's 01-04 gap-closure), redirect validation, content-type gating (accepts xml/html), byte cap, and parse failure — reusable as-is for all 13 sources with zero changes.
- `src/lib/pipeline/filterLookback.ts` — 24h lookback filter, source-agnostic, reusable as-is.
- `src/lib/types.ts` — `SourceConfig`, `Article`, `FrontPageResult` shapes already support an arbitrary number of sources.
- `src/components/SourceTierBadge.tsx` — tier-color map already keyed by all 6 `SourceTier` values; only needs its 5 neutral-default entries replaced with real colors (D-01–D-04).

### Established Patterns
- `src/lib/config/sources.ts` — pure-data `SourceConfig[]` array. Its own doc comment already states "Phase 2 appends the other twelve PROJECT.md rows to this same array with no other code changes" — confirms the intended integration point. Note the documented gotcha: Krebs's entry uses the canonical post-redirect URL (`/feed/` not `/feed`) because Next's Data Cache only stores 200 responses — check each of the other 12 sources' PROJECT.md URLs for the same redirect trap before wiring them in.
- `src/lib/pipeline/getFrontPage.ts` — the single orchestrator. Its own doc comment already anticipates this phase: "Phase 1 iterates sequentially over one source. The loop shape is kept so Phase 2 can switch this to a parallel fan-out over thirteen entries (e.g. `Promise.all`) without reshaping the return value." Currently swallows per-source failure by simply not pushing that source's articles — this is D-05's silent-degradation behavior already half-built; Phase 2 only needs to parallelize the fetch, not change the swallow-and-continue semantics.

### Integration Points
- `sources.ts`: add the other 12 `SourceConfig` entries (URL, tier, name) from PROJECT.md's table.
- `getFrontPage.ts`: convert the sequential `for` loop over `SOURCES` into a parallel fan-out (e.g. `Promise.all`/`Promise.allSettled` over `fetchSource` calls), preserving the never-throws/swallow-per-source-failure contract and the discriminated `FrontPageResult` return shape.
- `SourceTierBadge.tsx`: replace the 5 neutral (`slate-100`) `TIER_STYLES` entries with the new palette (D-01–D-04).

</code_context>

<specifics>
## Specific Ideas

No new specific visual/product references beyond what Phase 1 already established (TechCrunch/Verge "Modern editorial" direction, per 01-CONTEXT.md). This phase is primarily a fan-out + failure-isolation exercise on the already-proven pipeline shape.

</specifics>

<deferred>
## Deferred Ideas

None new. HEALTH-01 (per-source health/diagnostics signal) remains explicitly deferred to v2 per REQUIREMENTS.md, reconfirmed by D-05 rather than revisited.

### Reviewed Todos (not folded)
None — no todos matched this phase (`todo.match-phase` returned empty).

</deferred>

---

*Phase: 2-Full Ingestion & Failure Isolation*
*Context gathered: 2026-09-21*
