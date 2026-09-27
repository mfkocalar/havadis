---
phase: 03-deduplication-classification-ranking
plan: 01
subsystem: classification-ranking
tags: [nextjs, typescript, rss, classification, ranking, keyword-regex, tdd]

# Dependency graph
requires:
  - phase: 02-full-ingestion-failure-isolation
    provides: "getFrontPage/fetchSource/fanOut/filterLookback ingestion pipeline this plan extends with classify -> group -> rank stages"
provides:
  - "Section/ClassifiedArticle/SectionGroup/SectionedFrontPageResult types"
  - "sections.ts config (SECTION_DISPLAY_ORDER, CLASSIFICATION_ORDER, DEFAULT_SECTION, SECTION_EMOJI, SECTION_KEYWORDS)"
  - "classify()/keywordToRegExp() — tuned, word-bounded, plural-tolerant keyword classification"
  - "groupBySection() — buckets into non-empty SECTION_DISPLAY_ORDER groups"
  - "ranking.ts + rank.ts — TIER_WEIGHT x recencyDecay within-section ranking (rankScore/rankWithinSection)"
  - "composeFrontPage() seam and getFrontPage(now) — the pipeline seam Plans 03-02/03-03 extend"
  - "stacked-section page.tsx rendering with emoji headings"
  - "hermetic fixture suites (classify.test.ts, groupBySection.test.ts, rank.test.ts) plus live e2e and real-page assertions"
affects: [03-02-dedupe, 03-03-cve-chips, 04-ui-filter-and-counts]

# Actuals (#2632)
actuals:
  tokens: 14400
  tasks: 3
  commits: 2
  plan_head_before: 0f0437a995554a81a6b5894c421317c66c60c476

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two separate order constants (SECTION_DISPLAY_ORDER for render order, CLASSIFICATION_ORDER for rule specificity), never merged"
    - "keywordToRegExp: escape-then-word-bound-then-plural-suffix compiler, i-flag only, compiled once at module scope — ReDoS-safe, order-deterministic"
    - "Live-then-lock validation loop: run a live-distribution smoke command against today's real feeds, review every classified headline against two bounded tuning criteria, then either apply a documented one-line keyword edit + fixture or record 'no tuning change'"
    - "Fixture-locking test files (classify.test.ts, groupBySection.test.ts) pin already-implemented pipeline behavior with titles sourced from a dated live RESEARCH.md snapshot, one test per behavior group"

key-files:
  created:
    - src/lib/config/sections.ts
    - src/lib/config/ranking.ts
    - src/lib/pipeline/classify.ts
    - src/lib/pipeline/classify.test.ts
    - src/lib/pipeline/groupBySection.ts
    - src/lib/pipeline/groupBySection.test.ts
    - src/lib/pipeline/rank.ts
    - src/lib/pipeline/rank.test.ts
  modified:
    - src/lib/types.ts
    - src/lib/pipeline/getFrontPage.ts
    - src/app/page.tsx
    - src/components/ArticleCard.tsx
    - src/lib/pipeline/frontpage.e2e.test.ts
    - test/productionPage.test.ts

key-decisions:
  - "SECTION_DISPLAY_ORDER (D-12 render order) and CLASSIFICATION_ORDER (D-05 rule specificity order) are kept as two separate exported constants, guarded by an ORDERS_LOCKED gate — a broad rule only claims what a more specific rule didn't already take."
  - "keywordToRegExp compiles literal keywords into word-bounded, plural-tolerant (`(?:e?s)?`), case-insensitive-only (never g/y) patterns compiled once at module scope, so classification stays deterministic and ReDoS-safe on unbounded feed-supplied titles (T-03-01)."
  - "D-07 documented deviations from the reference taxonomy: bare `worm` narrowed to `computer worm` (live false positive on an Ars Technica biology headline), bare `malicious` narrowed to `malicious actor`, and the TA-actor RegExp bounded to `\\bTA\\d{1,5}\\b` — each locked by a classify.test.ts fixture."
  - "TIER_WEIGHT exact numbers (Government 1.5, Security Research/Threat Intelligence 1.3, Enterprise Security/Executive News 1.15, Tech & General 1.0) and RANK_HALF_LIFE_HOURS=6 were Claude's discretion per CONTEXT.md, producing roughly a 3.5h D-09 crossover."
  - "recencyDecay clamps age with Math.max(0, ageMs) before exponentiation, so a future-dated feed item (RESEARCH Pitfall 1: a Dark Reading item dated 71 days ahead) scores identically to a same-tier item published at `now`, never higher."
  - "sortByRecencyDesc.ts and its test were deleted in Task 2 — fully superseded by rankWithinSection/groupBySection, per RESEARCH's Open Question 2 and CONTEXT's discretion note."
  - "Task 3's live-distribution snapshot (13 articles surviving the 24h window today) was reviewed line-by-line against the two bounded tuning criteria (prune/narrow a keyword causing a visible misclassification, or add a term when a clearly on-topic security article lands in Industry/Policy without one) — no article met either bar, so SECTION_KEYWORDS is unchanged from Task 1's tuning this cycle."
  - "[Rule 3 - Blocking] Ran `npm ci` inside this worktree before `npm run build`/`test`/`lint` — the freshly created worktree had no `node_modules` at all (Turbopack's hermetic build resolution refuses to look above the worktree root), so none of Task 3's verify commands could run without it. This restores the exact versions already pinned in the committed `package-lock.json` — no new or unpinned package was introduced, so this is not the package-legitimacy exclusion in Rule 3."

requirements-completed: [CLASSIFY-01, CLASSIFY-02, CLASSIFY-03]

coverage:
  - id: D1
    description: "Sectioned data model and config: Section/ClassifiedArticle/SectionGroup/SectionedFrontPageResult types, plus SECTION_DISPLAY_ORDER/CLASSIFICATION_ORDER/DEFAULT_SECTION/SECTION_EMOJI/SECTION_KEYWORDS as two never-merged order constants"
    requirement: "CLASSIFY-03"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/classify.test.ts#CLASSIFICATION_ORDER plus DEFAULT_SECTION covers exactly the 7 display sections; the two order constants are different sequences"
        status: pass
      - kind: other
        ref: "node --input-type=module ORDERS_LOCKED smoke gate (Task 1 verify block)"
        status: pass
    human_judgment: false
  - id: D2
    description: "classify()/keywordToRegExp(): title-then-summary, D-05/06/07/08-tuned keyword classification engine, word-bounded and plural-tolerant, no source-based override"
    requirement: "CLASSIFY-01"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/classify.test.ts (16 tests: D-05 specificity, D-06 title-before-summary, D-07 worm/malicious/pruned-term boundaries, D-08 source-independence, Pitfall 4 ShinyHunters cluster, determinism, ReDoS timing, keywordToRegExp edges)"
        status: pass
    human_judgment: false
  - id: D3
    description: "groupBySection(): buckets classified articles by section, emits only non-empty groups in SECTION_DISPLAY_ORDER, ranked within each group"
    requirement: "CLASSIFY-03"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/groupBySection.test.ts (8 tests: display order, empty-section omission, empty/single-article edges, exactly-once membership, within-section rank order, no mutation)"
        status: pass
    human_judgment: false
  - id: D4
    description: "rank.ts/ranking.ts: rankScore = TIER_WEIGHT[sourceTier] x recencyDecay(age); rankWithinSection orders each bucket, ties broken by original index, future/malformed dates clamp to a safe score"
    requirement: "CLASSIFY-02"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/rank.test.ts (9 tests: D-09 crossover, old-item sink, future-date clamp, tie-order stability, empty/single edges, no mutation, malformed-date safety, TIER_WEIGHT ordering)"
        status: pass
    human_judgment: false
  - id: D5
    description: "composeFrontPage()/getFrontPage(now): the pipeline seam threading classify -> group -> rank end to end, `now` sampled once, never-throws contract preserved"
    requirement: "CLASSIFY-01"
    verification:
      - kind: e2e
        ref: "src/lib/pipeline/frontpage.e2e.test.ts (5 tests, incl. the new 'within every live section, adjacent articles are non-increasing by rankScore for the same now')"
        status: pass
    human_judgment: false
  - id: D6
    description: "Real production page renders stacked <section data-section> groups with emoji + name h2 headings, in SECTION_DISPLAY_ORDER, empty state preserved verbatim"
    requirement: "CLASSIFY-03"
    verification:
      - kind: automated_ui
        ref: "test/productionPage.test.ts (5 tests, incl. the new 'data-section values on the real production page follow SECTION_DISPLAY_ORDER')"
        status: pass
    human_judgment: true
    rationale: "Section-heading visual layout and within-section ranking 'feel' on today's live headlines are judgment calls a grep cannot make (per Task 3's own <human-check> clause). human_verify_mode=end-of-phase defers this sign-off to end-of-phase UAT harvesting rather than a synthesized mid-plan checkpoint."
  - id: D7
    description: "Live taxonomy re-validation: today's 13-article live snapshot (DISTRIBUTION {\"Industry/Policy\":6,\"Vulnerabilities\":4,\"Breaches\":2,\"Ransomware\":1}) reviewed against the two bounded D-07 tuning criteria — no keyword change met the bar"
    requirement: "CLASSIFY-01"
    verification:
      - kind: other
        ref: "node --input-type=module live-distribution command (Task 3 verify block); every printed [Section] title reviewed manually against the bounded tuning criteria"
        status: pass
    human_judgment: true
    rationale: "Classification plausibility on today's live headlines is itself a judgment call; the executor performed one independent read this session, but a second human read at end-of-phase UAT is the safety net this class of judgment call needs, consistent with human_verify_mode=end-of-phase."

duration: ~35min (Task 3 only, this session; Tasks 1-2 ran in an earlier, separate session — see commits de5cb5f, 13efd37)
completed: 2026-09-27
status: complete
---

# Phase 3 Plan 1: Sectioned, Classified and Ranked Front Page Summary

**Every article is now classified into one of 7 urgency-ordered sections by tuned, word-bounded keyword rules and ranked within each section by tier weight x recency decay — proven end to end against live feeds, hermetic fixtures, and a real `next start` production page.**

## Performance

- **Tasks 1-2:** prior, separate executor session (stalled before Task 3; independently sanity-checked and merged into `main` by the orchestrator — not a redo in this session).
- **Task 3 duration (this session):** ~35 min
- **Task 3 completed:** 2026-09-27T09:11:58Z
- **Tasks:** 3/3 complete (this session executed Task 3 only)
- **Files modified (Task 3):** 4 (2 new test files, 2 extended test files)
- **Files across the whole plan:** 14 (8 created, 6 modified — see `key-files`)

## Accomplishments

- Classification engine (`classify.ts` + `sections.ts`) sorts every article into exactly one of 7 sections via specificity-ordered, word-bounded, plural-tolerant keyword rules, defaulting to Industry/Policy — with every D-07 taxonomy deviation (pruned/narrowed terms, added morphological variants) documented and fixture-locked.
- Within-section ranking (`rank.ts` + `ranking.ts`) orders articles by `TIER_WEIGHT[sourceTier] x recencyDecay(age)`, clamping future-dated feed items to a safe score and sinking malformed dates without throwing.
- The full pipeline (`composeFrontPage`/`getFrontPage`) and the real page (`page.tsx`) render stacked, urgency-ordered section headings end to end against the live feeds, with the empty state preserved verbatim.
- Task 3 locked all of the above with hermetic fixture suites (`classify.test.ts`, `groupBySection.test.ts`), a live re-validation of today's taxonomy distribution, a live non-increasing-rankScore e2e assertion, and a real-production-page `data-section`/`SECTION_DISPLAY_ORDER` assertion.

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end "articles grouped under urgency-ordered section headings"** - `de5cb5f` (feat, tracer — prior session)
2. **Task 2: Rank articles within each section by tier weight x recency decay** - `13efd37` (feat — prior session)
3. **Task 3: Lock classification and section order with fixtures, a live snapshot and the real rendered page** - `ec60f69` (test) + `865a014` (test) — this session

**Plan metadata:** commit created after this SUMMARY (see below)

_Note: Task 3 needed no implementation change (zero tuning changes met the bounded criteria this cycle), so both of its commits are `test(03-01)` rather than `feat(03-01)`._

## Files Created/Modified

**Task 1 (prior session):**
- `src/lib/types.ts` - `Section`, `ClassifiedArticle`, `SectionGroup`, `SectionedFrontPageResult`
- `src/lib/config/sections.ts` - `SECTION_DISPLAY_ORDER`, `CLASSIFICATION_ORDER`, `DEFAULT_SECTION`, `SECTION_EMOJI`, `SECTION_KEYWORDS`
- `src/lib/pipeline/classify.ts` - `keywordToRegExp`, `classify`
- `src/lib/pipeline/groupBySection.ts` - buckets + emits non-empty display-order groups
- `src/lib/pipeline/getFrontPage.ts` - `composeFrontPage` seam, `getFrontPage` returns `SectionedFrontPageResult`
- `src/app/page.tsx` - stacked `<section data-section>` rendering, sr-only `h1`
- `src/components/ArticleCard.tsx` - title `h2` -> `h3`
- `src/lib/pipeline/frontpage.e2e.test.ts` - section-shape e2e test added, global-recency test removed

**Task 2 (prior session):**
- `src/lib/config/ranking.ts` - `TIER_WEIGHT`, `RANK_HALF_LIFE_HOURS`, `recencyDecay`
- `src/lib/pipeline/rank.ts` - `rankScore`, `rankWithinSection`
- `src/lib/pipeline/rank.test.ts` - 9 hermetic ranking tests
- `src/lib/pipeline/groupBySection.ts` - gained `now` param, ranks each bucket
- `src/lib/pipeline/getFrontPage.ts` - threads `now` through
- `src/lib/pipeline/sortByRecencyDesc.ts` / `.test.ts` - **deleted** (superseded)

**Task 3 (this session):**
- `src/lib/pipeline/classify.test.ts` - new, 16 hermetic fixture tests
- `src/lib/pipeline/groupBySection.test.ts` - new, 8 hermetic fixture tests
- `src/lib/pipeline/frontpage.e2e.test.ts` - extended with the live non-increasing-`rankScore` assertion
- `test/productionPage.test.ts` - extended with the real-page `data-section`/`SECTION_DISPLAY_ORDER` assertion

## Decisions Made

See `key-decisions` in frontmatter for the full list. Summary: two order constants stay separate and gated (D-05/D-12); `keywordToRegExp` is the single word-boundary/plural-tolerance/ReDoS-safety mechanism; three D-07 deviations (`computer worm`, `malicious actor`, bounded `\bTA\d{1,5}\b`) are each documented and fixture-locked; tier weights/half-life are Claude's discretion per CONTEXT.md; `recencyDecay` clamps future dates before exponentiation; the interim `sortByRecencyDesc` helper is fully deleted; Task 3's live-distribution review this cycle required no keyword tuning change; and `npm ci` was run once in this freshly created worktree to restore the committed lockfile's pinned dependencies (Rule 3, not the package-legitimacy exclusion — no new package was introduced).

## Deviations from Plan

### Auto-fixed Issues

**1. [Not a deviation — session handoff] Tasks 1-2 executed in an earlier, separate executor session**
- **Context:** A prior executor completed Tasks 1-2 (tracer + ranking) and stalled (600s no-progress) before starting Task 3. This was independently sanity-checked by the orchestrator (rank.test.ts 9/9, ORDERS_LOCKED gate, `tsc --noEmit` clean) and merged into `main` before this session began. This session executed Task 3 only, per its own instructions, and did not redo or re-verify Tasks 1-2's tracer feedback gate.
- **Files/commits:** `de5cb5f`, `13efd37` (unmodified, inherited as-is).

**2. [Pre-existing, out of scope] Krebs on Security `fetchSource` content-type gate**
- **Found during:** Task 1 (documented in `deferred-items.md` before this session began; re-confirmed still present, unchanged, and out of this plan's file scope).
- **Issue:** `krebsonsecurity.com/feed/` serves `text/html; charset=UTF-8`; the `krebs` `SourceConfig` entry lacks `allowHtmlContentType: true`.
- **Why not fixed here:** `src/lib/config/sources.ts` / `src/lib/pipeline/fetchSource.ts` are not in this plan's `files_modified` list; per the executor's scope boundary, this is logged, not fixed. (Note: in this session's own live e2e run, the Krebs fetch happened to succeed — the underlying gate is unresolved and still flagged for a future plan/maintainer.)
- **Suggested fix:** add `allowHtmlContentType: true` to the `krebs` entry.

**3. [Rule 3 - Blocking] Ran `npm ci` in this worktree before `npm run build`/`test`/`lint`**
- **Found during:** Task 3, running `npm run build`.
- **Issue:** This git worktree was created fresh with no `node_modules` at all; Turbopack's hermetic build resolution refuses to resolve `next` from an ancestor directory outside the worktree, so `npm run build` failed immediately with "Could not find the Next.js package."
- **Fix:** Ran `npm ci`, which restores the exact versions already pinned in the committed `package-lock.json` (365 packages, 0 vulnerabilities) — no new or unpinned package was introduced, so this is not the package-legitimacy exclusion in Rule 3's own carve-out.
- **Files modified:** none tracked by git (`node_modules/` is gitignored).
- **Verification:** `npm run build`, `npm test` (113/113 pass), and `npm run lint` (clean) all subsequently succeeded.
- **Committed in:** not applicable (no tracked files changed by this step).

---

**Total deviations:** 1 auto-fixed (1 blocking), plus 1 pre-existing out-of-scope item re-confirmed and 1 session-handoff note.
**Impact on plan:** The `npm ci` fix was necessary purely to run this worktree's own verification commands; it changed no tracked files and introduced no new dependency. No scope creep.

## Issues Encountered

None beyond the `npm ci` blocker above, which was resolved immediately.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `composeFrontPage`'s `sections: SectionGroup[]` shape is the seam Plan 03-02 (dedupe) and Plan 03-03 (CVE chips) slot into without reshaping it, per this plan's own `<reversibility>` note.
- All of CLASSIFY-01, CLASSIFY-02, and CLASSIFY-03 are proven by hermetic fixtures, a live re-validation this cycle, and a real production-page assertion.
- Two coverage items (D6: page visual/ranking "feel"; D7: live-headline classification plausibility) are flagged `human_judgment: true` and will surface at end-of-phase UAT per `human_verify_mode=end-of-phase` — nothing further needed from this plan to unblock 03-02.
- Ready for 03-02.

## Self-Check: PASSED

- FOUND: `src/lib/pipeline/classify.test.ts`
- FOUND: `src/lib/pipeline/groupBySection.test.ts`
- FOUND: `.planning/phases/03-deduplication-classification-ranking/03-01-SUMMARY.md`
- FOUND: commit `ec60f69` (test(03-01): lock classify/groupBySection with fixture, live and safety tests)
- FOUND: commit `865a014` (test(03-01): add live rankScore and real-page section-order assertions)
- FOUND: commit `917c2b8` (docs(03-01): complete deduplication-classification-ranking sectioned front page plan)

---
*Phase: 03-deduplication-classification-ranking*
*Completed: 2026-09-27*
