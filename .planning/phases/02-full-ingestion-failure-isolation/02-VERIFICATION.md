---
phase: 02-full-ingestion-failure-isolation
verified: 2026-09-22T15:21:58Z
status: passed
score: 11/11 must-haves verified
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/phases/02-full-ingestion-failure-isolation/02-01-PLAN.md
  - .planning/phases/02-full-ingestion-failure-isolation/02-01-SUMMARY.md
  - .planning/phases/02-full-ingestion-failure-isolation/02-02-PLAN.md
  - .planning/phases/02-full-ingestion-failure-isolation/02-02-SUMMARY.md
  - .planning/phases/02-full-ingestion-failure-isolation/02-03-PLAN.md
  - .planning/phases/02-full-ingestion-failure-isolation/02-03-SUMMARY.md
  - .planning/phases/02-full-ingestion-failure-isolation/02-REVIEW.md
  - src/components/SourceTierBadge.tsx
  - src/lib/config/sources.test.ts
  - src/lib/config/sources.ts
  - src/lib/pipeline/fanOut.test.ts
  - src/lib/pipeline/fanOut.ts
  - src/lib/pipeline/fanOutTiming.test.ts
  - src/lib/pipeline/fetchSource.ts
  - src/lib/pipeline/frontpage.e2e.test.ts
  - src/lib/pipeline/getFrontPage.ts
  - src/lib/pipeline/sortByRecencyDesc.test.ts
  - src/lib/pipeline/sortByRecencyDesc.ts
  - src/lib/types.ts
  - test/fixtures/hostileRedirectServer.ts
  - test/productionPage.test.ts
covered_digest: "v1:sha256:253e4a6528abb8033acd4ec6ffc7fa328d47b1dbd8c7f7ff508cb90a29e3616d"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 10/11
  gaps_closed:
    - "A failure in one source never prevents the page from rendering the rest, sustained across repeated 15-minute revalidation cycles for the life of the process (ROADMAP goal / INGEST-02) — CR-01's socket leak on all three fetchSource.ts early-return failure paths is fixed in commit 01e3c34."
  gaps_remaining: []
  regressions: []
coincidental_reliance_items: []
human_verification: []
---

# Phase 2: Full Ingestion & Failure Isolation Verification Report

**Phase Goal:** All 13 configured sources are fetched in parallel on every cache revalidation
cycle, and a failure in any one of them never prevents the page from rendering the rest.
**Verified:** 2026-09-22T15:21:58Z
**Status:** passed
**Re-verification:** Yes — after gap closure (commit 01e3c34)

## Goal Achievement

### CR-01 Fix Verification (the reason for this re-run)

Read the full current `src/lib/pipeline/fetchSource.ts` (not grep-only) and traced control flow
for all three paths 02-REVIEW.md's CR-01 named, confirming each `res.body?.cancel()` /
`reader.cancel()` call is on the live execution path, not dead code:

| Path | Location (current file) | Fix present | Reachability confirmed |
|------|--------------------------|--------------|------------------------|
| `!res.ok` (non-2xx status) | Lines 115-121: `if (!res.ok) { await res.body?.cancel().catch(() => {}); return {...}; }` | ✓ | Unconditional statement inside the `if` body, executed before every return on this branch — no early return or throw sits between entering the branch and the `cancel()` call. |
| Content-type rejection | Lines 137-143: `if (!lowerContentType... ) { await res.body?.cancel().catch(() => {}); return {...}; }` | ✓ | Same shape — only reached once `res.ok` is true (so `res.body` is the real, unconsumed stream) and only when the content-type gate rejects; nothing skips the `cancel()` line. |
| `readBodyWithCap` byte-cap-exceeded throw | Lines 74-78: inside the streaming `for` loop, `if (total > maxBytes) { const err = ...; await reader.cancel(err).catch(() => {}); throw err; }` | ✓ | `reader.cancel(err)` executes and is awaited (with a `.catch` swallow) strictly before `throw err` — the function cannot leave this branch without first cancelling the reader. |

Cross-checked against `git show 01e3c34 -- src/lib/pipeline/fetchSource.ts`: the diff adds exactly
these three lines and nothing else (`6 +++ ‑, 1 file changed`), matching 02-REVIEW.md CR-01's
suggested fix verbatim. No other file changed in that commit, so no other must-have's supporting
code was touched.

**Scope note on this truth's classification:** this is a cancellation/cleanup invariant, which
per verification methodology needs behavioral evidence, not just presence, when its correctness
depends on runtime scheduling/interleaving. Here it does not — all three call sites are
unconditional, single-threaded, synchronous-shaped statements with no intervening branch, await
race, or scheduler dependency between "failure detected" and "cancel() called": reading the
control flow is dispositive, not merely suggestive. No new automated regression test (e.g. an
open-socket/fd count assertion across repeated cycles) was added in commit 01e3c34, and none
previously existed — this is noted as an anti-pattern/advisory below (a future edit could
silently drop the `cancel()` call with nothing to catch it), but it does not block this fix from
being verified as correct today.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | All 13 sources are configured and fetched concurrently via `Promise.allSettled` (INGEST-01 / SC-1) | ✓ VERIFIED | `src/lib/config/sources.ts` has exactly 13 entries (re-counted); `fanOut.ts` unchanged, still `Promise.allSettled(sources.map(...))`; `fanOutTiming.test.ts` re-run: concurrency test measured 943-944ms for 3×900ms-delayed sources on 3 distinct origins |
| 2 | `getFrontPage()` fans out, filters, and sorts in one pipeline; still never throws | ✓ VERIFIED | `getFrontPage.ts` unchanged (not in commit 01e3c34's diff): body is `sortByRecencyDesc(filterLookback(await fanOut(SOURCES)))` inside the unchanged `try`/`catch` |
| 3 | A single deliberately-broken source (HTTP error, malformed XML, refused connection, dead 404, stalled origin) never prevents the rest from rendering, for one revalidation cycle (INGEST-02 / SC-2) | ✓ VERIFIED | `fanOut.test.ts` (7/7 pass, re-run against real sockets via `hostileRedirectServer.ts`) and `fanOutTiming.test.ts`'s stall-isolation tests (re-run, ~8001-8002ms, both pass) |
| 4 | A rejected settlement and a fulfilled `{status:"error"}` value are handled identically by `fanOut` | ✓ VERIFIED | `fanOut.test.ts` "rejected settlement" and "injected error variant" tests re-run, both pass |
| 5 | Equal-`publishedAt` articles keep source-iteration order, stable across repeated calls, and the sort does not mutate its input | ✓ VERIFIED | `sortByRecencyDesc.test.ts` (5/5, re-run) |
| 6 | All six `SourceTier` values render a distinct, equal-weight badge hue; Security Research indigo untouched; no red/orange anywhere | ✓ VERIFIED | `SourceTierBadge.tsx` unchanged; re-checked: no `red`/`orange` color token present (only a code comment stating they are "deliberately" excluded) |
| 7 | Per-source fetch failure is invisible — no count, indicator, or diagnostic text reaches the rendered page; a quiet source and a broken source are indistinguishable | ✓ VERIFIED | `src/app/page.tsx` re-read: still branches only on `result.status === "ok" ? result.articles : []`, never touches `reason`; `fanOut.test.ts` D-05 test re-run, passes |
| 8 | 0-of-13 succeeding renders Phase 1's verbatim empty-state copy (D-06); 1-of-13 succeeding renders normally with no minimum-article floor (D-07) | ✓ VERIFIED | `fanOut.test.ts` D-06/D-07 tests re-run, pass; `page.tsx` still contains exactly one occurrence of `No articles in the last 24 hours.` |
| 9 | All 13 configured URLs are canonical (200, no redirect, under the 2MB body cap), HTTPS, and resolve to public/non-private hostnames; all six tiers are reachable | ✓ VERIFIED | `sources.test.ts` (5/5 in this run's grouping, re-run) — url uniqueness, https-only, no IP-literal/loopback hostnames, all 6 tiers represented |
| 10 | The hermetic test fixture (`hostileRedirectServer.ts`) is reachable only from the test process | ✓ VERIFIED | Re-ran `grep -rn "hostileRedirectServer" src/` independently: zero matches — only `fanOut.test.ts`, `fanOutTiming.test.ts`, and `fetchWithValidatedRedirect.test.ts` import it |
| 11 | A failure in one source never prevents the page from rendering the rest, **sustained across repeated revalidation cycles for the life of the process** (the previously-open gap) | ✓ VERIFIED | All three `fetchSource.ts` early-return failure paths now call `res.body?.cancel()` / `reader.cancel()` before returning/throwing — confirmed reachable on the live execution path by reading the file (see table above), matching CR-01's exact suggested fix and `git show 01e3c34`'s diff. This closes the per-cycle socket leak; the fetch-and-discard-body pattern that previously left the connection pool leaking on every persistently-failing/oversized source is eliminated. |

**Score:** 11/11 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/pipeline/fanOut.ts` | `Promise.allSettled` fan-out with injectable fetcher | ✓ VERIFIED | Unchanged since prior verification; not touched by commit 01e3c34 |
| `src/lib/pipeline/sortByRecencyDesc.ts` | Pure, stable, newest-first sort | ✓ VERIFIED | Unchanged |
| `src/lib/pipeline/getFrontPage.ts` | Orchestrator, unchanged signature/never-throws | ✓ VERIFIED | Unchanged |
| `src/lib/config/sources.ts` | 13 sources, 6 tiers | ✓ VERIFIED | Unchanged, re-counted: 13 entries |
| `src/lib/config/sources.test.ts` | Hermetic config-integrity invariants | ✓ VERIFIED | 5/5 tests pass (re-run) |
| `src/components/SourceTierBadge.tsx` | 6-colour palette | ✓ VERIFIED | Unchanged |
| `src/lib/pipeline/frontpage.e2e.test.ts` | Source-agnostic live e2e | ✓ VERIFIED | Included in full-suite re-run (part of 73/73) |
| `test/fixtures/hostileRedirectServer.ts` | `/delayed-feed`, `/status-500`, `/malformed-xml`, `taggedRss` | ✓ VERIFIED | Unchanged; `fetchWithValidatedRedirect.test.ts` re-run, 8/8 pass |
| `src/lib/pipeline/fanOut.test.ts` | Failure-isolation proof over real sockets | ✓ VERIFIED | 7/7 tests pass (re-run) |
| `src/lib/pipeline/fanOutTiming.test.ts` | Concurrency + stall-isolation proof | ✓ VERIFIED | 3/3 tests pass (re-run) |
| `src/lib/pipeline/fetchSource.ts` | Never-throws contract, per-source content-type opt-in, capped body read, **and now: body/socket cancellation on every early-return failure path** | ✓ VERIFIED | All three CR-01 paths fixed and confirmed reachable (see table above); previously the sole ORPHANED-RISK artifact, now clean |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `getFrontPage()` | `fanOut(SOURCES)` | direct call inside the `try` body | ✓ WIRED | Unchanged |
| `fanOut()` | `fetchSource` (default) / injected fetcher | `Promise.allSettled(sources.map((source) => fetcher(source)))` | ✓ WIRED | Unchanged |
| `fanOut()` | `filterLookback()` → `sortByRecencyDesc()` | `getFrontPage.ts`'s single return expression | ✓ WIRED | Unchanged |
| `SourceConfig.tier` | `TIER_STYLES[tier]` | `SourceTierBadge` component | ✓ WIRED | Unchanged |
| `SourceConfig.allowHtmlContentType` | `fetchSource`'s content-type gate | `htmlOptIn` boolean read before the cancel-and-reject branch | ✓ WIRED | Confirmed; the new `cancel()` call sits inside this same branch and does not disturb the gate's logic |

### Behavioral Spot-Checks / Test Re-Execution

All test files were re-run independently in this re-verification session (not taken on SUMMARY.md's or the prior VERIFICATION.md's word):

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Hermetic failure isolation | `node --test src/lib/pipeline/fanOut.test.ts` | 7/7 pass | ✓ PASS |
| Config integrity | `node --test src/lib/config/sources.test.ts` | 5/5 pass | ✓ PASS |
| Sort purity/stability | `node --test src/lib/pipeline/sortByRecencyDesc.test.ts` | 5/5 pass | ✓ PASS |
| Concurrency + stall isolation | `node --test src/lib/pipeline/fanOutTiming.test.ts` | 3/3 pass (943ms concurrency, 8001ms stall) | ✓ PASS |
| Pre-existing redirect/timeout suite unaffected | `node --test src/lib/pipeline/fetchWithValidatedRedirect.test.ts` | 8/8 pass | ✓ PASS |
| Full regression suite | `npm test` | 73/73 pass | ✓ PASS |
| Production build | `npm run build` | exit 0, static page prerendered, TypeScript check clean | ✓ PASS |
| Lint | `npm run lint` | exit 0, no output | ✓ PASS |
| Fixture not shipped | `grep -rn "hostileRedirectServer" src/` | 0 matches | ✓ PASS |
| CR-01 fix presence/reachability | Manual read of `fetchSource.ts` + `git show 01e3c34` diff review | All 3 paths fixed, matches CR-01's suggested fix exactly, no dead code | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|--------------|------------|--------------|--------|----------|
| INGEST-01 | 02-01, 02-02, 02-03 | Fetches all 13 configured sources server-side, in parallel, on each cache revalidation cycle | ✓ SATISFIED | 13 sources configured; `Promise.allSettled` fan-out proven concurrent via wall-clock measurement (re-run) |
| INGEST-02 | 02-01, 02-03 | A failure in one source does not prevent the page from rendering with the remaining sources' articles | ✓ SATISFIED | Real-socket tests cover HTTP error, malformed XML, refused connection, stalled origin, thrown rejection, and error-variant value, all isolated correctly per cycle — and the previously-open sustained-operation gap (socket leak across repeated cycles, CR-01) is now closed |

No orphaned requirements. `REQUIREMENTS.md`'s checkboxes for INGEST-01/02 are still unchecked
`[ ]` and its traceability table still shows "Pending" for both — this is a documentation-
bookkeeping item (typically updated during milestone completion, not phase execution), not a
functional gap, and does not affect this phase's `passed` status.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/lib/pipeline/fetchSource.ts` | 113-139 (formerly CR-01) | — RESOLVED — | — | Was 🛑 Blocker in the prior verification pass; commit 01e3c34 closed it. No longer present. |
| `src/lib/pipeline/fanOut.ts:29` | 29 | Isolation guarantee assumes `fetcher` never throws *synchronously* (WR-01, unchanged) | ⚠️ Warning | Untested edge case; today's only `fetcher` (`fetchSource`) is `async` so it cannot trigger this — unaffected by this fix |
| `src/lib/pipeline/frontpage.e2e.test.ts:47-51` | 47-51 | Asserts an https-only invariant `normalize.ts` does not enforce (WR-02, unchanged) | ⚠️ Warning | Live e2e test could flake if a real feed publishes a plain `http://` link; did not fail this session |
| `src/lib/pipeline/fetchSource.ts:31,161` | 31, 161 | Shared mutable module-level `rss-parser` `Parser` instance reused across concurrent parses (WR-03, unchanged) | ⚠️ Warning | Safe today only via an undocumented third-party synchronicity assumption; not touched by commit 01e3c34 |
| `src/lib/pipeline/fanOutTiming.test.ts:37-63` | 37-63 | Thin margin on the concurrency upper-bound assertion (WR-04, unchanged) | ⚠️ Warning | Risk of CI flakiness on a loaded runner, not a correctness defect |
| `src/lib/pipeline/fetchSource.ts` | 74-78, 115-121, 137-143 | No regression test asserts that `cancel()` is actually invoked, or that repeated cycles against a persistently-failing source don't accumulate open sockets/fds | ℹ️ Info (advisory, not blocking) | The fix is verified correct today by reading a deterministic, unconditional control-flow path with no scheduling dependency; a future edit could silently remove a `cancel()` call with nothing automated to catch it |
| `src/lib/pipeline/fetchSource.ts:34-45,52-61` | — | `readBodyWithCap`'s no-stream fallback validates size only after fully buffering (IN-01, unchanged) | ℹ️ Info | Comment overstates the guarantee; likely unreachable under Node's undici fetch |
| `test/productionPage.test.ts:84-104` | — | Render-state detection depends on exact JSX attribute order (IN-02, unchanged) | ℹ️ Info | Fragile but not currently broken |

No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in `fetchSource.ts` or any other file this phase touched.

### Human Verification Required

None. The previously-open blocking issue (CR-01) was a code-level defect, closed by a code-level
fix, verified by reading/grepping/diff-review — not a subjective/visual judgment call. The three
`<human-check>` items deferred to end-of-phase in the prior verification pass (tier badge visual
distinctness, multi-tier rendering, deliberate-breakage path at the product level) are unaffected
by this narrow fix and remain informational carry-overs for a human to perform on a running dev
server; they do not block phase completion.

### Gaps Summary

None. The single gap from the prior verification pass — 02-REVIEW.md's CR-01, a per-cycle socket
leak on all three of `fetchSource.ts`'s early-return failure paths — is closed by commit
`01e3c34de16a2ca9626a5f7319e425d44a15b330`. Independent verification in this session (not the
SUMMARY's word) confirms: (1) all three `res.body?.cancel()` / `reader.cancel()` calls are present
on live, reachable, unconditional execution paths, matching CR-01's suggested fix exactly; (2) the
full test suite (73/73), production build, and lint all pass; (3) all 10 previously-verified
truths and artifacts remain intact — the fix's diff touches only `fetchSource.ts` and does not
disturb `fanOut.ts`, `getFrontPage.ts`, `sources.ts`, `SourceTierBadge.tsx`, `page.tsx`, or the
test fixtures. The phase goal — all 13 sources fetched in parallel on every cache revalidation
cycle, with a failure in any one never preventing the rest from rendering, sustained across
repeated cycles — is now fully and durably achieved. The absence of a dedicated regression test
for the cancellation behavior itself is noted as a non-blocking advisory (see Anti-Patterns).

---

_Verified: 2026-09-22T15:21:58Z_
_Verifier: Claude (gsd-verifier)_
