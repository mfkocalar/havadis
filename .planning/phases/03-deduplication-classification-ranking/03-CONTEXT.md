# Phase 3: Deduplication, Classification & Ranking - Context

**Gathered:** 2026-09-23
**Status:** Ready for planning

<domain>
## Phase Boundary

The flat, recency-sorted 13-source list from Phase 2 becomes trustworthy, structured data: the same story from more than one source is shown once, every article is classified into exactly one of 7 sections by keyword rules, sections render in operational-urgency order, articles are ranked within each section by recency × source weight, and CVE identifiers are surfaced as chips on the card. The page gets a *minimal* sectioned rendering so success criterion 3 is visible on the real page. The full newspaper layout, section counts, "last updated" timestamp, client-side filter and mobile polish remain Phase 4 (UI-01, UI-04, UI-05, FILTER-01).

Requirements covered: NORM-02, CLASSIFY-01, CLASSIFY-02, CLASSIFY-03, UI-03.

</domain>

<decisions>
## Implementation Decisions

### Deduplication (NORM-02)
- **D-01:** Two articles are the same story if **either** their canonical URLs match **or** their normalized titles match. URL canonicalization: lowercase scheme and host, drop the fragment, strip tracking query params (`utm_*` and similar), strip the trailing slash, and treat `http`/`https` as equal for matching. Title normalization: decode HTML entities, Unicode-normalize, lowercase, collapse punctuation and whitespace. No fuzzy or similarity matching. This deliberately widens NORM-02's literal "(title, url) pair" wording, because an exact pair almost never matches across outlets. — **Reversibility:** reversible — a pure function behind one call site.
- **D-02:** Which copy survives a collapse: the **earliest `publishedAt`**. Ties are broken by source weight (D-10), then by stable source-iteration order. The result is deterministic.
- **D-03:** Duplicates are collapsed **silently**. No "also reported by" or "+N sources" note, and no new fields on `Article` for it. This follows Phase 2 D-05 (never show the reader the pipeline machinery).
- **D-04:** HTML entities in titles are decoded **once, in `normalize.ts`**. The decoded string is both the dedupe input and what readers see (this fixes CrowdStrike's literal `&trade;`, the STATE.md blocker). Decoding restores the publisher's intended text. It is not an editorial rewrite, so UI-02's verbatim guarantee (as narrowed by Phase 2 D-08) still holds: no re-casing, re-wording or truncation.

### Classification (CLASSIFY-01)
- **D-05:** First-match-wins runs in **specificity order, which is separate from display order**. Most specific rules come first so broad words only claim leftovers. Intended order: Vulnerabilities → Ransomware → Breaches → Advisories → Threat Intelligence → Tools/Techniques, with Industry/Policy as the default. The researcher/planner may reorder adjacent rules if live-data validation (D-07) shows a clearly better result, but must keep evaluation order and display order (D-12) as two separate constants.
- **D-06:** Matching tries **every rule against the title first**. Only if no title match is found are the rules tried against the (400-code-point capped) summary. If neither matches, the article goes to Industry/Policy.
- **D-07:** Keyword lists are **ported from the reference taxonomy (PROJECT.md Context), then tuned**. Matching is case-insensitive with word boundaries (so `law` doesn't match `flaw`, and `tool` doesn't fire inside unrelated words). Over-broad terms (`threat`, `attack`, `incident`, `encrypted`, `government`, `malicious`, `recommend`, etc.) are narrowed or pruned, and obvious missing terms are added. Tuning is validated against a live multi-source snapshot and locked in with fixture tests. Every deviation from the reference list is documented in a code comment next to the rules.
- **D-08:** **No per-source classification overrides.** Every source, CISA included, goes through the same keyword path. `SourceConfig` gets no default-section field.

### Ranking (CLASSIFY-02)
- **D-09:** Within a section, `score = tierWeight × recencyDecay(age)` over the 24h window, sorted by score descending. The decay curve (linear or half-life) and its constant are Claude's discretion. The requirement: a high-weight article a few hours old can outrank a low-weight one from minutes ago, and old items still sink. The ranking takes "now" as an input so tests can use fixed timestamps.
- **D-10:** Weights are **per `SourceTier`** (not per source), stored in config next to `SOURCES`. Intended rough ordering: Government highest; Security Research and Threat Intelligence high; Enterprise Security and Executive News mid; Tech & General lowest. Exact numbers are Claude's discretion. Weight is a ranking input only. Tier badges stay visually equal (Phase 2 D-01/D-03 unchanged).
- **D-11:** Only those two inputs count. There's **no boost for multi-outlet coverage** and **no source-diversity penalty** in v1. Revisit only if live data shows one outlet dominating a section.

### Section Order (CLASSIFY-03)
- **D-12:** Display order is exactly: **Vulnerabilities → Advisories → Ransomware → Breaches → Threat Intelligence → Tools/Techniques → Industry/Policy**, as written in REQUIREMENTS.md CLASSIFY-03 and ROADMAP success criterion 3. PROJECT.md's "Active" line lists a different order (Vulns/TI/Breaches/Ransomware first, Tools/Advisories/Industry after). That line is wrong and should be corrected to this order during this phase's doc updates.

### CVE Chips (UI-03)
- **D-13:** CVE IDs are detected with `CVE-\d{4}-\d{4,7}` (case-insensitive, rendered uppercase) in the title and the capped summary (the Phase 2 D-08 consequence is accepted). IDs are deduplicated and kept in first-appearance order, title first. The card shows **at most 3 chips, then a "+N" chip** for the rest.
- **D-14:** Each chip **links to `https://nvd.nist.gov/vuln/detail/<ID>`** in a new tab with `rel="noopener noreferrer"`. The URL is built only from the regex-matched ID, never from feed-supplied URL text.
- **D-15:** Chips sit in the **card's meta row, next to the tier badge**. They use the same pill shape and size as `SourceTierBadge`, a **red** tone (the color reserved by Phase 2 D-02), and a monospace ID, and they wrap on narrow viewports. Exact tokens are left to UI-SPEC if `/gsd-ui-phase` runs, but must meet WCAG AA contrast.

### Interim Section Rendering
- **D-16:** `page.tsx` swaps the single "Latest" list for **plain stacked sections**: one heading per non-empty section (emoji + name, in D-12 order), each followed by its ranked cards in the existing single column. Empty sections are skipped. There's no count, grid, filter or "show more"; those are Phase 4. The quiet empty state (Phase 1 D-03 / Phase 2 D-06) still applies when there are zero articles overall. Phase 3 renders **every** article (no per-section cap), so ranking can be checked end to end.

### Claude's Discretion
- The exact decay function and constant, and the exact numeric tier weights, within D-09/D-10.
- The exact tuned keyword lists and any adjacent-rule reordering, within D-05/D-07, backed by live-data validation and fixture tests.
- Exactly which tracking params get stripped during URL canonicalization (D-01).
- Module layout (e.g. `dedupe.ts`, `classify.ts`, `rank.ts`, `extractCves.ts` in `src/lib/pipeline/`) and how `Article` / `FrontPageResult` get extended with section and CVE data. Keep the pure-function-per-stage pattern and the never-throws contract of `getFrontPage`.
- Whether `sortByRecencyDesc.ts` is removed or kept as a helper. It was explicitly transitional (Phase 2 discretion note).
- The entity decoder (small hand-rolled map vs. a tiny dependency). The STACK.md bias toward few dependencies applies.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project scope & requirements
- `.planning/REQUIREMENTS.md` — NORM-02, CLASSIFY-01, CLASSIFY-02, CLASSIFY-03, UI-03 (this phase). The CLASSIFY-03 order is authoritative (D-12).
- `.planning/ROADMAP.md` — Phase 3 goal and 5 success criteria.
- `.planning/PROJECT.md` — the 7-section keyword taxonomy (Context section) that D-07 ports and tunes; the dedupe note; the 13-source tier table. Its "Active" section-order line is known to be wrong (D-12).

### Prior phase context (must not contradict)
- `.planning/phases/02-full-ingestion-failure-isolation/02-CONTEXT.md` — D-02 (red/orange reserved → D-15), D-01/D-03 (equal-weight badges → D-10), D-05/D-06 (silent degradation, quiet empty state → D-03, D-16), D-08 (400-code-point summary cap; CVE scan consequence → D-13; verbatim-title scope → D-04).
- `.planning/phases/01-single-source-pipeline-vertical-slice/01-CONTEXT.md` — D-02 "Modern editorial" visual direction, D-03 quiet empty state.
- `.planning/phases/02-full-ingestion-failure-isolation/02-UI-SPEC.md` — existing badge/card design tokens the CVE chip must match in shape and size.
- `.planning/STATE.md` — Blockers: CrowdStrike `&trade;` entity (closed by D-04).

### Research (project init, still governs)
- `.planning/research/ARCHITECTURE.md` — pipeline stage structure and never-throws pattern.
- `.planning/research/PITFALLS.md` — review for classification/dedupe-relevant pitfalls.
- `.planning/research/STACK.md` — dependency-minimalism bias (relevant to the entity decoder choice).

### Reference implementation
- https://github.com/mfksec/SecureNewspaper — the source `config.yaml` taxonomy and dedupe approach being ported.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/pipeline/normalize.ts` — where title entity decoding goes (D-04). Its doc comment already says dedup is intentionally *not* done here and belongs to NORM-02 as a separate stage.
- `src/lib/pipeline/truncateSummary.ts` — the summary is already capped before classification and CVE scanning see it.
- `src/components/SourceTierBadge.tsx` — pill style that the CVE chip should visually match (D-15).
- `src/components/ArticleCard.tsx` — the meta row (`source` + badge) is where the chips go. All text is rendered as plain JSX nodes and must stay that way (threat T-01-07).

### Established Patterns
- One pure function per pipeline stage with a colocated `*.test.ts` (`filterLookback`, `sortByRecencyDesc`, `truncateSummary`). New stages (dedupe, classify, rank, CVE extract) follow the same pattern.
- `getFrontPage.ts` is the single orchestrator composing the stages and must never throw. The new chain is roughly fanOut → filterLookback → dedupe → classify → rank-within-section → group in display order.
- `src/lib/config/sources.ts` is pure-data config. Tier weights (D-10) and possibly the section/keyword tables belong in `src/lib/config/`.

### Integration Points
- `src/lib/types.ts` — `Article` (section, cves) and `FrontPageResult` (grouped sections) need extending.
- `src/app/page.tsx` — switches from a flat map to stacked sections (D-16). It currently uses `article.url` as the React key, which is safe once dedupe guarantees unique URLs.
- `src/lib/pipeline/sortByRecencyDesc.ts` — transitional, replaced by the ranking stage.
- `src/lib/pipeline/frontpage.e2e.test.ts` and `test/productionPage.test.ts` — existing end-to-end checks that will need updating for the sectioned output.

</code_context>

<specifics>
## Specific Ideas

- CVE chips link to NVD specifically (not cve.org), because that's where a practitioner goes first for CVSS and enrichment.
- Patch Tuesday / multi-CVE advisories are the motivating case for the 3-chip cap.
- Earliest-published-wins for dedupe is meant to credit the outlet that broke the story.

</specifics>

<deferred>
## Deferred Ideas

- **Pagination / page length (→ Phase 4):** no page-2 pagination (infinite scroll is out of scope per REQUIREMENTS.md). Preferred direction for Phase 4: each section shows its top N ranked cards plus a client-side "Show all N" expander over the already-rendered snapshot. No server round-trip, and it works with FILTER-01. Phase 3 deliberately renders everything.
- **Fuzzy / similarity dedupe:** considered and rejected for v1 (D-01). Revisit if exact-normalized matching visibly misses same-story duplicates in production.
- **Multi-outlet coverage boost / "also reported by" note:** considered and rejected for v1 (D-03, D-11).

</deferred>

---

*Phase: 3-Deduplication, Classification & Ranking*
*Context gathered: 2026-09-23*
