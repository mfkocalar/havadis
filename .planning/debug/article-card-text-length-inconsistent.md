---
status: resolved
trigger: "article-card-text-length-inconsistent — Article card titles/summaries render with inconsistent length treatment across the 13 configured sources"
created: 2026-09-22T00:00:00Z
updated: 2026-10-01T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED — no length normalization exists at ANY layer (neither a CSS line-clamp in ArticleCard nor a character cap in normalize), and `rss-parser`'s `contentSnippet` is NOT a bounded excerpt despite its name, so each card's height is a direct function of one publisher's editorial choice about how much body text to put in its feed.
test: Read all render/pipeline files; repo-wide grep for truncation; read rss-parser's getSnippet implementation; measured live title/summary lengths across all 13 configured feeds.
expecting: (met) zero truncation utilities, zero length caps, and a large measured length spread across sources.
next_action: Return diagnosis (goal: find_root_cause_only). Do NOT fix — note that the fix contradicts an explicit Phase 1 requirement and needs a documented spec change first.

bug_class: Bohrbug — fully deterministic, reproduces on every render for the same feed content.

rca_branching:
  candidate_causes:
    - "code/presentation: ArticleCard.tsx has no line-clamp on title or summary (CONFIRMED — contributing)"
    - "data: normalize.ts stores rss-parser's uncapped contentSnippet as `summary` (CONFIRMED — contributing)"
    - "config: sources.ts grew 1 -> 13 in Phase 2 (CONFIRMED — trigger/revealer, NOT a cause)"
    - "process/spec: 02-UI-SPEC.md's long-text edge row covered only the new badge labels, never title/summary (CONFIRMED — why it shipped)"
    - "data: normalize.ts's `?? item.content` fallback pulls full raw content (ELIMINATED — see Eliminated)"
  and_gate: "YES — the visible defect requires BOTH (a) no presentation-layer clamp AND (b) an unbounded, wildly variable-length summary field. Capping either layer alone would have contained it. Neither is independently sufficient."

## Symptoms

expected: Article cards render consistently across all 13 sources — titles and summaries display with the same truncation/length treatment card to card, no card overflowing with a much longer untruncated title or summary than its neighbors.
actual: Some cards show much longer untruncated title+summary text than others (CSO Online vs Bleeping Computer example), now visible at 13-source scale since sources vary widely in native title/summary length.
errors: None reported
reproduction: Test 5 in Phase 02 UAT — load dev server front page, visually compare cards across sources.
started: Discovered during Phase 02 UAT (widened source list 1 -> 13). Phase 02 deliberately did not touch ArticleCard/SourceTierBadge.

## Eliminated

- hypothesis: "normalize.ts line 36's `?? item.content` fallback is pulling raw full-article HTML for the long-rendering sources."
  evidence: "Measured live across all 13 feeds: `usedFallback` count is 0 for every source. `item.contentSnippet` is defined for 12/13 sources, so the `?? item.content` branch is never taken. For CrowdStrike (the 13th) BOTH are undefined, yielding `\"\"` — the fallback still isn't the long-text path. The long summaries come from contentSnippet itself being uncapped."
  timestamp: T6

- hypothesis: "A CSS line-clamp exists but fails to apply uniformly (missing Tailwind v4 utility, container without a constrained height, or a conditional that only fires for some content)."
  evidence: "Repo-wide grep for `line-clamp|truncate|overflow|max-h|text-ellipsis|webkit-line-clamp` over src/ returns ZERO matches in any component (the single hit is the word 'max-hop' in a comment in fetchWithValidatedRedirect.ts). globals.css sets only line-height on h1/h2/h3 and p — no clamp, no max-height. There is no truncation to apply non-uniformly; none was ever written."
  timestamp: T4

- hypothesis: "Something in the pipeline (getFrontPage/filterLookback/sortByRecencyDesc) reshapes or caps summary text for some sources."
  evidence: "getFrontPage.ts composes only fanOut -> filterLookback -> sortByRecencyDesc; none touch title or summary content. normalize.ts applies `.trim()` and nothing else. The Article type declares `summary: string` with no length contract."
  timestamp: T7

## Evidence

- timestamp: T0
  checked: .planning/debug/knowledge-base.md
  found: File does not exist — no prior resolved sessions.
  implication: No known-pattern shortcut; investigate from scratch.

- timestamp: T1
  checked: src/components/ArticleCard.tsx (full file, 55 lines)
  found: |
    Title h2 (line 31): className="mt-3 text-xl font-semibold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50"
    Summary p  (line 42): className="mt-2 text-base leading-relaxed text-zinc-600 dark:text-zinc-400"
    Neither has line-clamp-*, truncate, max-h-*, overflow-hidden, or any length constraint.
    {article.title} and {article.summary} are rendered as bare, whole text nodes.
  implication: No CSS truncation exists on either field. Card height is a pure function of feed-native text length.

- timestamp: T2
  checked: src/lib/pipeline/normalize.ts (full file, 38 lines)
  found: |
    Line 31: title: item.title.trim()
    Line 36: summary: (item.contentSnippet ?? item.content ?? "").trim()
    Only .trim() is applied. No .slice(), .substring(), no max-length, no ellipsis.
    Note the `?? item.content` fallback: when a feed omits contentSnippet, the FULL content
    body is used as the summary.
  implication: No data-layer length cap either. The long/short asymmetry passes straight through.

- timestamp: T3
  checked: src/app/page.tsx (full file, 40 lines)
  found: Cards are in a plain `flex flex-col gap-6` stack; no grid, no fixed row height, no per-card height constraint.
  implication: Nothing at the layout level normalizes card heights — no container-level backstop for the missing per-field clamp.

- timestamp: T4
  checked: Repo-wide grep over src/ for line-clamp|truncate|overflow|max-h|text-ellipsis and .slice(|.substring(|maxLength|truncat; plus src/app/globals.css
  found: |
    ZERO truncation utilities and ZERO length caps anywhere in src/. The only grep hit is the
    word "max-hop" inside a code comment in fetchWithValidatedRedirect.ts (unrelated).
    globals.css declares only `h1,h2,h3 { line-height: 1.25 }` and `p { line-height: 1.6 }` —
    no clamp, no max-height, no overflow rule.
  implication: There is no truncation mechanism failing to apply. None was ever implemented.

- timestamp: T5
  checked: node_modules/rss-parser/lib/utils.js and lib/parser.js (the contentSnippet derivation)
  found: |
    utils.js:11  utils.getSnippet = function(str) {
    utils.js:12    return entities.decodeHTML(utils.stripHtml(str)).trim();
    parser.js:149/218  item.contentSnippet = utils.getSnippet(item.content)
    getSnippet applies stripHtml + decodeHTML + trim and NO length limit whatsoever.
  implication: |
    Load-bearing misconception. The name "contentSnippet" implies a short excerpt, but it is
    the publisher's ENTIRE <description>/<content:encoded> body with tags stripped. Whether a
    card's summary is 80 chars or 26,000 chars is decided entirely by the publisher, not by
    Havadis. 01-RESEARCH.md line 251 correctly described it as "strips HTML in contentSnippet"
    but the length implication was never drawn.

- timestamp: T6
  checked: Live measurement of all 13 configured feeds (first 10 items each), computing summary exactly as normalize.ts does
  found: |
    SOURCE                     titleMed titleMax | sumMed  sumMax  | usedContentFallback
    Krebs on Security              49    52      |    476     843  | 0
    CISA Alerts                    34    54      |   6005   26744  | 0
    Recorded Future                56    97      |    211     316  | 0
    Microsoft Security Blog        74    93      |    325     513  | 0
    SANS ISC                      104   107      |    122     376  | 0
    Dark Reading                   63   100      |    143     197  | 0
    CrowdStrike Blog               71   112      |      0       0  | 0
    Bleeping Computer              63    71      |    189     289  | 0
    The Hacker News                81    88      |    393     395  | 0
    Help Net Security              69    80      |    591     651  | 0
    TechCrunch Security            67    89      |    130     204  | 0
    Ars Technica                   73    80      |     80     101  | 0
    CSO Online                     65   124      |   7541    9258  | 0

    SUMMARY spread: median 80 (Ars Technica) -> 7,541 (CSO Online) = ~94x. Max 26,744 (CISA).
    TITLE  spread: median 34 (CISA) -> 104 (SANS ISC) = ~3.1x. Max 124 (CSO Online).
    usedContentFallback is 0 for every source.
  implication: |
    The dominant axis is SUMMARY (~94x median spread), not title (~3.1x) — matching the user's
    report, where the summary was the loudest part of the complaint. Three distinct card shapes
    coexist: full-article-body cards (CISA, CSO Online), one-paragraph cards (most), and a
    ZERO-length-summary card (CrowdStrike).

- timestamp: T7
  checked: src/lib/pipeline/getFrontPage.ts, src/lib/types.ts, and grep of all *.test.ts for truncation assertions
  found: |
    getFrontPage composes fanOut -> filterLookback -> sortByRecencyDesc; none touch text content.
    Article type declares `summary: string` with no length contract.
    No ACTIVE test asserts the absence (or presence) of truncation — the negative grep gate lives
    only in 01-02-PLAN.md's already-executed <verify> block, not in the committed test suite.
  implication: |
    Adding a clamp will not break any CI test — but it WILL contradict a written Phase 1
    requirement (see T8), so the spec must be amended, not silently overridden.

- timestamp: T8
  checked: .planning/phases/01-single-source-pipeline-vertical-slice/01-02-PLAN.md, 01-01-PLAN.md, 01-02-SUMMARY.md
  found: |
    The absence of truncation is EXPLICITLY SPECIFIED, not an oversight:
    - 01-02-PLAN.md:31  "Article titles and summaries render verbatim and untruncated as ordinary
                         JSX text nodes, so no byte, code-point or grapheme-cluster length
                         definition applies to them" (UI-02, encoding edge; threat T-01-07)
    - 01-02-PLAN.md:157 "the title, verbatim and untruncated — no ellipsis, no line clamp, no
                         rewriting, no title-casing"
    - 01-02-PLAN.md:184 verify gate: "No truncation applied to the title: ArticleCard.tsx
                         contains no `line-clamp`, no `truncate` class, and no `.slice(` or
                         `substring(` call on the title"
    - 01-02-PLAN.md:229 human-check asked the reviewer to confirm "the full untruncated headline"
    - 01-01-PLAN.md:320 Nyquist coverage row 15 marks UI-02/encoding "explicit — ... untruncated
                         ... so no length or equality definition applies"
    - 01-02-SUMMARY.md:82 records the negative grep for line-clamp/truncate/.slice(/substring(
                         as PASSING — i.e. the current behavior was verified as correct.
  implication: |
    This is a SPECIFICATION defect, not an implementation defect. ArticleCard.tsx faithfully
    implements what Phase 1 asked for. Any fix must first amend the UI-02 encoding-edge
    requirement, or it will read as a regression against a passed gate.

- timestamp: T9
  checked: .planning/phases/02-full-ingestion-failure-isolation/02-UI-SPEC.md edge-case matrix (lines 115-121)
  found: |
    Line 118 `overflow` row: scoped ONLY to combined LIST LENGTH ("scales to any length via
      natural page scroll") — i.e. number of cards, never per-card text height.
    Line 119 `long-text` row: scoped ONLY to the five new tier-BADGE labels ("new labels are the
      same or shorter length than the already-tested 'Security Research'").
    Neither row re-examines article title/summary long-text at 13-source scale.
  implication: |
    Root cause of the ESCAPE. Phase 2 did run a long-text edge analysis, but applied it to the
    one artifact it was changing (the badge) rather than to the field whose input distribution
    it was actually widening 13x (the summary). The gate existed and was pointed at the wrong
    field.

- timestamp: T10
  checked: Live fetch of the user's two exact reported articles
  found: |
    CSO Online — "Z.ai disables coding assistant feature after flaw exposed enterprise code
      upload risk" (85-char title) -> summary is 4,353 chars, ALL of it rendered.
    Bleeping Computer — "EvilTokens PhaaS disrupted after compromising 12,000 Microsoft
      accounts" (71-char title) -> summary is 189 chars and ends with the literal string
      " [...]" — BleepingComputer's OWN publisher-side truncation marker.
    CrowdStrike Blog — title 112 chars, summary "" (0 chars); also note the title contains an
      undecoded literal "&trade;" entity ("The Forrester Wave&trade;:").
  implication: |
    Confirms the mechanism precisely AND reframes the user's request. The Bleeping Computer card
    the user cited as the DESIRED look is only well-behaved because BleepingComputer truncates
    its own description server-side and appends "[...]". Havadis contributes nothing to that.
    The app has effectively outsourced its summary-length policy to 13 independent publishers'
    editorial choices — cards that currently look right do so by luck, not design.
    Incidental finding (separate cosmetic bug, NOT this root cause): the undecoded `&trade;` in
    the CrowdStrike title — rss-parser decodes HTML entities for contentSnippet via getSnippet
    but not for `item.title`.

## Resolution

root_cause: |
  A specification-level omission with two confirmed contributing conditions (AND-gated), which
  a Phase 2 config change revealed:

  (1) PRESENTATION — no length constraint exists on either text field.
      src/components/ArticleCard.tsx:31  <h2 className="mt-3 text-xl font-semibold leading-snug
        tracking-tight text-zinc-900 dark:text-zinc-50">   <- no line-clamp-*
      src/components/ArticleCard.tsx:42  <p className="mt-2 text-base leading-relaxed
        text-zinc-600 dark:text-zinc-400">                 <- no line-clamp-*
      Both render {article.title} / {article.summary} as whole, unbounded text nodes. This was
      DELIBERATE and specified: 01-02-PLAN.md:157 mandates "no ellipsis, no line clamp", and
      01-02-PLAN.md:184 made "contains no line-clamp, no truncate class" a passing verify gate.

  (2) DATA — the summary field is unbounded and publisher-controlled.
      src/lib/pipeline/normalize.ts:36  summary: (item.contentSnippet ?? item.content ?? "").trim()
      Only .trim() is applied. rss-parser's contentSnippet is NOT a short excerpt despite the
      name: node_modules/rss-parser/lib/utils.js:11-12 defines
        getSnippet = (str) => entities.decodeHTML(stripHtml(str)).trim()
      — HTML stripping with NO length cap. So `summary` is whatever the publisher chose to put
      in <description>/<content:encoded>. Measured live: median summary ranges from 80 chars
      (Ars Technica) to 7,541 chars (CSO Online), a ~94x spread, with a 26,744-char maximum
      (CISA) and a 0-char case (CrowdStrike, which renders an empty <p> and 8px of dead margin).

  AND-gate: both conditions are required. A clamp at either layer alone would have contained the
  defect; neither is independently sufficient.

  TRIGGER (not a cause): Phase 2 grew src/lib/config/sources.ts from 1 to 13 sources. Phase 1's
  sole source (Krebs) has a tight native distribution (title median 49, summary median 476), so
  every card looked identically treated and the missing clamp was invisible.

  WHY IT ESCAPED PHASE 2: .planning/phases/02-full-ingestion-failure-isolation/02-UI-SPEC.md's
  edge matrix did run a long-text analysis, but line 119 scoped it to the five new tier-BADGE
  labels and line 118 scoped `overflow` to list LENGTH (card count) only. The one field whose
  input distribution Phase 2 actually widened 13x — the article summary — was never re-examined.

fix: "[not applied — goal: find_root_cause_only]"
verification: "[not applied — goal: find_root_cause_only]"
files_changed: []

## Fix Applied (recorded 2026-10-01)

Both AND-gated conditions were fixed in Phase 2 (decision D-08, which amended the Phase 1 "no line clamp" spec the diagnosis flagged):
- Presentation: `ArticleCard.tsx` clamps title (`h3`) and summary (`p`) to three lines with `line-clamp-3`, and omits the summary paragraph entirely when empty (commit `ba62a49`, fix(02-04)).
- Data: `src/lib/pipeline/truncateSummary.ts` caps `summary` at `SUMMARY_MAX_CHARS = 400` code points.
Phase 4 later added `break-words` on the title and verified card text containment at six widths. This session sat in `diagnosed` only because nobody recorded the fix.
