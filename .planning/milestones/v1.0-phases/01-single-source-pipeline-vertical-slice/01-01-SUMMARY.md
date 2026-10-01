---
phase: 01-single-source-pipeline-vertical-slice
plan: 01
subsystem: ingestion-pipeline
tags: [nextjs, typescript, tailwind, rss-parser, ssrf-validation, data-cache, server-components]

# Dependency graph
requires: []
provides:
  - Next.js 16 + TypeScript 5 + Tailwind 4 scaffold (--src-dir, @/* -> ./src/*) with rss-parser@3.13.0 and clsx@2.1.1 pinned exactly
  - Shared SourceConfig/Article/FrontPageResult contracts in src/lib/types.ts
  - SOURCES[] config array (src/lib/config/sources.ts) shaped for Phase 2's 13-source fan-out
  - fetchWithValidatedRedirect: redirect:"manual" loop with per-hop 8s abort, exact-host + HTTPS-only redirect-target validation, 5-hop cap
  - fetchSource: never-throwing fetch+parse via next.revalidate:900 (no companion cache option), rejects non-2xx/non-XML/oversized bodies
  - normalize / filterLookback pure transforms and getFrontPage single orchestrator
  - Public async Server Component at "/" rendering real Krebs on Security articles or the D-03 quiet empty-state line, no auth surface
affects: [01-02-ui-card-masthead, 01-03-hermetic-redirect-fixture-and-production-contract, 02-full-ingestion-failure-isolation]

# Actuals (#2632)
actuals:
  tokens: 9900
  tasks: 2
  commits: 5
  plan_head_before: 4e1c56f8878907f3827ffb58e69531bd70ad95d2

# Tech tracking
tech-stack:
  added: [next@16.3.5, react@19.2.8, tailwindcss@4, rss-parser@3.13.0, clsx@2.1.1]
  patterns:
    - "Fetcher-never-throws: fetchSource/getFrontPage always return { status: 'ok'|'error' } discriminated unions"
    - "Redirect validation: redirect:'manual' + exact-string host/protocol check before following, bounded hop loop"
    - "Cache via next.revalidate only — no cache:'force-cache' companion, no hand-rolled TTL map"
    - "SOURCES[] config array — Phase 2 appends 12 more entries with zero refactor"

key-files:
  created:
    - src/lib/types.ts
    - src/lib/config/sources.ts
    - src/lib/pipeline/fetchWithValidatedRedirect.ts
    - src/lib/pipeline/fetchSource.ts
    - src/lib/pipeline/normalize.ts
    - src/lib/pipeline/filterLookback.ts
    - src/lib/pipeline/getFrontPage.ts
    - src/lib/pipeline/frontpage.e2e.test.ts
    - src/lib/pipeline/fetchWithValidatedRedirect.test.ts
    - src/lib/pipeline/normalize.test.ts
    - src/lib/pipeline/filterLookback.test.ts
  modified:
    - src/app/page.tsx
    - .gitignore
    - tsconfig.json
    - package.json

key-decisions:
  - "Scaffolded with create-next-app --src-dir after moving .planning/ aside (RESEARCH.md P1-5/P1-6): restored .planning/ and re-appended the .planning/research/.cache/ ignore line the scaffold overwrites"
  - "Pinned rss-parser@3.13.0 and clsx@2.1.1 exactly (npm's default ^ ranges edited out) to match RESEARCH.md's Package Legitimacy Audit; fast-xml-parser deliberately NOT installed"
  - "Configured the canonical post-redirect Krebs URL (trailing slash) in sources.ts, per Pitfall P1-2, so the common case never redirects"
  - "Added tsconfig compilerOptions.allowImportingTsExtensions:true and explicit .ts specifiers on every relative import under src/lib/** — Node's native ESM type-stripping (used by `node --test`) requires explicit extensions, unlike TypeScript's own extension-less convention"
  - "User-Agent sent on the source fetch carries a browser-compatible token plus an explicit Havadis identification and contact-URL placeholder (+https://havadis.app/about), satisfying the plan's prohibition against impersonating a human browser without disclosure"

patterns-established:
  - "Discriminated FrontPageResult shared by fetchSource and getFrontPage — never throw, always resolve"
  - "Redirect validation loop with function-local state only (no module-scope mutable state)"
  - "24h lookback cutoff sampled once per filterLookback call"

requirements-completed: [INGEST-03, INGEST-04, INGEST-05, NORM-01, UI-06]

coverage:
  - id: D1
    description: "Next.js 16 + TypeScript + Tailwind 4 scaffold builds and lints cleanly with pinned rss-parser/clsx dependencies and .planning/ intact"
    verification:
      - kind: other
        ref: "npm run build && npm run lint (both exit 0)"
        status: pass
    human_judgment: false
  - id: D2
    description: "fetchWithValidatedRedirect rejects cross-host, non-HTTPS, and missing-Location redirects; follows exactly 5 valid same-host HTTPS hops and rejects a 6th (INGEST-03)"
    requirement: "INGEST-03"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/fetchWithValidatedRedirect.test.ts (5 tests)"
        status: pass
    human_judgment: true
    rationale: "The mock-fetch fixture proves the redirect/host/protocol/hop-count branches deterministically, but the per-hop 8s AbortController timeout itself is not exercised by a real (or fake-timer) clock in this plan — that's ROADMAP.md's stated scope for 01-03's hermetic fixture. Routing to human/next-plan review rather than silently claiming full proof of this high-severity (T-01-01) mitigation."
  - id: D3
    description: "fetchSource is wired to Next's Data Cache via next.revalidate:900 with no companion cache option, and never throws on a live fetch+parse (INGEST-05 config correctness)"
    requirement: "INGEST-05"
    verification:
      - kind: e2e
        ref: "src/lib/pipeline/frontpage.e2e.test.ts (2 tests, live Krebs feed)"
        status: pass
      - kind: other
        ref: "npm run build output: Route (app) / Revalidate 15m"
        status: pass
    human_judgment: false
  - id: D4
    description: "The actual 15-minute stale-while-revalidate timing behavior (two real requests ~15min apart serve the same cached snapshot, then background-refetch) is a platform-governed backstop truth"
    verification: []
    human_judgment: true
    rationale: "RESEARCH.md Pitfall P1-4 and this plan's own must_haves mark this unverifiable under `next dev` and not directly observable inside this executor's automated run; requires a production build/deployed preview inspection of x-vercel-cache / request timing, per the plan's documented backstop-verification design."
  - id: D5
    description: "normalize() drops items missing title/link/isoDate or with a non-http(s) link scheme, falls back to an empty-string summary, preserves feed order, and performs no dedupe (NORM-01)"
    requirement: "NORM-01"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/normalize.test.ts (10 tests)"
        status: pass
    human_judgment: false
  - id: D6
    description: "filterLookback samples Date.now() exactly once per call and correctly includes/excludes articles against a 24h (or custom) window (INGEST-04)"
    requirement: "INGEST-04"
    verification:
      - kind: unit
        ref: "src/lib/pipeline/filterLookback.test.ts (4 tests)"
        status: pass
    human_judgment: false
  - id: D7
    description: "The public / route renders real, current Krebs on Security articles or the D-03 quiet empty-state line, with no authentication surface anywhere (UI-06)"
    requirement: "UI-06"
    verification:
      - kind: e2e
        ref: "src/lib/pipeline/frontpage.e2e.test.ts (2 tests) + npm run build prerendering /"
        status: pass
      - kind: manual_procedural
        ref: "npm run build && npm start; curl -D- http://localhost:3000/ — HTTP 200, no Set-Cookie/WWW-Authenticate, body correctly shows the D-03 empty-state line (Krebs's latest post was >24h old at verification time)"
        status: pass
    human_judgment: true
    rationale: "The plan's own <human-check> calls for a real browser visit; this executor performed the closest automation-only equivalent (build+start+curl+header/body inspection) per human_verify_mode=end-of-phase, but an actual browser round-trip is deferred to the phase-end UAT pass."

# Metrics
duration: 20min
completed: 2026-09-18
status: complete
---

# Phase 1 Plan 1: Single-Source Pipeline Vertical Slice Summary

**Krebs on Security flows live through validated-redirect fetch, `next.revalidate:900` caching, RSS normalization, and a 24h lookback filter onto a public, unauthenticated Next.js 16 Server Component.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-09-18T10:03Z (approx., worktree creation)
- **Completed:** 2026-09-18T10:23Z (approx., final commit)
- **Tasks:** 2 planned tasks, both completed
- **Files modified:** 15 created, 4 modified (see key-files above)

## Accomplishments

- Scaffolded Next.js 16 + TypeScript 5 + Tailwind 4 in place inside the existing `.git`/`.claude`/`.planning` repo, working around `create-next-app`'s `.planning/` conflict and its wholesale `.gitignore` overwrite
- Built the full validated-redirect fetch wrapper (SSRF mitigation T-01-01): `redirect: "manual"`, exact host+protocol validation, 5-hop cap, fresh 8s `AbortController` per hop
- Wired `fetchSource` to Next.js's persistent Data Cache via `next.revalidate: 900` with no companion `cache` option, confirmed by the production build's `Route (app) / Revalidate 15m` output
- Implemented `normalize`/`filterLookback`/`getFrontPage` as pure, never-throwing pipeline stages composed by a single orchestrator
- Replaced the scaffold placeholder with a real async Server Component that renders live Krebs on Security articles or the D-03 quiet empty-state line — verified against the actual live feed, which currently has nothing published in the last 24 hours, so the empty-state path was exercised for real, not simulated
- Closed test-coverage gaps this plan's own frontmatter assigns to itself (INGEST-03 adjacency/empty edges, NORM-01 adjacency/empty/ordering edges, INGEST-04 concurrency edge) with deterministic mock-based unit tests, since the live e2e test alone only proves the happy path

## Task Commits

Each task was committed atomically, plus two deviation commits closing test-coverage gaps:

1. **Task 1: Scaffold Next.js 16 in place without losing .planning or .gitignore** - `2042be9` (feat)
2. **Task 2: End-to-end "public page shows live Krebs articles"** - `6618f37` (feat)
3. **Deviation (Rule 2): redirect-rejection unit coverage** - `7e9f09d` (test)
4. **Deviation (Rule 2): NORM-01/INGEST-04 edge unit coverage** - `eaaf713` (test)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `src/lib/types.ts` - SourceTier/SourceConfig/Article/FrontPageResult shared contracts
- `src/lib/config/sources.ts` - SOURCES[] with the single Krebs entry (canonical trailing-slash URL)
- `src/lib/pipeline/fetchWithValidatedRedirect.ts` - manual-redirect validating fetch wrapper
- `src/lib/pipeline/fetchSource.ts` - never-throwing per-source fetch+parse, User-Agent, body-size cap
- `src/lib/pipeline/normalize.ts` - RSS item -> Article, defensive null/protocol guards
- `src/lib/pipeline/filterLookback.ts` - single-cutoff 24h window filter
- `src/lib/pipeline/getFrontPage.ts` - single orchestrator over SOURCES
- `src/app/page.tsx` - public async Server Component render (real articles or D-03 empty state)
- `src/lib/pipeline/frontpage.e2e.test.ts` - live end-to-end test against the real Krebs feed
- `src/lib/pipeline/fetchWithValidatedRedirect.test.ts` - mock-fetch redirect-rejection/hop-boundary tests
- `src/lib/pipeline/normalize.test.ts` - normalize edge-case unit tests
- `src/lib/pipeline/filterLookback.test.ts` - single-cutoff-sample and window unit tests
- `.gitignore` - restored `.planning/research/.cache/` after the scaffold's wholesale overwrite
- `tsconfig.json` - `allowImportingTsExtensions: true` so relative `.ts` specifiers resolve under both Next's type-check and native `node --test`
- `package.json` - pinned `rss-parser`/`clsx` exactly, added the `test` script, corrected the scaffold-derived `name` field

## Decisions Made

- Kept the redirect-validation loop's bounded-hop semantics exactly as specified in RESEARCH.md/PATTERNS.md (`for (hop = 0; hop <= 5; hop++)`), verified by test to allow exactly 5 followed hops and reject a 6th
- Used `Buffer.concat` over a manually-capped stream read (2MB, matching Vercel's Data Cache per-entry limit) rather than `res.text()` directly, so an unbounded feed body fails before exhausting the function
- Deferred the full 6-tier `SourceTierBadge` styling and masthead to Plan 01-02 as scoped — Task 2's `page.tsx` render is the real working end of the traced path, not a visual stand-in
- Left the actual production 15-minute revalidation *timing* behavior as an explicit backstop item (D4 in coverage) rather than fabricating automated proof of platform-governed behavior

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] npm's default `^` semver ranges on rss-parser/clsx**
- **Found during:** Task 1 (dependency install)
- **Issue:** `npm install rss-parser@3.13.0 clsx@2.1.1` wrote `^3.13.0`/`^2.1.1` into `package.json`, not the exact pins the acceptance criteria and RESEARCH.md's Package Legitimacy Audit require
- **Fix:** Edited `package.json` to remove the `^` prefixes; `package-lock.json`'s resolved versions already matched exactly, so no reinstall was needed
- **Files modified:** package.json
- **Verification:** `grep -q '"rss-parser": "3.13.0"'` and the clsx equivalent both pass
- **Committed in:** 2042be9 (Task 1 commit)

**2. [Rule 3 - Blocking] Node ESM requires explicit extensions on relative specifiers**
- **Found during:** Task 2 (first `node --test` run)
- **Issue:** `node --test` failed with `ERR_MODULE_NOT_FOUND` on every extension-less relative import (`from "../types"`) — Node's native ESM resolution (used by its TypeScript type-stripping) does not do TypeScript-style extension-less resolution, unlike `next build`'s bundler-mode `tsc`
- **Fix:** Added `.ts` to every relative import under `src/lib/**` and set `compilerOptions.allowImportingTsExtensions: true` in `tsconfig.json` (safe because `noEmit: true` is already set)
- **Files modified:** tsconfig.json, src/lib/types.ts, src/lib/config/sources.ts, src/lib/pipeline/*.ts
- **Verification:** `node --test` and `npm run build` both pass after the change
- **Committed in:** 6618f37 (Task 2 commit)

**3. [Rule 2 - Missing Critical] Redirect-rejection branches were untested**
- **Found during:** Task 2 wrap-up, re-reading RESEARCH.md Pitfall P1-3 and this plan's own Edge Coverage Resolution table (which assigns INGEST-03's adjacency/empty/ordering/concurrency edges to this plan, 01-01)
- **Issue:** The live e2e test only exercises Krebs's real (same-host, HTTPS) redirect — the "follow" branch. Nothing proved the "reject" branches of a high-severity (T-01-01) SSRF mitigation
- **Fix:** Added `fetchWithValidatedRedirect.test.ts`, mocking `globalThis.fetch` to deterministically test cross-host rejection, non-HTTPS rejection, missing-Location rejection, a full 5-hop success chain, and 6th-hop rejection
- **Files modified:** src/lib/pipeline/fetchWithValidatedRedirect.test.ts (new)
- **Verification:** all 5 new tests pass; `npm run build`/`lint` still clean
- **Committed in:** 7e9f09d

**4. [Rule 2 - Missing Critical] NORM-01/INGEST-04 edges were untested**
- **Found during:** Same re-read of the Edge Coverage Resolution table — rows for NORM-01 (adjacency/empty/ordering) and INGEST-04 (concurrency) are also owned by this plan
- **Issue:** No test proved `normalize`'s null-guards, empty-summary fallback, or order-preservation, nor `filterLookback`'s single-cutoff-sample guarantee
- **Fix:** Added `normalize.test.ts` (10 cases) and `filterLookback.test.ts` (4 cases, including a `Date.now` call-count spy)
- **Files modified:** src/lib/pipeline/normalize.test.ts (new), src/lib/pipeline/filterLookback.test.ts (new)
- **Verification:** all 14 new tests pass; full suite (21 tests) green; `npm run build`/`lint` clean
- **Committed in:** eaaf713

---

**Total deviations:** 4 auto-fixed (2 blocking, 2 missing-critical-test-coverage)
**Impact on plan:** All four were necessary for correctness (exact dependency pins), for the toolchain to function at all (ESM extensions), or to actually prove security/data-shape guarantees this plan's own frontmatter claims. No unrelated scope creep — the redirect/normalize/lookback edge tests specifically close gaps this plan's Edge Coverage Resolution table assigns to plan 01-01 itself, not to 01-02/01-03.

## Issues Encountered

- The live Krebs feed's most recent post (2026-09-16T18:14:22Z) is more than 24 hours old at the time this plan executed (2026-09-18), so the production build and the manual-equivalent browser check both correctly render the D-03 empty-state line rather than a populated list. This is expected, correct behavior (Krebs publishes only a few times a week per RESEARCH.md) and was confirmed by directly inspecting `fetchSource`'s raw output (10 items parsed, all older than 24h) — not a pipeline bug.
- `node --test` prints a `MODULE_TYPELESS_PACKAGE_JSON` warning on every `.ts` test file (package.json has no `"type"` field). Cosmetic only — all tests pass; left as-is to avoid an unproven risk of adding `"type": "module"` this late without a chance to fully re-verify every scaffold-generated config file's ESM/CJS assumptions.

## Human Verification Deferred (human_verify_mode: end-of-phase)

The plan's Task 2 `<human-check>` asks for a real browser visit to `http://localhost:3000` after `npm run build && npm start`. Per this project's `workflow.human_verify_mode: "end-of-phase"` config and the non-auto interactive session, this executor performed the closest automation-only equivalent instead of halting the phase:
- Ran the actual production build and server (`npm run build && npm start`)
- `curl -D-` against `http://localhost:3000/`: `HTTP 200`, no `Set-Cookie`/`WWW-Authenticate` headers, `Cache-Control: s-maxage=900, stale-while-revalidate=...` matching the 900s revalidate config
- Inspected the response body: correctly renders the D-03 "No articles in the last 24 hours." line (verified against a direct `fetchSource` call showing the real reason — Krebs's latest post is >24h old right now)

A real browser click-through (confirming visual rendering, working outbound links, no login prompt of any kind) is still recommended at the phase-end UAT pass — flagged as coverage item D7 above with `human_judgment: true`.

## Next Phase Readiness

- The traced path (`config → validating fetch → cache → parse → normalize → filter → render`) is proven end-to-end against a real, live source and is shaped for Phase 2's 13-source fan-out (`SOURCES[]` array, sequential-but-parallelizable `getFrontPage` loop) without any reshaping needed.
- Plan 01-02 can now build the real `ArticleCard`/`SourceTierBadge`/masthead components against this plan's real `Article[]` data, rather than a stub.
- Plan 01-03's stated scope ("prove the reject/timeout branches with a hermetic fixture... assert the no-auth + caching contract against a production build") is partially pre-satisfied by this plan's mock-fetch redirect tests and the manual production-build check above — but the per-hop `AbortController` **timeout** path (as opposed to redirect rejection) remains genuinely untested by any automated check in this plan, and the two INGEST-05 backstop truths (simultaneous-request dedup, no-thundering-herd during revalidation) remain platform-governed and unverified — both are legitimate remaining work for 01-03, not an oversight to flag as a blocker now.
- No blockers for Phase 1 Plan 02.

## Self-Check: PASSED

- All 12 files listed under `key-files.created`/`page.tsx` verified present on disk via `test -f`.
- All 4 non-metadata commit hashes (2042be9, 6618f37, 7e9f09d, eaaf713) verified present via `git log --oneline`.

---
*Phase: 01-single-source-pipeline-vertical-slice*
*Completed: 2026-09-18*
