---
status: complete
phase: 02-full-ingestion-failure-isolation
source: [02-01-SUMMARY.md, 02-02-SUMMARY.md, 02-03-SUMMARY.md, 02-04-SUMMARY.md]
started: 2026-09-22T15:29:34Z
updated: 2026-09-23T12:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Two Sources, One Recency-Ordered List
expected: Two sources (Krebs, CISA) are fetched concurrently and merged into one newest-first list by getFrontPage(), proven end-to-end against both live feeds.
result: pass
source: automated
coverage_id: D1

### 2. Broken Source Doesn't Take Down the Page
expected: |
  On the running dev server, if one configured source is broken (dead endpoint, timeout,
  malformed XML, or an HTTP error), the front page still renders normally with the other
  sources' articles — no error banner, no error message, no visible difference from a normal
  page load.
result: pass

### 3. Stable Sort on Tied Timestamps
expected: sortByRecencyDesc is pure, stable on ties, and preserves source-iteration order for equal-publishedAt articles across repeated calls, proven by 5 hermetic unit tests.
result: pass
source: automated
coverage_id: D3

### 4. Six Distinct Tier Badge Colors
expected: |
  On the running dev server's front page, each of the six source tiers (Government, Security
  Research, Enterprise Security, Threat Intelligence, Tech & General, Executive News) renders
  its own distinct badge color pill — all pills the same size/shape/font weight, only the hue
  differs. The Security Research badge is the same indigo it has always been. No badge reads
  red or orange.
result: pass

### 5. Plan 02-02 Auto-Verified Deliverables — Confirm (re-verify after gap closure)
expected: |
  Automated tests already confirm: all 13 sources are configured across all six tiers; every
  source URL is HTTPS with a public, non-private, non-loopback hostname; HTML content-type
  acceptance is scoped per-source (zero sources currently opt in); the body-size cap is
  enforced on every code path in fetchSource. Additionally, gap G-02-5's fix (plan 02-04) is
  in place: article card titles and summaries are bounded to three lines via CSS line-clamp,
  the summary is capped at 400 code points at the data layer, and a source with no summary
  (CrowdStrike) renders no summary paragraph at all — no card should show a much longer
  untruncated title/summary than its neighbors anymore. Reply to confirm these hold true on
  the running app, or describe anything that still looks off.
result: pass
note: "Previously reported as issue (G-02-5); fix plan 02-04 has executed with a matching SUMMARY. Re-verifying before final pass."

### 6. Plan 02-03 Auto-Verified Deliverables — Confirm
expected: |
  Automated tests already confirm, against real sockets: a broken source (HTTP error,
  malformed XML, refused connection, or a fully stalled/timed-out source) never blocks the
  other sources' articles from rendering; a thrown rejection and a returned error are handled
  identically; returned articles carry no failure/health metadata; the Phase 1 empty-state
  copy is preserved when everything fails; sources fetch concurrently (not sequentially) and a
  stalled source's timeout budget is not added to the others'. Reply to confirm, or describe
  anything that looks off.
result: pass

### 7. Card Visual Check After Text-Length Fix (VERIFICATION.md human item)
expected: |
  Comparing CISA / CSO Online / SANS ISC cards against Bleeping Computer / Ars Technica at
  desktop and ~375px mobile width: a clamped summary shows a visible trailing ellipsis; no
  card's title/summary block is dramatically taller than its neighbours' on mobile; a
  tabbed-to headline's focus ring is not clipped by the line-clamp's overflow:hidden.
result: pass

## Summary

total: 7
passed: 7
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

- gap_id: G-02-5
  truth: "Article cards render consistently across all 13 sources — titles and summaries display with the same truncation/length treatment card to card, no card overflowing with a much longer untruncated title or summary than its neighbors."
  status: resolved
  resolved_by: 02-04-PLAN.md
  resolved_at: 2026-09-23
  reason: "User reported: for example CSO Online / Executive News / Z.ai disables coding assistant feature after flaw exposed enterprise code upload risk; is too long text shown. should not be like \"Bleeping Computer / Threat Intelligence / EvilTokens PhaaS disrupted after compromising 12,000 Microsoft accounts / The EvilTokens platform that compromised more than 12,000 Microsoft accounts at over 10,000 organizations has been disrupted in an effort led by Microsoft's Digital Crimes Unit (DCU). [...]\" — with 13 sources now live and varied title/summary lengths across origins, some cards show untruncated long text while others show short/truncated text, breaking visual consistency across the card list."
  severity: cosmetic
  test: 5
  root_cause: "No length normalization exists at any layer, by original Phase 1 design. (1) ArticleCard.tsx renders title (L31) and summary (L42) with no line-clamp/truncate/max-h/overflow classes — a repo-wide grep confirms zero truncation utilities anywhere in src/. (2) normalize.ts L36 applies only `.trim()` to `item.contentSnippet ?? item.content` — rss-parser's `getSnippet()` (node_modules/rss-parser/lib/utils.js:11-12) strips HTML and decodes entities but imposes NO length limit; it returns the publisher's entire description/content:encoded body verbatim. Live measurement across all 13 feeds: summary length ranges 0 (CrowdStrike, empty <p>) to 26,744 chars (CISA), median 80 (Ars Technica) to 7,541 (CSO Online) — a ~94x spread; title spread is only ~3.1x, confirming summary length (not title) is the dominant axis. The user's own 'good' example (Bleeping Computer, 189 chars ending '[...]') is well-behaved by luck of that publisher's own truncation marker, not by any Havadis-side policy. Phase 1's single source (Krebs, summary median 476) had a narrow enough range that the missing clamp was invisible; Phase 2 widened sources.ts 1->13 (unrelated to ArticleCard, which Phase 2 deliberately left untouched) and exposed the full spread of 13 publishers' differing editorial lengths. CRITICAL: this is a SPEC defect, not an implementation bug — 01-02-PLAN.md:157 explicitly mandated 'the title, verbatim and untruncated — no ellipsis, no line clamp, no rewriting', with a verify gate (01-02-PLAN.md:184) asserting NO line-clamp/truncate/slice/substring exists, which 01-02-SUMMARY.md:82 records as passing. That UI-02 requirement must be amended, not silently overridden, or the fix reads as a regression against an already-passed gate. 02-UI-SPEC.md's own long-text edge analysis only scoped overflow to the 5 new tier-badge labels and list length, never re-examining the summary field despite Phase 2 widening its input distribution 13x. Incidental unrelated finding: CrowdStrike titles carry an undecoded literal `&trade;` entity — rss-parser decodes entities for contentSnippet via getSnippet but not for item.title — a separate cosmetic bug, not part of this root cause."
  artifacts:
    - path: "src/components/ArticleCard.tsx"
      issue: "No line-clamp/truncate/max-h/overflow constraint on title (L31) or summary (L42) — by original Phase 1 design/spec, not an oversight"
    - path: "src/lib/pipeline/normalize.ts"
      issue: "L36 applies only .trim() to contentSnippet/content with no character cap, so an unbounded publisher-controlled string (measured up to 26,744 chars) reaches the component and the RSC payload"
  missing:
    - "Decide and document the amended UI-02 requirement (Havadis is no longer a 1-source app; verbatim-untruncated no longer holds at 13-source scale) before touching code"
    - "Add a length cap in normalize.ts (payload-size fix, not just visual) and/or a CSS line-clamp in ArticleCard.tsx (visual-uniformity fix) — both address different failure modes and are not substitutes for each other"
    - "Decide behavior for the 0-length CrowdStrike case (conditionally omit the empty summary paragraph rather than render it)"
  debug_session: ".planning/debug/article-card-text-length-inconsistent.md"

## Notes

- Coverage-aware classification (per SUMMARY's structured `coverage:` block): 02-01 had 2
  auto-passed deliverables (D1, D3) and 2 requiring human judgment (D2, D4, presented as Tests
  2 and 4 above); 02-02 and 02-03 were `all_auto_covered: true` (no items required human
  judgment individually), so each is presented as one confirmation-summary checkpoint (Tests 5
  and 6) rather than zero checkpoints, per workflow policy.
- Commit-claim reconciliation: all three SUMMARY files use the legacy `actuals: commits: N`
  frontmatter shape (no top-level `commits:`/`plan_head_before:` fields), so this is reported
  as a WARNING, not a mismatch. Measured git state independently: `git log` shows 9 task
  commits across the three plans (6b27cd3, 9cdc361, e769aea, f6c93c1, 3233bbc, 3f5f263,
  97e5860, 0e887e9, 6cbd53b) plus the phase docs commits — consistent with each SUMMARY's
  claimed 3 commits.
- No cold-start smoke test injected — no modified/created file this phase matches the
  server/app/database/migration/startup pattern list.
