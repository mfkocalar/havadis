---
status: testing
phase: 01-single-source-pipeline-vertical-slice
source: [01-VERIFICATION.md]
started: 2026-09-20T13:17:51Z
updated: 2026-09-20T13:17:51Z
---

## Current Test

number: 1
name: Deployed-preview cache window check
expected: |
  Deploy to a Vercel preview, load `/`, reload within ~15 minutes, and inspect
  `x-vercel-cache`; then wait past ~900s and reload again; then fire two
  near-simultaneous requests against a just-expired entry. Within the window:
  cache hit / byte-identical snapshot, no new origin request. After the window
  elapses: a stale-then-background-revalidate transition, with exactly one
  background revalidation firing even under concurrent requests.
awaiting: user response

## Tests

### 1. Deployed-preview cache window check
expected: Within the window: `x-vercel-cache: HIT` (or equivalent) and no new
  origin request to krebsonsecurity.com; once the window elapses, the next
  visit serves the stale snapshot immediately (`STALE`) while a background
  revalidation occurs, and only one background fetch fires even under
  near-simultaneous requests.
result: [pending]

### 2. Real browser click-through
expected: A real browser visit to the deployed page confirms rendering,
  working outbound links (open the source's own article in a new tab), and no
  authentication surface appears anywhere in the flow.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps

None — both items are pre-existing, plan-declared `backstop` deployment checks
(WINDOWS.md #2 and #3), carried forward unchanged by this verification round.
Nothing in 01-04's gap-closure work or the out-of-plan content-type fix
touched the caching layer or the rendering path these checks cover.
