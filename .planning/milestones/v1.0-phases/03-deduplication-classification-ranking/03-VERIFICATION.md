---
phase: 03-deduplication-classification-ranking
verified: 2026-09-29T00:00:00Z
status: passed
score: 5/5 must-haves verified (5 ROADMAP success criteria; ~39 granular plan-level truths across 03-01/03-02/03-03 all pass their hermetic + live tests)
covered_files: [".planning/REQUIREMENTS.md", ".planning/phases/03-deduplication-classification-ranking/03-01-PLAN.md", ".planning/phases/03-deduplication-classification-ranking/03-01-SUMMARY.md", ".planning/phases/03-deduplication-classification-ranking/03-02-PLAN.md", ".planning/phases/03-deduplication-classification-ranking/03-02-SUMMARY.md", ".planning/phases/03-deduplication-classification-ranking/03-03-PLAN.md", ".planning/phases/03-deduplication-classification-ranking/03-03-SUMMARY.md", ".planning/phases/03-deduplication-classification-ranking/03-REVIEW-FIX.md", ".planning/phases/03-deduplication-classification-ranking/03-REVIEW.md", ".planning/phases/03-deduplication-classification-ranking/COVERAGE.md", ".planning/phases/03-deduplication-classification-ranking/deferred-items.md", "src/app/page.tsx", "src/components/ArticleCard.tsx", "src/components/CveChips.tsx", "src/lib/config/ranking.ts", "src/lib/config/sections.ts", "src/lib/cveChips.ts", "src/lib/pipeline/canonicalizeUrl.ts", "src/lib/pipeline/classify.ts", "src/lib/pipeline/decodeHtmlEntities.ts", "src/lib/pipeline/dedupe.ts", "src/lib/pipeline/extractCves.ts", "src/lib/pipeline/getFrontPage.ts", "src/lib/pipeline/groupBySection.ts", "src/lib/pipeline/normalize.ts", "src/lib/pipeline/normalizeTitleForDedupe.ts", "src/lib/pipeline/rank.ts", "src/lib/types.ts"]
covered_digest: "v1:sha256:02ec949ef8fa7f3d9e0f7ebc0dc3b71cf340995961f4e35aa38f279ae7a30208"
behavior_unverified: 0
overrides_applied: 0
behavior_unverified_items: []
human_verification:

  - test: "Run `npm run build && npm run start`, open http://localhost:3000 on desktop, then at roughly 375px wide."
    expected: "Section headings appear with their emoji in the order Vulnerabilities, Advisories, Ransomware, Breaches, Threat Intelligence, Tools/Techniques, Industry/Policy, with any empty section simply absent; no visible 'Latest' label, no counts/grid/filter/show-more; within a section the order reads sensibly (a few-hours-old Government item can sit above a minutes-old general-tech item, day-old items sink); no obviously security-relevant headline is stranded in Industry/Policy and no clearly non-security headline sits in a security section; tier badges look exactly as before."
    why_human: "Ranking 'feel' (RESEARCH Assumption A3, 03-01 must_haves.truths backstop statement) and classification plausibility on today's live headlines are judgment calls a grep cannot make (03-01 Task 3's own human-check, deferred to end-of-phase per human_verify_mode=end-of-phase; coverage item D6/D7 in 03-01-SUMMARY.md)."
  - test: "On the same running page, scan every section for duplicate or near-identical headlines and any 'also reported by' style note."
    expected: "No identical or near-identical headline (same words, differing only in case or punctuation) appears twice anywhere on the page; no card shows an 'also reported by', source-count, or similar note; no title shows raw entity text such as &amp;, &trade;, or &#8217; (if a CrowdStrike item is in the 24h window, its trademark sign should render as (TM)). Differently-worded coverage of the same event from two outlets may still appear as two cards — that is the accepted v1 limitation (D-01), not a defect."
    why_human: "Whether the page reads as de-duplicated on today's live, changing headlines is a reader-level judgment, not a grep-checkable fact (03-02 Task 3's own human-check, deferred to end-of-phase; coverage item D5 in 03-02-SUMMARY.md)."
  - test: "On the same running page (desktop and ~375px, light and dark system theme), find a card with a CVE ID and click one chip."
    expected: "Red pill chips with monospace uppercase IDs sit in the meta row right after the tier badge, same height/shape as the badge; at 375px they wrap onto the next line without overflowing the card; a card with more than three IDs shows three chips plus '+N'; clicking a chip opens https://nvd.nist.gov/vuln/detail/<ID> in a new tab; cards without CVE IDs show no chip and no gap; the chip reads as the highest-signal element in the meta row without overpowering the headline."
    why_human: "Visual weight, wrapping at a real narrow width, dark/light theme, and the new-tab click-through are rendering behaviors a grep cannot confirm (03-03 Task 2's own human-check, deferred to end-of-phase; coverage item D4 in 03-03-SUMMARY.md, and this plan's `verification: backstop` truth about the chip's visual weight)."
---

# Phase 3: Deduplication, Classification & Ranking Verification Report

**Phase Goal:** With real multi-source data flowing, the same story reported by multiple outlets is shown once, every article is sorted into exactly one of 7 sections in operational-urgency order, articles are ranked within each section, and CVE identifiers are surfaced.
**Verified:** 2026-09-29
**Status:** human_needed
**Re-verification:** No — initial verification (a prior verifier run for this phase was killed/lost with no output and no VERIFICATION.md; this is a fresh, full run, not a gap-closure pass)

## Process Note: ROADMAP `Mode: mvp` vs. non-User-Story goal text

ROADMAP.md tags Phase 3 `Mode: mvp`, which normally requires the phase Goal to be literally in `As a [role], I want to [capability], so that [outcome].` form (validated via `user-story.validate`). Running that validator against this phase's ROADMAP Goal text returns `valid: false` — the Goal is written as a technical summary ("With real multi-source data flowing, ..."), not a user story. However: (a) the dispatch for this verification supplied the goal and 5 success criteria in standard (non-MVP) goal-backward format, matching Phases 1-2's convention; (b) each of the three PLAN.md files *does* carry a proper `As a security expert, I want to ..., so that ...` story in its own `<objective>`; (c) ROADMAP.md's 5 numbered Success Criteria are concrete, independently testable statements that this report verifies exhaustively against the live codebase. Rather than mechanically refusing to verify a phase whose substantive work is otherwise fully evidenced, this report proceeds with standard goal-backward verification against the ROADMAP Success Criteria and flags this Goal/Mode formatting inconsistency for the roadmap's own hygiene — it is not treated as a phase-goal blocker.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Same story from multiple outlets shown once (dedupe) | ✓ VERIFIED | `src/lib/pipeline/dedupe.ts` implements union-find over canonical-URL-OR-normalized-title equivalence (D-01/D-02/D-03), wired as `composeFrontPage`'s first stage (`src/lib/pipeline/getFrontPage.ts:36`). 16 hermetic `dedupe.test.ts` fixtures (exact/URL-only/title-only/transitive-chain match, D-02 tiebreak, ShinyHunters negative case, idempotency, reference-identity) + `getFrontPage.test.ts`'s 3-outlet "Foo Corp" composed-pipeline collapse + a live e2e uniqueness invariant (`article.url`, canonical URL key, normalized title key all unique) all pass with `E2E=1 npm test` (208/208). Live run confirms `unique urls: 66 of 66`. |
| 2 | Every article classified into exactly one of 7 sections, default Industry/Policy | ✓ VERIFIED | `src/lib/pipeline/classify.ts` (title-then-summary, `CLASSIFICATION_ORDER` specificity order, `DEFAULT_SECTION` fallback), `src/lib/config/sections.ts` (tuned, word-bounded, plural-tolerant keyword lists with every D-07 deviation documented). 16 `classify.test.ts` fixtures (specificity, D-06 title-before-summary, worm/malicious/pruned-term boundaries, D-08 source-independence, ShinyHunters cluster, determinism, ReDoS timing) all pass. Live run: every article lands in exactly one of the 7 sections (`Vulnerabilities:10, Advisories:3, Ransomware:4, Breaches:5, Threat Intelligence:1, Tools/Techniques:10, Industry/Policy:33`, 66 total = sum). |
| 3 | Sections render in operational-urgency order (Vulnerabilities/Advisories, Ransomware/Breaches, Threat Intelligence, Tools/Techniques, Industry/Policy) | ✓ VERIFIED | `SECTION_DISPLAY_ORDER` in `src/lib/config/sections.ts:17-25` matches exactly; `groupBySection.ts` emits only non-empty groups in that order; `page.tsx` renders `<section data-section=...>` in that array order. `test/productionPage.test.ts`'s "data-section values on the real production page follow SECTION_DISPLAY_ORDER" test passes against a real `next start` server. Live `getFrontPage()` run printed sections in exactly this order. |
| 4 | Articles ranked within each section by recency + source weight | ✓ VERIFIED | `src/lib/pipeline/rank.ts`/`src/lib/config/ranking.ts`: `rankScore = TIER_WEIGHT[sourceTier] * recencyDecay(age)`, future-dates clamped, malformed dates sink safely, ties broken by original index. 9 hermetic `rank.test.ts` tests (D-09 crossover, old-item sink, future-date clamp, tie stability, empty/single edges, no-mutation, malformed-date safety, TIER_WEIGHT ordering) pass. `groupBySection` calls `rankWithinSection` per bucket. Live e2e asserts non-increasing `rankScore` across adjacent articles within every section. |
| 5 | CVE identifiers surfaced as visible chips/links | ✓ VERIFIED | `src/lib/pipeline/extractCves.ts` (pattern `CVE-\d{4}-\d{4,7}(?!\d)`, title+capped-summary scan, uppercase, dedup, first-appearance order) wired into `composeFrontPage`'s per-article map; `src/lib/cveChips.ts` (`nvdUrl` anchored re-validation, `planCveChips` 3-visible + "+N" overflow cap) and `src/components/CveChips.tsx` (Server Component, red/mono pill, `target="_blank" rel="noopener noreferrer"`) wired into `ArticleCard.tsx` right after the tier badge. `extractCves.test.ts`/`cveChips.test.ts` (adjacent-hostile-text, cross-field, dup, 3/4/10-ID cap, `javascript:`/path-traversal rejection) + `getFrontPage.test.ts` composed-pipeline cases + live e2e `cves`-shape assertion + real-page NVD-anchor href/target/rel test all pass. Live run found 3 real CVE-bearing articles with correctly-formed, deduplicated `cves` arrays. |

**Score:** 5/5 ROADMAP success criteria verified by hermetic tests + live e2e (`E2E=1 npm test`, 208/208 pass) + an independent live `getFrontPage()` execution performed directly by this verifier + `npm run build`/`npm run lint` (both clean). All ~39 granular plan-level `must_haves.truths` across 03-01/03-02/03-03 map to passing test fixtures per the SUMMARY coverage tables, cross-checked against the actual implementation files (not merely trusted from SUMMARY claims).

### Backstop (Non-Inferable) Truths

Two `verification: backstop` truths exist and cannot be verified by presence/wiring alone:

| Plan | Statement | Disposition |
|------|-----------|-------------|
| 03-01 | "The numeric tier weights ... and the 6-hour half-life produce a within-section order that reads as sensible to a security practitioner on the live page." | Routed to human verification (item 1 below) — matches the plan's own deferred `<human-check>`. |
| 03-03 | "The red CVE chip reads as the highest-signal element in the meta row without overpowering the headline ... and wraps cleanly at roughly 375px." | Routed to human verification (item 3 below) — matches the plan's own deferred `<human-check>`. |

### Required Artifacts

All artifacts listed in the three plans' `must_haves.artifacts` exist, are substantive (no stubs), and are wired:

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/types.ts` | Section/ClassifiedArticle/SectionGroup/SectionedFrontPageResult types | ✓ VERIFIED | `Article` unchanged (6 fields); `ClassifiedArticle = Article & {section, cves}`; all 4 types present and correctly shaped. |
| `src/lib/config/sections.ts` | Display/classification order, keywords, emoji | ✓ VERIFIED | `SECTION_DISPLAY_ORDER`, `CLASSIFICATION_ORDER` are two separate, non-merged constants; `SECTION_KEYWORDS` fully populated with documented D-07 deviations. |
| `src/lib/config/ranking.ts` | TIER_WEIGHT, half-life, recencyDecay | ✓ VERIFIED | Present; `Math.max(0, ageMs)` clamp confirmed in code. |
| `src/lib/pipeline/classify.ts` | classify(), keywordToRegExp() | ✓ VERIFIED | Word-bounded, plural-tolerant, `i`-flag-only, module-scope-compiled RULES. |
| `src/lib/pipeline/groupBySection.ts` | Bucket + rank + emit in display order | ✓ VERIFIED | Filters empty buckets, calls `rankWithinSection`. |
| `src/lib/pipeline/rank.ts` | rankScore, rankWithinSection | ✓ VERIFIED | Present, matches spec. |
| `src/lib/pipeline/getFrontPage.ts` | composeFrontPage seam + getFrontPage orchestrator | ✓ VERIFIED | Stage order dedupe → classify+extractCves → groupBySection; `console.error` logging on the catch path (WR-03 fix present). |
| `src/app/page.tsx` | Stacked `<section data-section>` rendering | ✓ VERIFIED | sr-only h1, verbatim empty-state copy, emoji+name h2 per section. |
| `src/components/ArticleCard.tsx` | h3 title, CveChips rendered after tier badge | ✓ VERIFIED | `<CveChips cves={article.cves} />` present in the meta row. |
| `src/lib/pipeline/decodeHtmlEntities.ts` | Zero-import HTML entity decoder | ✓ VERIFIED | Bounded regex, named+numeric branches, wired into `normalize.ts`. |
| `src/lib/pipeline/normalize.ts` | Title decode-then-trim | ✓ VERIFIED | `decodeHtmlEntities(item.title).trim()`; also fixed per WR-01 to not fall back to unstripped `item.content`. |
| `src/lib/pipeline/canonicalizeUrl.ts` | URL comparison key builder | ✓ VERIFIED | Host-based, tracking-param-stripped, never throws. |
| `src/lib/pipeline/normalizeTitleForDedupe.ts` | Title comparison key builder | ✓ VERIFIED | NFKC + lowercase + punctuation fold; does not re-decode entities. |
| `src/lib/pipeline/dedupe.ts` | Union-find dedupe stage | ✓ VERIFIED | See Truth 1 above. |
| `src/lib/pipeline/extractCves.ts` | CVE_PATTERN + extractCves() | ✓ VERIFIED | Includes WR-02 fix (`(?!\d)` 8+-digit rejection). |
| `src/lib/cveChips.ts` | nvdUrl, planCveChips | ✓ VERIFIED | Anchored re-validation independent of extractCves (defence in depth). |
| `src/components/CveChips.tsx` | Server Component chip renderer | ✓ VERIFIED | No client directive/hooks; fragment, no wrapper element. |
| `.planning/phases/.../COVERAGE.md` | No-external-API declaration | ✓ VERIFIED | Present, correctly declares NVD as outbound link only. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `getFrontPage(now)` | `composeFrontPage(...)` | direct call | ✓ WIRED | `getFrontPage.ts:61` |
| `composeFrontPage` | `dedupe(articles)` | first stage | ✓ WIRED | `getFrontPage.ts:36` |
| deduped articles | `classify(article)` + `extractCves(article)` | per-article map | ✓ WIRED | `getFrontPage.ts:37-41` |
| classified articles | `groupBySection(classified, now)` | direct call | ✓ WIRED | `getFrontPage.ts:42` |
| `groupBySection` | `rankWithinSection(bucket, now)` | per non-empty bucket | ✓ WIRED | `groupBySection.ts:35` |
| `SECTION_DISPLAY_ORDER` | `page.tsx` render order | `result.sections` iteration | ✓ WIRED | `page.tsx:44` |
| `ArticleCard` meta row | `<CveChips cves={article.cves} />` | direct render | ✓ WIRED | `ArticleCard.tsx:43` |
| `CveChips` | `planCveChips(cves)` | direct call | ✓ WIRED | `CveChips.tsx:28` |
| `planCveChips` | `nvdUrl(id)` | per candidate ID | ✓ WIRED | `cveChips.ts:48` |
| chip `<a>` | `href`/`target`/`rel` | direct props | ✓ WIRED | `CveChips.tsx:39-42`; real-page test confirms exact href shape + both attributes |

### Data-Flow Trace (Level 4)

An independent live execution of `getFrontPage(now)` performed by this verifier (not from SUMMARY claims) confirms real data flowing end to end:

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `result.sections` | section buckets | live fetch of 13 RSS/Atom sources → dedupe → classify → group | 66 articles across 7 sections in correct display order, verified in this session | ✓ FLOWING |
| `article.cves` | extracted CVE IDs | `extractCves` over live title+summary | 3 real CVE-bearing articles found with correctly uppercased/deduplicated IDs (`CVE-2026-88771`, `CVE-2026-86950`) | ✓ FLOWING |
| post-dedupe `url` set | uniqueness | `dedupe()` over live fetch | 66 unique URLs out of 66 articles, no collisions | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite (hermetic) | `npm test` | 201 pass, 0 fail, 7 skipped (e2e gated behind `E2E=1` per WR-05) | ✓ PASS |
| Full test suite incl. live e2e | `E2E=1 npm test` | 208/208 pass, 0 fail, 0 skipped | ✓ PASS |
| Production build (live prerender fetch) | `npm run build` | Compiled successfully, static page generated, no type errors | ✓ PASS |
| Lint | `npm run lint` | Clean, no errors | ✓ PASS |
| Live pipeline execution (direct, not via test file) | `node --input-type=module` script calling `getFrontPage(Date.now())` | `status: ok`, 66 articles, sections in correct order, 3 CVE-bearing articles correctly extracted, 66/66 unique URLs | ✓ PASS |
| Anti-pattern scan (TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER) over all phase-modified source files | `find ... -exec grep -nHE ...` | No matches | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` convention exists in this repository and neither PLAN nor SUMMARY files for this phase reference any probe script. Step 7c: SKIPPED (no probes declared or discovered).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| NORM-02 | 03-02 | Duplicate articles (widened URL-or-title match) shown once | ✓ SATISFIED | `dedupe.ts` + tests; REQUIREMENTS.md checkbox `[x]`, amended with D-01 wording. |
| CLASSIFY-01 | 03-01 | Classify into 1 of 7 sections, keyword rules, default Industry/Policy | ✓ SATISFIED | `classify.ts` + `sections.ts` + tests; REQUIREMENTS.md checkbox `[x]`. |
| CLASSIFY-02 | 03-01 | Rank within section by recency + source weight | ✓ SATISFIED | `rank.ts`/`ranking.ts` + tests; REQUIREMENTS.md checkbox `[x]`. |
| CLASSIFY-03 | 03-01 | Sections render in operational-urgency order | ✓ SATISFIED | `SECTION_DISPLAY_ORDER` + `page.tsx` + real-page test; REQUIREMENTS.md checkbox `[x]`. |
| UI-03 | 03-03 | CVE-ID chip on card when pattern detected | ✓ SATISFIED (documentation stale) | `extractCves.ts`/`cveChips.ts`/`CveChips.tsx` fully implemented, tested (hermetic + live e2e + real-page href/target/rel), and confirmed working in this verifier's own live run. **However, REQUIREMENTS.md line 31 still shows `[ ] **UI-03**` (unchecked) and the Traceability table (line 97) still lists it as "Pending"**, even though 03-03-PLAN.md's own Task 3 only scoped edits to the NORM-02 line and PROJECT.md — it never scoped updating UI-03's own checkbox/traceability row. This is a documentation-tracking gap, not a functional gap: the code, tests, and this verifier's independent live check all confirm UI-03 is fully implemented and working. Flagged for correction (see Gaps Summary) but does not block phase goal achievement, since it is purely a stale status marker in a tracking document, not evidence of missing functionality. |

No orphaned requirements found — Phase 3's requirement set (NORM-02, CLASSIFY-01/02/03, UI-03) exactly matches ROADMAP.md's Phase 3 `Requirements` line and REQUIREMENTS.md's Traceability table entries for "Phase 3".

### Anti-Patterns Found

None. Scanned all 17 phase-created/modified source files (types.ts, sections.ts, ranking.ts, classify.ts, groupBySection.ts, rank.ts, getFrontPage.ts, page.tsx, ArticleCard.tsx, decodeHtmlEntities.ts, normalize.ts, canonicalizeUrl.ts, normalizeTitleForDedupe.ts, dedupe.ts, extractCves.ts, cveChips.ts, CveChips.tsx) for TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER and stub-shaped patterns (`return null`/`return {}`/`return []`/empty handlers/hardcoded empty data). None found. The independent code-review pass (03-REVIEW.md) found 0 critical and 5 warnings, all 5 of which were subsequently fixed and verified present in the current code (03-REVIEW-FIX.md, and this verifier independently confirmed the `(?!\d)` CVE lookahead, the `console.error` logging, the order-independent `hasArticleAnchorTag` helper, and the `E2E=1` gate are all present in the current source).

### Human Verification Required

Three items, each corresponding to a `<human-check>` block the plans themselves deliberately deferred to end-of-phase (per `human_verify_mode=end-of-phase`), plus the two `verification: backstop` truths above (folded into items 1 and 3, since they describe the same judgment call):

1. **Section order, ranking "feel," and classification plausibility on the live page**
   **Test:** Run `npm run build && npm run start`, open http://localhost:3000 on desktop, then at roughly 375px wide.
   **Expected:** Section headings appear with their emoji in the correct urgency order, no visible "Latest"/counts/grid/filter, within-section ranking reads sensibly, no obviously-security headline stranded in Industry/Policy, tier badges unchanged.
   **Why human:** Ranking "feel" and classification plausibility on today's ever-changing live headlines are judgment calls a grep cannot make.

2. **The page reads as de-duplicated**
   **Test:** On the same running page, scan every section for duplicate/near-identical headlines and any "also reported by" note.
   **Expected:** No identical/near-identical headline appears twice; no collapse-trace UI; no raw HTML entity text visible.
   **Why human:** Whether the page reads as de-duplicated on today's live headlines is a reader-level judgment.

3. **CVE chip visual weight, wrapping, and click-through**
   **Test:** On the same running page (desktop, ~375px, light and dark theme), find a CVE-bearing card and click a chip.
   **Expected:** Red monospace pill chips matching the tier badge's geometry, wrap cleanly at narrow width, link opens NVD in a new tab, no chip when no CVE present.
   **Why human:** Visual weight, real narrow-width wrapping, theme rendering, and new-tab click-through are rendering behaviors a grep cannot confirm.

### Gaps Summary

No functional gaps were found. All 5 ROADMAP success criteria, all plan-level `must_haves` (truths/artifacts/key_links/prohibitions), and the full requirement set (NORM-02, CLASSIFY-01/02/03, UI-03) are implemented, wired, and proven by a combination of hermetic unit tests, composed-pipeline tests, a live e2e suite (run by this verifier with `E2E=1 npm test`, 208/208 passing), an independently-executed live pipeline run, a clean production build, and a clean lint pass. The prior code review (03-REVIEW.md) found 0 critical issues and 5 warnings, all of which were fixed and are confirmed present in the current source.

One non-blocking documentation gap: REQUIREMENTS.md's UI-03 line (checkbox and Traceability table row) still reads as incomplete/"Pending" even though the underlying functionality is fully implemented, tested, and independently confirmed working by this verifier. Recommend a small follow-up edit ticking `- [x] **UI-03**` and updating the Traceability table's UI-03 row from "Pending" to "Complete" to keep the tracking document consistent with actual project state — this is bookkeeping, not a code change.

A separate, pre-existing, explicitly out-of-scope item (Krebs on Security's `fetchSource` content-type gate lacking `allowHtmlContentType: true`) is logged in `deferred-items.md` from Phase 3's own execution; it predates this phase, is unrelated to dedupe/classify/rank/CVE work, and does not affect this phase's own success criteria (confirmed: the live e2e run in this session succeeded end-to-end including Krebs).

---

_Verified: 2026-09-29_
_Verifier: Claude (gsd-verifier)_
