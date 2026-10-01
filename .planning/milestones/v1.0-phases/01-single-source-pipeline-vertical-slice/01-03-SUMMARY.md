---
phase: 01-single-source-pipeline-vertical-slice
plan: 03
subsystem: ingestion-pipeline-verification
tags: [node-test, hermetic-fixture, ssrf-validation, production-build, caching-gates]

# Dependency graph
requires:
  - phase: 01-01
    provides: "fetchWithValidatedRedirect, fetchSource, normalize, filterLookback, and getFrontPage under test"
  - phase: 01-02
    provides: "ArticleCard/masthead/empty-state markup this plan's production-page test asserts against"
provides:
  - "test/fixtures/hostileRedirectServer.ts: hermetic 127.0.0.1-only node:http fixture (cross-host, non-HTTPS, prefix-lookalike, missing-Location, never-responding routes)"
  - "Real-socket proof that the per-hop 8s AbortController timeout actually fires, both directly and wrapped by fetchSource's never-throwing contract"
  - "test/productionPage.test.ts: spawns next start, asserts the no-auth contract, the exactly-one-render-state cold-cache render, and byte-identical double-request equality"
  - "Independent confirmation that all four caching-configuration gates (REVALIDATE_SET, NO_COMPANION_CACHE_OPTION, CACHE_COMPONENTS_OFF, STRING_PARSER_ONLY) already hold from Plan 01-01"
affects: [02-full-ingestion-failure-isolation]

# Actuals (#2632)
actuals:
  tokens: 5250
  tasks: 3
  commits: 3
  plan_head_before: b9bf581659c4843add3e73130f6d1b2df26da512

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hermetic local node:http fixture (127.0.0.1, ephemeral port, closeAllConnections in teardown) for testing branches production traffic never exercises"
    - "Reject-path and timeout tests run against a real socket; hop-boundary/follow tests that require a legitimate (HTTPS) chain stay on a deterministic mocked fetch, since serving real TLS locally would need a new dependency or globally disabling certificate verification"
    - "Production-build HTTP contract tests spawn next start on a dedicated port, poll-until-ready with a bounded budget, and kill the child in every teardown path"

key-files:
  created:
    - test/fixtures/hostileRedirectServer.ts
    - test/productionPage.test.ts
  modified:
    - src/lib/pipeline/fetchWithValidatedRedirect.test.ts
    - src/lib/pipeline/normalize.test.ts
    - src/lib/pipeline/filterLookback.test.ts

key-decisions:
  - "Reject-path tests (cross-host, non-HTTPS, prefix-lookalike, missing-Location) and both timeout tests run against the real hermetic fixture; the three tests needing a successfully-followed chain (5-hop success, 6-hop rejection, single-hop follow) stay on the pre-existing deterministic mock, because a legitimate redirect must be HTTPS per the guard's own protocol check, and the fixture is deliberately plain HTTP"
  - "The 'subdomain label prepended' suffix-lookalike test moved to the mocked-fetch group rather than the real fixture: WHATWG URL host parsing treats any hostname ending in a numeric label (as 'sub.127.0.0.1' does) as an IPv4-parse candidate and throws outright, rather than producing a controlled host-mismatch rejection — a real domain name has no such constraint, so the mock reproduces the plan's own literal 'sub.krebsonsecurity.com' example exactly"
  - "Considered serving the fixture over real HTTPS with a self-signed certificate (openssl-generated, no new npm dependency) to prove the follow-path tests against a real socket too; abandoned after prototyping, since making Node's global fetch trust it required globally disabling TLS certificate verification for the test process (NODE_TLS_REJECT_UNAUTHORIZED=0) — flagged by this environment's own security-guidance tooling as a MITM-risk anti-pattern, and rejected as a worse trade-off than the deterministic mock already in place"
  - "Extended (not replaced) normalize.test.ts and filterLookback.test.ts, since Plan 01-01 already closed most of Task 2's required edge cases as its own deviation; only the two genuinely-missing cases (full well-formed-item field check with title trimming, markup/entity verbatim survival) and the boundary-specific 23h/25h + near-now + single-element cases were added"
  - "Marked WINDOWS.md entry #1 (per-hop timeout path untested) as fixed — this plan's hermetic-fixture timeout tests are exactly what that entry named as the resolving work"

patterns-established:
  - "Real-socket-for-reject-and-timeout, mock-for-follow-and-hop-boundary as the split for testing a redirect-validation guard without adding a TLS dependency"

requirements-completed: [INGEST-03, INGEST-04, INGEST-05, NORM-01, UI-06]

coverage:
  - id: D1
    description: "The hermetic fixture proves cross-host rejection, non-HTTPS rejection, and missing-Location rejection against a real local socket, each distinguishable by its own error message"
    requirement: "INGEST-03"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/fetchWithValidatedRedirect.test.ts (3 fixture-backed reject tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The per-hop 8s AbortController timeout fires against a real never-responding origin, both directly (fetchWithValidatedRedirect) and wrapped (fetchSource resolves to the error variant rather than hanging or rejecting)"
    requirement: "INGEST-03"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/fetchWithValidatedRedirect.test.ts (2 real-wall-clock tests, ~8s each)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Both suffix-lookalike hosts (subdomain-prepended, original-as-prefix-of-a-longer-domain) are rejected, confirming host comparison is exact string equality and not a suffix/substring match"
    requirement: "INGEST-03"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/fetchWithValidatedRedirect.test.ts (1 real-fixture test + 1 mocked test)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A legitimate same-host HTTPS redirect is still followed (single hop, exactly-5-hop chain, and 6th-hop rejection), so the guard cannot pass by refusing everything"
    requirement: "INGEST-03"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/fetchWithValidatedRedirect.test.ts (3 mocked-fetch tests)"
        status: pass
    human_judgment: true
    rationale: "These three prove the loop-boundary logic deterministically, but not against the real hermetic fixture — a legitimate chain requires HTTPS, and the fixture is deliberately plain HTTP (see Decisions). The logic itself is fully and deterministically proven; flagged only so a future reviewer knows why these three specifically stayed on mocks after 01-01/01-02's mock-based tests were otherwise superseded by the real fixture."
  - id: D5
    description: "Normalization edges — full well-formed-item field population with title trimming, and markup/ampersand-entity titles surviving verbatim — are pinned by tests"
    requirement: "NORM-01"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/normalize.test.ts (2 new tests, 12 total in file)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The 24h lookback boundary is pinned on both sides (23h survives, 25h drops) plus near-now and single-element cases, all computed relative to the moment of assertion"
    requirement: "INGEST-04"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/filterLookback.test.ts (7 new tests, 11 total in file)"
        status: pass
    human_judgment: false
  - id: D7
    description: "An unauthenticated GET / against a production build returns 200 with no Set-Cookie/WWW-Authenticate and never 401/403, renders exactly one of the two valid states, and two consecutive requests are byte-identical"
    requirement: "UI-06"
    verification:
      - kind: e2e
        ref: "test/productionPage.test.ts (4 tests against a real `next start` on port 3100)"
        status: pass
    human_judgment: true
    rationale: "Byte-identical double-request equality is necessary but not sufficient proof of the 900s revalidation window — two independently-uncached renders taken within the same second could also match. The sufficient proof (x-vercel-cache header transition on a deployed preview) remains WINDOWS.md entry #2, still open, carried forward per human_verify_mode=end-of-phase."
  - id: D8
    description: "The caching configuration cannot silently regress in any of the four documented ways"
    requirement: "INGEST-05"
    verification:
      - kind: other
        ref: "Four independent grep gates: REVALIDATE_SET, NO_COMPANION_CACHE_OPTION, CACHE_COMPONENTS_OFF, STRING_PARSER_ONLY — all pass, no source changes needed"
        status: pass
    human_judgment: false

# Metrics
duration: 55min
completed: 2026-09-19
status: complete
---

# Phase 1 Plan 3: Hermetic Redirect Fixture and Production Contract Summary

**A hermetic local HTTP fixture proves the redirect-reject and timeout branches real Krebs traffic never exercises; a real `next start` server proves the no-auth contract and cold-cache render — closing out Phase 1's last untested corners.**

## Performance

- **Duration:** ~55 min (includes two real ~8s timeout tests run twice each across individual and full-suite runs)
- **Tasks:** 3 planned tasks, all completed
- **Files modified:** 2 created, 3 modified

## Accomplishments

- Built `test/fixtures/hostileRedirectServer.ts`, a hermetic `node:http` server bound to `127.0.0.1` on an OS-assigned ephemeral port, serving cross-host, non-HTTPS, prefix-lookalike, missing-`Location`, same-host-200, and never-responding routes
- Proved the per-hop 8s `AbortController` timeout actually fires against a real hanging socket — both directly (`fetchWithValidatedRedirect`) and through `fetchSource`'s never-throwing contract — closing the one gap Plan 01-01's own SUMMARY explicitly flagged as remaining work
- Proved both suffix-lookalike host rejections (subdomain-prepended, original-as-prefix) confirm exact-string host comparison, not a suffix/substring match
- Extended `normalize.test.ts` and `filterLookback.test.ts` with the two normalization cases and the boundary-specific 24h cases Task 2 named that Plan 01-01's own prior deviation hadn't yet covered
- Built `test/productionPage.test.ts`, spawning a real `next start` production server and asserting the no-authentication contract, the exactly-one-valid-render-state property, and double-request byte-identity
- Independently re-verified all four caching-configuration gates (`REVALIDATE_SET`, `NO_COMPANION_CACHE_OPTION`, `CACHE_COMPONENTS_OFF`, `STRING_PARSER_ONLY`) — no source changes were needed, confirming Plan 01-01's implementation already held
- Marked `.planning/WINDOWS.md` entry #1 (timeout path untested) as fixed

## Task Commits

Each task was committed atomically:

1. **Task 1: Hostile-redirect fixture and the redirect/timeout negative-path tests** - `1cc2c2d` (test)
2. **Task 2: Pure-transform edge tests for normalization and the 24-hour lookback** - `ffeb242` (test)
3. **Task 3: Production-build HTTP contract and the caching configuration gate** - `3307c4e` (test)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `test/fixtures/hostileRedirectServer.ts` - hermetic local HTTP fixture (127.0.0.1, ephemeral port, closeAllConnections teardown)
- `src/lib/pipeline/fetchWithValidatedRedirect.test.ts` - reject/timeout tests against the real fixture; follow/hop-boundary tests kept on a deterministic mock
- `src/lib/pipeline/normalize.test.ts` - added full well-formed-item and markup/entity-survival cases
- `src/lib/pipeline/filterLookback.test.ts` - added 23h/25h boundary, near-now, and single-element cases
- `test/productionPage.test.ts` - spawns `next start`, asserts no-auth contract and cold-cache render

## Decisions Made

- Split the redirect test file's approach: real hermetic socket for everything that only needs a controlled 3xx/hang response (reject-path, timeout), deterministic mock for everything that needs a *successfully followed* chain (which requires HTTPS the plain-HTTP fixture cannot legitimately serve without a new dependency or disabling certificate verification)
- Prototyped and then abandoned a self-signed-HTTPS version of the fixture after this environment's own security tooling flagged the `NODE_TLS_REJECT_UNAUTHORIZED=0` workaround it would have required as a MITM-risk anti-pattern — the deterministic mock already in place from Plan 01-01 proves the same hop-counting logic with no such risk
- Moved the "subdomain label prepended" suffix test to the mocked-fetch group: a raw dotted-quad IPv4 fixture host makes any `sub.<ip>`-shaped Location target trip the WHATWG URL parser's IPv4-parse heuristic (throws "Invalid URL" instead of yielding a controlled rejection) — a real domain name has no such constraint, so the mock reproduces the plan's own literal `sub.krebsonsecurity.com` example exactly
- Extended, rather than duplicated, `normalize.test.ts`/`filterLookback.test.ts`, since Plan 01-01's own Rule 2 deviation had already closed most of Task 2's named edge cases

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Task 1's own "fixture not shipped" grep gate would fail against the very test file the plan requires**
- **Found during:** Task 1 verification
- **Issue:** The plan's literal verify command (`grep -rIlE 'fixtures/hostileRedirectServer' src/app src/components src/lib`) searches `src/lib`, which is exactly where `fetchWithValidatedRedirect.test.ts` lives and is required by the same task to import `startHostileServer` — the command as written would always find a match and always fail, even on a fully-correct implementation
- **Fix:** Interpreted the check per its own stated intent ("an application file under src/ references the test-only fixture") and excluded `*.test.ts` files from the match, since test files are never part of the Next.js production bundle (the actual T-01-12 concern) — verified with `grep ... | grep -v '\.test\.ts$'`
- **Files modified:** none (verification-only clarification)
- **Verification:** `FIXTURE_NOT_SHIPPED` token present after excluding test files; the raw command without the exclusion was confirmed to match only the test file itself, never an application file
- **Committed in:** 1cc2c2d (documented in the test file's own header comment)

**2. [Rule 1 - Bug] The "subdomain label prepended" suffix test threw an unrelated parse error against the real IP-bound fixture**
- **Found during:** Task 1, first run of the extended test file
- **Issue:** `new URL("https://sub.127.0.0.1:PORT/")` throws "Invalid URL" rather than parsing — the WHATWG URL host algorithm treats any hostname ending in a numeric label as an IPv4-parse candidate, and "sub.127.0.0.1" fails that parse — so the test's own setup broke before `fetchWithValidatedRedirect`'s host-comparison logic ever ran
- **Fix:** Moved this one case to the pre-existing deterministic-mock pattern using clean domain-style hostnames (`sub.original.test`), which has no such constraint and reproduces the plan's own literal example exactly; removed the now-unused fixture route
- **Files modified:** src/lib/pipeline/fetchWithValidatedRedirect.test.ts, test/fixtures/hostileRedirectServer.ts
- **Verification:** full test file green (10/10) after the change
- **Committed in:** 1cc2c2d

---

**Total deviations:** 2 auto-fixed (both Rule 1 — correcting a verify-command/test-construction bug against the plan's own stated intent, not a change to pipeline behavior)
**Impact on plan:** Neither changed any production code or the security guarantees under test. Both were necessary for the plan's own verification commands and test constructions to be internally consistent with what the plan actually asks for.

## Issues Encountered

- Krebs on Security's latest post remained more than 24 hours old at this plan's execution time (consistent with Plan 01-01/01-02's own findings), so `test/productionPage.test.ts`'s "exactly one valid render state" assertion exercised the D-03 empty-state branch, not the populated-card branch, during this session. The test itself does not depend on which branch is live — it asserts the XOR property either way — so this is expected, correct behavior, not a gap.
- `npm test`'s default file-discovery glob also picks up `test/fixtures/hostileRedirectServer.ts` as a nominal "test file" (Node's runner treats any file under a directory named `test` as a candidate) and reports it as a trivially-passing 0-assertion file. Cosmetic only — no failure, no behavior change; left as-is since renaming/relocating the fixture to dodge this would fight the plan's own required file path.

## Human Verification Deferred (human_verify_mode: end-of-phase)

Task 3's `<human-check>` asks for a Vercel preview deployment, observing the `x-vercel-cache` header transition across the ~15-minute revalidation window and confirming real Krebs headlines render (the only point Assumption A1 — whether Krebs needs Vercel-specific anti-bot handling — can be answered). Per `workflow.human_verify_mode: "end-of-phase"` and `workflow.auto_advance: false`, this executor performed the closest automation-only equivalent instead of deploying:
- Built and ran a real production server (`npm run build && next start -p 3100`), confirmed via `test/productionPage.test.ts`
- Confirmed all four caching-configuration gates hold structurally
- Left `.planning/WINDOWS.md` entry #2 (the platform-governed 15-minute timing behavior) open, as this plan's own must_haves anticipated ("will abstain to `human_needed` at verify time if that observation has not been made — that abstention is the correct outcome, not a gap to paper over")

A real Vercel preview observation is still required at the phase-end UAT pass — flagged as coverage item D7 above with `human_judgment: true`, and tracked as the still-open WINDOWS.md entry #2.

## Next Phase Readiness

- Phase 1's full success-criteria set (redirect rejection with distinct causes, timeout abort, 24h lookback boundary, no-auth contract, caching-configuration gates) is now proven by tests rather than by code inspection, closing every gap Plan 01-01's own SUMMARY explicitly deferred to this plan
- The hermetic fixture pattern (`test/fixtures/hostileRedirectServer.ts`) and the production-page HTTP contract pattern (`test/productionPage.test.ts`) are both reusable as-is when Phase 2 fans out to the other 12 sources — the same reject/timeout branches apply per-source, and the same production contract applies to the full 7-section page
- Two WINDOWS.md entries remain open, both platform-governed and requiring a real Vercel preview deployment to close: entry #2 (15-minute stale-while-revalidate timing) and entry #3 (a real browser click-through of the rendered UI, from Plan 01-02). Neither blocks Phase 2's start; both are legitimate phase-end UAT items, not blockers introduced by this plan.
- No blockers for Phase 2.

## Self-Check: PASSED

- All 5 files listed under `key-files` (2 created, 3 modified) verified present on disk via `test -f`.
- All 3 task commit hashes (1cc2c2d, ffeb242, 3307c4e) verified present via `git log --oneline`.

---
*Phase: 01-single-source-pipeline-vertical-slice*
*Completed: 2026-09-19*
