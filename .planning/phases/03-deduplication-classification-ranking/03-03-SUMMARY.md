---
phase: 03-deduplication-classification-ranking
plan: 03
subsystem: article-cards, pipeline, planning-docs
tags: [cve-detection, nvd-links, server-components, tailwind, documentation]

requires:
  - phase: 03-02
    provides: composeFrontPage's deduped article list (the per-article map that Task 1 extends with CVE extraction)
provides:
  - CVE ID detection (extractCves) scanning title + capped summary, uppercase, deduplicated, first-appearance order
  - Validated NVD link model (cveChips.ts: nvdUrl, planCveChips) that never builds an href from feed-supplied text
  - CveChips Server Component rendering up to 3 red monospace pill chips + "+N" overflow, matching SourceTierBadge geometry
  - ClassifiedArticle.cves field wired through composeFrontPage and rendered in ArticleCard's meta row
  - Corrected PROJECT.md section-order (D-12) and dedupe (D-01) documentation, plus src/lib/config/sections.ts pointer (D-07)
  - REQUIREMENTS.md NORM-02 amendment recording the D-01 widened dedupe rule
  - COVERAGE.md declaring Phase 3 has no external API integration
affects: [phase-04-newspaper-front-page, article-card-rendering, gsd-secure-phase]

actuals:
  tokens: 7900
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Pure-function-per-pipeline-stage: extractCves and cveChips.ts are plain TypeScript with no React import, testable with node --test with zero DOM/rendering dependency"
    - "Server Component chip rendering: CveChips has no client directive or hooks, returns a fragment (no wrapper element) so chips are direct children of the existing meta-row flex container"
    - "Defence-in-depth link validation: nvdUrl re-validates every ID against an anchored pattern before it can become an href, even though extractCves already only emits matched IDs"

key-files:
  created:
    - src/lib/pipeline/extractCves.ts
    - src/lib/pipeline/extractCves.test.ts
    - src/lib/cveChips.ts
    - src/lib/cveChips.test.ts
    - src/components/CveChips.tsx
    - .planning/phases/03-deduplication-classification-ranking/COVERAGE.md
  modified:
    - src/lib/types.ts
    - src/lib/pipeline/getFrontPage.ts
    - src/lib/pipeline/getFrontPage.test.ts
    - src/lib/pipeline/frontpage.e2e.test.ts
    - src/components/ArticleCard.tsx
    - test/productionPage.test.ts
    - .planning/PROJECT.md
    - .planning/REQUIREMENTS.md

key-decisions:
  - "D-13: CVE_PATTERN = /CVE-\\d{4}-\\d{4,7}/gi, case-insensitive, uppercase output, dedup in first-appearance order with title IDs before summary IDs"
  - "D-14: chip href is built only from the regex-matched, anchored-revalidated ID via nvdUrl(); never from feed-supplied URL text; target=_blank + rel=noopener noreferrer on every chip"
  - "D-15: chip geometry is copied verbatim from SourceTierBadge's pill classes, uses the red tone reserved by Phase 2 D-02, and font-mono for the ID"
  - "D-12 (doc correction): PROJECT.md's Active section-order bullet now states Vulnerabilities, Advisories, Ransomware, Breaches, Threat Intelligence, Tools/Techniques, Industry/Policy, replacing the previously wrong parenthetical order"
  - "D-01 (doc correction): PROJECT.md's Context dedupe bullet and REQUIREMENTS.md's NORM-02 line now state the widened either-canonical-URL-or-normalized-title dedupe rule instead of the old exact (title, url) pair wording"
  - "No external API integration for Phase 3 (COVERAGE.md): NVD is an outbound hyperlink target only, never a called service; zero new dependencies (03-RESEARCH.md Standard Stack)"

patterns-established:
  - "Chip components that link to third-party ID lookups build hrefs from a private anchored-regex validator, not from the raw detected value, so a detection bug can never become an injection vector"

requirements-completed: [UI-03]

coverage:
  - id: D1
    description: "CVE ID detection scans title + capped summary, dedups uppercase in first-appearance order (title before summary)"
    requirement: "UI-03"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/extractCves.test.ts"
        status: pass
      - kind: unit
        ref: "src/lib/pipeline/getFrontPage.test.ts (composed-pipeline cves assertions)"
        status: pass
      - kind: e2e
        ref: "src/lib/pipeline/frontpage.e2e.test.ts (live cves shape + equality with extractCves(article))"
        status: pass
    human_judgment: false
  - id: D2
    description: "Chip cap at 3 visible plus a '+N' overflow chip for 4 or more valid IDs; 0 IDs render nothing"
    requirement: "UI-03"
    verification:
      - kind: unit
        ref: "src/lib/cveChips.test.ts (planCveChips 0/3/4/10-ID cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Chip href is built only from a regex-matched, anchored-revalidated ID (never feed-supplied URL text); every chip carries target=_blank and rel=noopener noreferrer"
    requirement: "UI-03"
    verification:
      - kind: unit
        ref: "src/lib/cveChips.test.ts (nvdUrl valid/lowercase/trailing-text/javascript:/path-traversal/empty cases)"
        status: pass
      - kind: integration
        ref: "test/productionPage.test.ts (real-page NVD anchor href-shape + target/rel test)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Chip visual styling matches SourceTierBadge's exact pill geometry, uses the reserved red tone, and a monospace ID, meeting WCAG AA contrast (red-700 on red-50)"
    requirement: "UI-03"
    verification:
      - kind: unit
        ref: "plan 03-03 Task 1 verify block: CHIP_PILL_MATCHES_BADGE grep gate and the oklch contrast-ratio computation (CHIP_CONTRAST_AA, >= 4.5:1)"
        status: pass
    human_judgment: true
    rationale: "Task 2's plan carries an explicit human-check (visual weight, wrapping at ~375px, dark/light theme, click-through to NVD) that a grep/contrast-math gate cannot confirm; not run in this doc-only continuation session."
  - id: D5
    description: "Adjacent-hostile-text and cross-field inputs never produce a false or injected chip"
    requirement: "UI-03"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/extractCves.test.ts (adjacent-hostile-text, cross-field no-match, determinism, 200k-char timing cases)"
        status: pass
    human_judgment: false
  - id: D6
    description: "PROJECT.md's Active section-order bullet lists the D-12 order and no longer contains the old wrong parenthetical"
    requirement: "CLASSIFY-03 (documentation)"
    verification:
      - kind: static-check
        ref: "PLAN.md Task 3 verify: PROJECT_DOC_CORRECTED grep gate"
        status: pass
    human_judgment: false
  - id: D7
    description: "REQUIREMENTS.md's NORM-02 line records the D-01 widened dedupe rule exactly once, Traceability table untouched"
    requirement: "NORM-02 (documentation)"
    verification:
      - kind: static-check
        ref: "PLAN.md Task 3 verify: NORM02_AMENDED grep gate"
        status: pass
    human_judgment: false
  - id: D8
    description: "COVERAGE.md records the phase integrates no external API, backed by the detector's JSON output"
    requirement: "documentation"
    verification:
      - kind: static-check
        ref: "PLAN.md Task 3 verify: API_COVERAGE_DECLARED gate (api-coverage.cjs --json over ROADMAP Phase 3 section returns detected:false)"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-09-28
status: complete
---

# Phase 3 Plan 3: CVE Chips on Article Cards + Phase 3 Documentation Corrections Summary

**CVE identifiers in article titles/summaries now surface as validated, NVD-linked red chips in the card meta row (capped at 3 plus overflow), and the phase's documentation corrections (D-12 section order, D-01 dedupe widening) plus its no-external-API COVERAGE.md declaration are recorded.**

## Performance
- **Duration:** Task 3 (this session) ~12 minutes. Tasks 1-2 ran in an earlier session (see Deviations).
- **Started:** 2026-09-28T11:35:00Z (Task 3 only)
- **Completed:** 2026-09-28T11:46:35Z
- **Tasks:** 3 (all complete across two sessions)
- **Files modified:** 14 (6 created + 2 test files modified in Task 1/2; 3 doc files created/modified in Task 3)

## Accomplishments
- `extractCves()` detects `CVE-\d{4}-\d{4,7}` case-insensitively across title + capped summary, uppercases, dedups, and preserves first-appearance (title-first) order.
- `cveChips.ts` provides a pure link/cap model (`nvdUrl`, `planCveChips`) that defends the href against any malformed or malicious ID reaching it, independent of whether `extractCves` behaves correctly.
- `CveChips` Server Component renders up to 3 red monospace pill chips plus a "+N" overflow chip, matching `SourceTierBadge`'s exact geometry, immediately after the tier badge in `ArticleCard`'s meta row.
- 206/206 tests pass (per Task 2's commit message) including hermetic unit tests, the live e2e `cves`-shape assertion, and a real-page NVD anchor href/target/rel check; `npm run lint` is clean.
- PROJECT.md's Active section-order bullet now states the correct D-12 order; its dedupe bullet cites D-01's widened rule; a new bullet points at `src/lib/config/sections.ts` for the tuned keyword lists (D-07).
- REQUIREMENTS.md's NORM-02 line now records the D-01 widened dedupe rule.
- `COVERAGE.md` declares Phase 3 has no external API integration, backed by the `api-coverage.cjs --json` detector's `{"detected":false,"signals":[]}` result over the Phase 3 ROADMAP section.

## Task Commits
1. **Task 1: CVE chips on the card, end to end** - `f5131ac`
2. **Task 2: Pin CVE detection, the chip cap and link integrity** - `36c061f`
3. **Task 3: Record the phase's documentation corrections and its API coverage declaration** - `5e26e16`
**Plan metadata:** (recorded after this SUMMARY is committed)

## Files Created/Modified
- `src/lib/pipeline/extractCves.ts` - CVE_PATTERN + extractCves(), pure detection over title/summary
- `src/lib/cveChips.ts` - MAX_VISIBLE_CVE_CHIPS, NVD_CVE_DETAIL_BASE, nvdUrl, planCveChips
- `src/components/CveChips.tsx` - Server Component rendering the validated chip plan
- `src/lib/types.ts` - `ClassifiedArticle` gains `cves: string[]`
- `src/lib/pipeline/getFrontPage.ts` - composeFrontPage's per-article map now calls extractCves
- `src/components/ArticleCard.tsx` - renders `<CveChips cves={article.cves} />` after the tier badge
- `src/lib/pipeline/extractCves.test.ts`, `src/lib/cveChips.test.ts` - hermetic unit tests (Task 2)
- `src/lib/pipeline/getFrontPage.test.ts`, `src/lib/pipeline/frontpage.e2e.test.ts` - composed-pipeline and live cves assertions
- `test/productionPage.test.ts` - real-page NVD anchor href-shape + target/rel test
- `.planning/PROJECT.md` - D-12 section-order correction, D-01 dedupe citation, D-07 taxonomy pointer
- `.planning/REQUIREMENTS.md` - NORM-02 amended with the D-01 widened rule
- `.planning/phases/03-deduplication-classification-ranking/COVERAGE.md` - new, no-external-API declaration

## Decisions Made
None beyond the plan's own D-13/D-14/D-15 (CVE detection, link integrity, chip styling) and the D-12/D-01 documentation corrections — all specified in 03-CONTEXT.md and executed as written.

## Deviations from Plan

**Session interruption (not a plan-execution failure):** A prior executor session completed and committed Tasks 1 and 2 (`f5131ac`, `36c061f`) but was interrupted by the user before starting Task 3. This was independently verified by the orchestrator before this continuation session began: 206/206 tests passing, `npm run lint` clean, both commits present on `main`. This session executed only Task 3 (the doc-only corrections and COVERAGE.md) and produced this whole-plan SUMMARY.

### Auto-fixed Issues
None - Task 3 executed exactly as written (scoped Edit replacements plus one new Write, all three verify gates passed on the first attempt).

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
Phase 3 complete — ready for phase verification. Task 2's plan carries an explicit human-check (visual weight of the chips, wrapping at ~375px, light/dark theme, click-through to NVD) that was not re-run in this doc-only continuation session; flagged under coverage item D4 for the phase verifier.

---
*Phase: 03-deduplication-classification-ranking*
*Completed: 2026-09-28*
