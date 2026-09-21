---
status: complete
phase: 01-single-source-pipeline-vertical-slice
source: [01-VERIFICATION.md]
started: 2026-09-20T13:17:51Z
updated: 2026-09-21T11:52:55Z
---

## Current Test

[testing complete]

## Tests

### 1. Deployed-preview cache window check
expected: Within the window: `x-vercel-cache: HIT` (or equivalent) and no new
  origin request to krebsonsecurity.com; once the window elapses, the next
  visit serves the stale snapshot immediately (`STALE`) while a background
  revalidation occurs, and only one background fetch fires even under
  near-simultaneous requests.
result: pass

### 2. Real browser click-through
expected: A real browser visit to the deployed page confirms rendering,
  working outbound links (open the source's own article in a new tab), and no
  authentication surface appears anywhere in the flow.
result: pass
note: "User initially observed no articles/no source shown. Confirmed not a
  defect: Krebs on Security's live feed had no article published within the
  last 24 hours at test time (most recent was Sep 16, five days before the
  Sep 21 test) — the page correctly rendered the masthead and the quiet empty
  state (01-02 D-03) with no authentication surface anywhere. The
  outbound-link-click portion of this test is inherently unexercisable while
  the single live source has nothing within the lookback window; re-run when
  Krebs has posted something in the last 24h to exercise that specific path."

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

None — both items are pre-existing, plan-declared `backstop` deployment checks
(WINDOWS.md #2 and #3), carried forward unchanged by this verification round.
Nothing in 01-04's gap-closure work or the out-of-plan content-type fix
touched the caching layer or the rendering path these checks cover.
