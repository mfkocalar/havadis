---
phase: 01-single-source-pipeline-vertical-slice
verified: 2026-09-19T14:30:00Z
status: gaps_found
score: 4/5 roadmap success criteria verified (1 failed, 1 additionally needs human/deployed confirmation)
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/phases/01-single-source-pipeline-vertical-slice/01-01-PLAN.md"
  - ".planning/phases/01-single-source-pipeline-vertical-slice/01-01-SUMMARY.md"
  - ".planning/phases/01-single-source-pipeline-vertical-slice/01-02-PLAN.md"
  - ".planning/phases/01-single-source-pipeline-vertical-slice/01-02-SUMMARY.md"
  - ".planning/phases/01-single-source-pipeline-vertical-slice/01-03-PLAN.md"
  - ".planning/phases/01-single-source-pipeline-vertical-slice/01-03-SUMMARY.md"
  - ".planning/phases/01-single-source-pipeline-vertical-slice/01-REVIEW.md"
  - "src/app/layout.tsx"
  - "src/app/page.tsx"
  - "src/components/ArticleCard.tsx"
  - "src/components/SourceTierBadge.tsx"
  - "src/lib/config/sources.ts"
  - "src/lib/formatRelativeTime.test.ts"
  - "src/lib/formatRelativeTime.ts"
  - "src/lib/pipeline/fetchSource.ts"
  - "src/lib/pipeline/fetchWithValidatedRedirect.test.ts"
  - "src/lib/pipeline/fetchWithValidatedRedirect.ts"
  - "src/lib/pipeline/filterLookback.test.ts"
  - "src/lib/pipeline/filterLookback.ts"
  - "src/lib/pipeline/frontpage.e2e.test.ts"
  - "src/lib/pipeline/getFrontPage.ts"
  - "src/lib/pipeline/normalize.test.ts"
  - "src/lib/pipeline/normalize.ts"
  - "src/lib/types.ts"
  - "test/fixtures/hostileRedirectServer.ts"
  - "test/productionPage.test.ts"
covered_digest: "v1:sha256:559c368ebd8c60e06c1f576d37eea3913585f91667e66ff081380d1ddb3253c9"
behavior_unverified: 1
overrides_applied: 0
gaps:
  - truth: "Success Criterion 5: A deliberately slow or redirecting test fetch is aborted by the per-source timeout (~8s) ... it never hangs the page"
    status: failed
    reason: >
      CR-01 from 01-REVIEW.md is real and unmitigated. The per-hop AbortController/timer in
      fetchWithValidatedRedirect.ts is created before fetch() and cleared in a `finally` block
      that runs as soon as fetch() resolves — i.e. as soon as response HEADERS arrive, per
      undici/Node fetch semantics. fetchSource.ts's readBodyWithCap() then reads the body in a
      loop with no AbortSignal and no time budget at all — only a 2MB size cap. An origin that
      sends headers immediately and then drips the body slowly (staying under 2MB) is never
      aborted by the advertised "~8s per-source timeout"; it is bounded only by Vercel's
      platform-level function timeout, which is far larger. This directly falsifies "never
      hangs the page" for exactly the case the criterion names ("slow ... test fetch").
      Independently reproduced (not just code-read) with a local node:http fixture that writes
      headers immediately and drips one byte/second: fetchSource() was still unresolved at
      t=12,000ms (>4s past the advertised 8s budget), with no sign of terminating.
    artifacts:
      - path: "src/lib/pipeline/fetchWithValidatedRedirect.ts"
        issue: "Lines 26-67: `finally { clearTimeout(timer) }` disarms the guard as soon as `fetch()` resolves (on response headers), before `fetchSource` ever reads the body. The returned `Response` carries no live abort signal for the caller to reuse."
      - path: "src/lib/pipeline/fetchSource.ts"
        issue: "readBodyWithCap() (lines 25-48) loops `reader.read()` with no `AbortSignal` parameter and no time budget — only `total > maxBytes` bounds it, which a slow, deliberately-throttled drip can stay under indefinitely."
      - path: "src/lib/pipeline/fetchWithValidatedRedirect.test.ts"
        issue: "The suite's only timeout test (`aborts a hanging origin...`) exercises a `/hang` endpoint that never writes anything at all (headers never arrive) — the one case the current code already handles correctly. No test exercises headers-then-slow-body, which is the actual unmitigated branch."
    missing:
      - "A body-read-phase timeout (or a single AbortController whose timer is only cleared after the body is fully read / re-armed per chunk) so the *whole* hop — connect + headers + body — is bounded by ~8s, not just the connect/header portion."
      - "A fixture route (e.g. in test/fixtures/hostileRedirectServer.ts) that sends headers immediately and then drips bytes slowly, plus a test asserting fetchSource still resolves to the error variant within a bounded time."
human_verification:
  - test: "Deploy a preview build to Vercel, load the front page, wait <15 minutes, reload, and inspect the `x-vercel-cache` response header; then wait past the ~900s revalidation window and reload again."
    expected: "Within the window: `x-vercel-cache: HIT` (or equivalent) and no new origin request to krebsonsecurity.com; once the window elapses, the next visit serves the stale snapshot immediately (`STALE`) while a background revalidation occurs, and only one background fetch fires even under near-simultaneous requests."
    why_human: "This is the actual proof of Success Criterion 4 (identical cached snapshot within ~15 min, background refetch after). It is explicitly declared `verification: backstop` in 01-01-PLAN.md and 01-03-PLAN.md's must_haves because Next.js's Data Cache does not exist under `next dev`, and no deployed Vercel edge/CDN is available in this local/CI environment to observe real `x-vercel-cache` transitions or single-flight revalidation behavior. `test/productionPage.test.ts`'s byte-identical-double-request check is a necessary but explicitly insufficient proxy (the plan says so itself) — it only rules out a gross regression, not the actual 900s stale-while-revalidate contract."
---

# Phase 01: Single-Source Pipeline (Vertical Slice) Verification Report

**Phase Goal:** A single real source flows through the entire architecture — fetch, normalize, cache/revalidate, render — proving the pipeline shape end to end on a publicly accessible, unauthenticated page.
**Verified:** 2026-09-19
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Visiting the public site (no login) shows real, current articles from one live source as newspaper-style cards | ✓ VERIFIED | `src/app/page.tsx` awaits `getFrontPage()` and maps articles into `ArticleCard`; `src/lib/pipeline/frontpage.e2e.test.ts` drives the real Krebs feed and asserts `status: "ok"` with ≥1 article; independently confirmed `https://krebsonsecurity.com/feed/` is reachable (`curl` → 200) from this environment |
| 2 | Each card shows source name, tier badge, verbatim title, summary, relative time w/ absolute on hover, working link to the source's own URL | ✓ VERIFIED | `src/components/ArticleCard.tsx` renders `article.source`, `<SourceTierBadge tier=.../>`, `article.title` and `article.summary` as plain JSX text (no `dangerouslySetInnerHTML` anywhere in the codebase — confirmed by grep), `<time dateTime=... title={absoluteTime}>{formatRelativeTime(...)}</time>`, and `<a href={article.url} target="_blank" rel="noopener noreferrer">`. `formatRelativeTime.test.ts` (14 tests) and `normalize.test.ts` (verbatim-title test) pass |
| 3 | Only articles published within the last 24 hours appear | ✓ VERIFIED | `src/lib/pipeline/filterLookback.ts` samples `Date.now()` once and filters on a single cutoff; `filterLookback.test.ts` (11 tests, including the 23h/25h boundary and the single-sampled-cutoff property) — all pass (ran directly: 28/28 across normalize+filterLookback+formatRelativeTime) |
| 4 | Revisiting within ~15 min serves the identical cached snapshot; after the window elapses, next visit triggers a background refetch | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `fetchSource.ts` passes `next: { revalidate: 900 }` with no companion `cache` option; `next.config.ts` does not opt into Cache Components. `test/productionPage.test.ts`'s "two consecutive requests return byte-identical HTML" test is a necessary-but-not-sufficient proxy (the plan's own must_haves say so — this exact truth is tagged `verification: backstop` in both 01-01-PLAN.md and 01-03-PLAN.md). No deployed Vercel preview is available in this verification environment to observe the real `x-vercel-cache` HIT/STALE transition or confirm single-flight revalidation. Routed to human verification below |
| 5 | A deliberately slow or redirecting test fetch is aborted by the per-source timeout (~8s); redirect target validated (HTTPS, same host) before being followed; never hangs the page or blindly follows an arbitrary host | ✗ FAILED | Redirect validation itself is correct and proven (`fetchWithValidatedRedirect.test.ts`, 10/10 passing, ran directly). But CR-01 from `01-REVIEW.md` is real: the per-hop timer is cleared as soon as `fetch()` resolves (response **headers** received), and `fetchSource.ts`'s body-read loop has no timeout of its own — only a 2MB size cap. Independently reproduced with a local slow-drip HTTP server: `fetchSource()` was still pending at t=12,000ms against an origin that sends headers instantly and then drips 1 byte/sec. This is exactly the "slow ... test fetch" the criterion names, and it is **not** aborted by the advertised ~8s timeout — see Gaps below |

**Score:** 3/5 roadmap success criteria fully verified; 1 failed (blocker); 1 needs human/deployed confirmation (present, correctly configured, but not behaviorally provable in this environment)

### PLAN-Level Must-Haves (01-01, 01-02, 01-03)

| Must-have | Status | Evidence |
|---|---|---|
| `fetchWithValidatedRedirect` uses `redirect: "manual"`, validates before following | ✓ VERIFIED | Code line 35 (`redirect: "manual"`); loop validates protocol + exact-host before `currentUrl = target` |
| Cross-host / non-HTTPS / suffix-lookalike / prefix-lookalike redirects rejected; exact-host equality only | ✓ VERIFIED | 10/10 tests in `fetchWithValidatedRedirect.test.ts` pass (ran directly), each asserting the specific rejection cause, not just "it failed" |
| 5-hop chain succeeds, 6th hop rejected | ✓ VERIFIED | Same test file, "follows a chain of exactly 5..." and "rejects a 6th redirect hop" both pass |
| 3xx with no/empty `Location` rejected | ✓ VERIFIED | "rejects a 3xx response carrying no Location header" passes |
| No module-scope mutable state; timer cleared in `finally` on every exit path | ✓ VERIFIED (partially moot — see gap) | Confirmed by code read: `currentUrl`, `originalHost`, `controller`, `timer` are all function-local; `finally { clearTimeout(timer) }` does run on every path. The gap is that this guarantee only covers the header-arrival phase, not the body-read phase that follows (CR-01) |
| `filterLookback` samples current time once per call | ✓ VERIFIED | `mock.fn` spy test asserts `Date.now` called exactly once; passes |
| Duplicate title+link items both normalize and survive (no Phase-1 dedup) | ✓ VERIFIED | `normalize.test.ts` "two items with identical title and link both normalize successfully" passes |
| Missing title/link/isoDate → null; empty feed → []; missing description → `""` | ✓ VERIFIED | Corresponding tests pass |
| `normalize` preserves feed order (no sort) | ✓ VERIFIED | Order-preservation test passes; `getFrontPage.ts`/`page.tsx` never sort |
| Non-http(s) link scheme dropped | ✓ VERIFIED | `javascript:` scheme test passes |
| `fetchSource`/`getFrontPage` never throw | ✓ VERIFIED | Both wrapped in try/catch returning `{status:"error", reason}`; independently confirmed via the slow-drip probe — even while pending indefinitely, no unhandled rejection occurred |
| `next: { revalidate: 900 }`, no `cache` option, no Cache Components opt-in, no `rss-parser` `parseURL()` | ✓ VERIFIED | `fetchSource.ts` line 59; `next.config.ts` has no `cacheComponents` flag; `parser.parseString(xmlText)` used, never `parseURL` |
| User-Agent prohibition (must name Havadis + contact URL, not impersonate a specific browser) | PASSED (judgment) | `USER_AGENT` constant carries browser-compatible tokens plus `HavadisBot/0.1; +https://havadis.app/about ... automated cybersecurity news aggregator` |
| All six UI-02 fields rendered; hover reveals absolute time; tier badge is a colored pill with a distinct Security Research color | ✓ VERIFIED | `ArticleCard.tsx` + `SourceTierBadge.tsx` code read; `TIER_STYLES["Security Research"]` uses a distinct indigo palette vs. the shared slate default |
| Duplicate-timestamp articles render as separate cards; card order matches `getFrontPage()` with no client re-sort | ✓ VERIFIED | `page.tsx` keys by `article.url` (not timestamp) and does a plain `.map()` with no sort/grouping |
| Empty/error variant renders full layout + quiet one-line message, never blank | ✓ VERIFIED | `page.tsx` branches on `articles.length === 0` and always renders the `<main>`/`<h1>` shell |
| Verbatim text as literal characters; zero client JS; `rel="noopener noreferrer"` on every outbound link | ✓ VERIFIED | Grep confirms no `dangerouslySetInnerHTML` and no `"use client"` anywhere under `src/`; `ArticleCard.tsx` link carries `rel="noopener noreferrer"` |
| Empty-state prohibition (must not assert "nothing happened") | PASSED (judgment) | Copy is "No articles in the last 24 hours." — describes app state, not the world |
| No redirector/click-tracker on outbound links | PASSED (judgment) | `href={article.url}` is the raw normalized source URL, no wrapper |
| Hermetic fixture binds only to 127.0.0.1:0, closed in teardown; never imported from `src/app`/`src/components`/`src/lib` | ✓ VERIFIED | `hostileRedirectServer.ts` binds `127.0.0.1`/port `0`; `grep -rl` for fixture imports under `src/` returns nothing |
| Production build: `GET /` returns 200, no `set-cookie`/`www-authenticate` | ✓ VERIFIED (by code/test read) | `test/productionPage.test.ts` asserts this; not independently re-run in this pass (requires a production build + spawned server — the assertions and spawn logic were read and are sound; no reason found to doubt them given every other test suite in this phase ran and passed) |
| Backstop truths (900s window, single-flight revalidation, x-vercel-cache transition) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Declared `verification: backstop` in the plans themselves — correctly deferred to a deployed-preview human check, not a code-inspection failure |

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/lib/pipeline/fetchWithValidatedRedirect.ts` | manual-redirect fetch, per-hop 8s timeout, HTTPS+same-host validation | ⚠️ PARTIAL | Exists, substantive, wired, and correctly validates redirects — but the "per-hop 8s timeout" only covers the header-arrival phase (CR-01) |
| `src/lib/pipeline/fetchSource.ts` | never-throwing fetch+parse | ⚠️ PARTIAL | Never throws (verified), but its body-read phase carries no time bound at all, undermining the "per-source timeout" contract this file's own doc comment claims |
| `src/lib/pipeline/normalize.ts` | RSS/Atom → Article normalization | ✓ VERIFIED | All edge tests pass |
| `src/lib/pipeline/filterLookback.ts` | 24h lookback filter | ✓ VERIFIED | All edge tests pass |
| `src/lib/pipeline/getFrontPage.ts` | orchestrator | ✓ VERIFIED | Composes fetchSource → normalize → filterLookback; never throws |
| `src/app/page.tsx` | public route | ✓ VERIFIED | Server Component, awaits `getFrontPage()`, no auth |
| `src/components/ArticleCard.tsx`, `SourceTierBadge.tsx` | UI-02 card + tier pill | ✓ VERIFIED | All six fields present, no client JS |
| `test/fixtures/hostileRedirectServer.ts`, `*.test.ts` files | negative-path + production-build proof | ✓ VERIFIED (existence/substance) — ⚠️ but the redirect-guard test suite misses exactly the CR-01 branch | See gap above |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| INGEST-03 | 01-01, 01-03 | Per-source ~8s timeout + redirect validation | ✗ BLOCKED | Redirect validation is solid; the timeout half of this requirement is not actually enforced for a slow-body origin (CR-01). REQUIREMENTS.md currently marks this `[x] Complete` — that checkbox is not accurate given the confirmed gap |
| INGEST-04 | 01-01, 01-03 | 24h lookback | ✓ SATISFIED | `filterLookback.ts` + tests |
| INGEST-05 | 01-01, 01-03 | `next.revalidate`-based caching | ✓ SATISFIED (config) / ⚠️ human needed (runtime behavior) | Fetch config correct; runtime cache-window behavior needs a deployed preview per the plan's own `backstop` designation |
| NORM-01 | 01-01, 01-03 | Common Article shape from RSS/Atom | ✓ SATISFIED | `normalize.ts` + tests |
| UI-02 | 01-02 | Article card fields | ✓ SATISFIED | `ArticleCard.tsx`; note REQUIREMENTS.md's checklist and traceability table both still show UI-02 as `Pending`/unchecked even though the implementation is complete — a documentation-sync gap, not a functional one (see Anti-Patterns) |
| UI-06 | 01-01, 01-02, 01-03 | No auth anywhere | ✓ SATISFIED | No middleware/auth files exist; `productionPage.test.ts` asserts no `set-cookie`/`www-authenticate` |

No orphaned requirements: all six IDs assigned to Phase 1 in ROADMAP.md (`INGEST-03, INGEST-04, INGEST-05, NORM-01, UI-02, UI-06`) appear in at least one plan's `requirements:` frontmatter.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Pure-transform unit tests (normalize, filterLookback, formatRelativeTime) | `node --test src/lib/pipeline/normalize.test.ts src/lib/pipeline/filterLookback.test.ts src/lib/formatRelativeTime.test.ts` | 28/28 pass | ✓ PASS |
| Redirect guard reject/follow/timeout-of-headers suite | `node --test src/lib/pipeline/fetchWithValidatedRedirect.test.ts` | 10/10 pass (includes the two ~8s real-timeout tests) | ✓ PASS (but see gap: this suite does not cover the slow-body-drip branch) |
| Live Krebs feed reachable | `curl -s -o /dev/null -w "%{http_code}" https://krebsonsecurity.com/feed/` | `200` | ✓ PASS |
| **Independent slow-body-drip probe (verifier-authored, not part of repo)** | Local `node:http` server writes headers immediately then drips 1 byte/sec; calls `fetchSource()` against it with a 12s watchdog | `fetchSource()` still pending at t=12,000ms — never aborted | ✗ **FAIL — confirms CR-01 / Success Criterion 5 gap** |
| Production-build HTTP contract (`test/productionPage.test.ts`) | Not re-run in this pass (would require a full `next build` + spawned server) | — | ? SKIP (code/assertions read and judged sound; no other test in this phase failed) |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `src/lib/pipeline/fetchWithValidatedRedirect.ts` / `fetchSource.ts` | 26-67 / 25-48 | Timeout guard disarmed before the phase it's meant to bound completes | 🛑 Blocker | Directly falsifies Success Criterion 5's "never hangs the page" claim — see Gaps |
| `.planning/REQUIREMENTS.md` | 30, 96 | UI-02 checkbox/traceability still `[ ]`/`Pending` despite complete, tested implementation | ℹ️ Info | Documentation-sync gap only; does not affect the functional verdict, but should be corrected so REQUIREMENTS.md stays trustworthy for the next phase's planner |
| `01-03-SUMMARY.md` | key-decisions | Claims "WINDOWS.md entry #1 (per-hop timeout path untested)... marked ... as fixed" | ⚠️ Warning | Overclaim: the added tests prove only the "headers never arrive" branch, not the "headers arrive, body stalls" branch CR-01 identifies as the actual live risk. The underlying code gap remains unfixed |
| (no `TBD`/`FIXME`/`XXX` found anywhere under `src/` or `test/`) | — | — | — | Debt-marker gate: clean |

No `dangerouslySetInnerHTML`, no `"use client"` directives, no auth/middleware files found anywhere in the codebase — the stated security/no-auth/no-client-JS properties hold cleanly.

### Human Verification Required

1. **Deployed-preview cache window check**
   **Test:** Deploy to a Vercel preview, load `/`, reload within ~15 minutes, inspect `x-vercel-cache`; then wait past ~900s and reload again; also fire two near-simultaneous requests against a just-expired entry.
   **Expected:** Cache hit / identical snapshot inside the window with no new origin request; stale-then-background-revalidate transition once the window elapses; only one background revalidation fires under concurrent requests.
   **Why human:** Declared `verification: backstop` in both 01-01-PLAN.md and 01-03-PLAN.md's own must_haves — Next.js's Data Cache does not exist under `next dev`, and no deployed Vercel edge is reachable from this verification environment to observe real cache-header transitions.

### Gaps Summary

Success Criterion 5 fails. The redirect-target validation half of the criterion (HTTPS-only, exact-same-host, reject-before-follow) is solid and is proven by a real, passing 10-test hermetic-fixture suite. But the "aborted by the per-source timeout (~8s) ... never hangs the page" half is not actually true for the case the criterion itself names as an example ("a deliberately slow ... test fetch"): the `AbortController` guarding each hop is disarmed the moment response headers arrive, and the subsequent unbounded body-read loop (bounded only by a 2MB size cap, with no time budget) is not covered by any timeout at all. This is not a hypothetical — it was independently reproduced with a local slow-drip HTTP fixture in this verification pass: `fetchSource()` was still unresolved at 12 seconds against an origin dripping the body at 1 byte/second, 4+ seconds past the advertised ~8s budget, with no indication it would ever terminate short of the 2MB cap or Vercel's much larger platform-level function timeout. This exactly matches Critical finding CR-01 in `01-REVIEW.md`, and nothing in the codebase has changed to address it since that review was written (confirmed via `git log` — the affected files have not been touched since the original 01-01 commit).

Everything else in Phase 1's success criteria is either fully verified (criteria 1-3, and the redirect-validation half of criterion 5) or correctly deferred to a human/deployed check because the plans themselves declared it a `backstop` truth unverifiable outside a real Vercel deployment (criterion 4).

Fix direction (per 01-REVIEW.md's own suggested fix, independently endorsed here): give the body-read phase its own bounded lifetime — either reuse a single AbortController/timer across the whole hop (connect + headers + body, clearing only after the body is fully drained) or thread an `AbortSignal` into `readBodyWithCap` with a stall-aware re-arm — and add a fixture route that sends headers immediately and then drips bytes, with a test asserting `fetchSource` still resolves to the error variant within a bounded time.

---

_Verified: 2026-09-19_
_Verifier: Claude (gsd-verifier)_
