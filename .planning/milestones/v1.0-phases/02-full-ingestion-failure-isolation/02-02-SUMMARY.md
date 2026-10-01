---
phase: 02-full-ingestion-failure-isolation
plan: 02
subsystem: api
tags: [nextjs, typescript, rss-parser, sources, content-type-gate]

# Dependency graph
requires:
  - phase: 02-full-ingestion-failure-isolation
    provides: "Plan 02-01's fanOut() Promise.allSettled seam, sortByRecencyDesc(), CISA as the second SourceConfig entry, the complete 6-colour tier palette"
provides:
  - "All 13 PROJECT.md sources configured in SOURCES, covering all six SourceTier values"
  - "src/lib/config/sources.test.ts — hermetic config-integrity invariant (count, uniqueness, tier coverage, public-HTTPS-hostname)"
  - "SourceConfig.allowHtmlContentType — per-source opt-in escape hatch for the content-type gate"
  - "readBodyWithCap's no-stream path now enforces MAX_BODY_BYTES and the abort signal, matching the streaming path"
affects: [phase-3-classification-ranking, phase-4-filter-ui]

# Actuals (#2632)
actuals:
  tokens: 3801
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-entry doc comments on any SourceConfig whose URL diverges from PROJECT.md's literal table, naming the divergence and citing the pitfall"
    - "Per-source opt-in flag (allowHtmlContentType) as the pattern for scoping a global exception down to only the entries proven to need it"

key-files:
  created:
    - src/lib/config/sources.test.ts
  modified:
    - src/lib/config/sources.ts
    - src/lib/types.ts
    - src/lib/pipeline/fetchSource.ts
    - test/productionPage.test.ts

key-decisions:
  - "sans-isc, recorded-future, and crowdstrike use corrected canonical URLs instead of PROJECT.md's literal table (byte-cap substitution and post-redirect canonicalization respectively), each documented inline"
  - "Live re-probed all 13 sources this session rather than trusting the plan's 2026-09-21 probe table verbatim — external state can drift; found zero content-type or redirect changes for the 11 new sources, confirming the plan's expected shape held"
  - "Zero sources opted into allowHtmlContentType — this session's live probe found all 13 configured URLs serving an xml content-type, matching the plan's expected outcome exactly"
  - "readBodyWithCap's no-stream branch now honours the abort signal before measuring bytes, mirroring the streaming path's check order"

patterns-established:
  - "allowHtmlContentType?: boolean on SourceConfig is the documented per-source escape hatch for a future source that legitimately serves valid feed content under text/html — set on that one entry rather than re-loosening the shared gate"

requirements-completed: [INGEST-01]

coverage:
  - id: D1
    description: "All 13 sources from PROJECT.md's table are configured in SOURCES, each URL live-verified as a canonical 200 response under the 2MB body cap, covering all six SourceTier values"
    requirement: "INGEST-01"
    verification:
      - kind: unit
        ref: "src/lib/config/sources.test.ts#SOURCES has exactly 13 entries"
        status: pass
      - kind: unit
        ref: "src/lib/config/sources.test.ts#every tier is a valid SourceTier, and all six tiers are represented"
        status: pass
      - kind: e2e
        ref: "src/lib/pipeline/frontpage.e2e.test.ts#getFrontPage() resolves to the ok variant with well-formed, current articles from configured sources"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every configured source URL is HTTPS with a publicly-registrable, non-private, non-loopback hostname — the automated invariant underwriting T-02-05's accepted-risk premise"
    requirement: "INGEST-01"
    verification:
      - kind: unit
        ref: "src/lib/config/sources.test.ts#every url parses as https:"
        status: pass
      - kind: unit
        ref: "src/lib/config/sources.test.ts#no url hostname is an IP literal, loopback/local name, or non-registrable"
        status: pass
    human_judgment: false
  - id: D3
    description: "HTML content-type acceptance is scoped per-source via allowHtmlContentType, closing STATE.md WR-01; zero sources opted in per this session's live probe"
    verification:
      - kind: manual_procedural
        ref: "live curl probe against all 13 configured URLs this session (content-type column, recorded below) cross-checked against zero non-comment allowHtmlContentType: true occurrences in sources.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "readBodyWithCap's no-stream path enforces MAX_BODY_BYTES via Buffer.byteLength and reuses the streaming path's exact error message, closing STATE.md WR-02"
    verification:
      - kind: unit
        ref: "grep gate: NO_STREAM_PATH_CAPPED (absence of the bare `return await res.text();` line, presence of Buffer.byteLength) against src/lib/pipeline/fetchSource.ts"
        status: pass
    human_judgment: false

duration: 28min
completed: 2026-09-22
status: complete
---

# Phase 2 Plan 2: Full 13-Source Ingestion, Config Integrity Gate, and Scoped HTML Acceptance Summary

**All 13 PROJECT.md sources wired with live-verified canonical URLs, a hermetic config-integrity test, per-source HTML content-type opt-in, and an unconditional body-size cap on every `readBodyWithCap` return path.**

## Performance

- **Duration:** 28 min
- **Started:** 2026-09-22T10:55:00Z
- **Completed:** 2026-09-22T11:23:00Z
- **Tasks:** 3
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments
- `SOURCES` now holds all 13 configured sources across all six `SourceTier` values (Government, Security Research ×3, Enterprise Security ×3, Threat Intelligence ×3, Tech & General ×2, Executive News ×1)
- Three entries (`sans-isc`, `recorded-future`, `crowdstrike`) use corrected canonical URLs instead of PROJECT.md's literal table, each with an inline doc comment naming the divergence and its reason
- `src/lib/config/sources.test.ts` hermetically pins 7 config invariants: exact count, id uniqueness/slug form, url uniqueness, non-empty trimmed names, tier membership plus all-six-tiers coverage, https protocol, and public/non-private-hostname predicates — this is the automated gate underwriting T-02-05's DNS-rebinding risk acceptance
- `SourceConfig.allowHtmlContentType?: boolean` scopes the content-type gate's HTML exception per source; live re-probe this session found zero of the 13 configured URLs serving `html` (all serve `xml`), so zero entries opt in — closes STATE.md review item WR-01
- `readBodyWithCap`'s no-stream branch now measures the decoded body with `Buffer.byteLength` and throws the identical `exceeded ... byte cap` error the streaming path uses, honouring the abort signal first — closes STATE.md review item WR-02
- `MAX_BODY_BYTES` (2MB) and `SOURCE_TIMEOUT_MS` (8s) are unchanged throughout

## Live Per-Source Probe Table

Re-probed live this session (2026-09-22) with `fetchSource.ts`'s exact `User-Agent` and `Accept` headers — superseding the plan's 2026-09-21 baseline, since external state can drift. All 13 sources returned HTTP 200 with no redirect hop, every body under the 2,097,152-byte cap, and every content-type contains `xml` (none `html`).

| id | code | bytes | content-type |
|----|------|-------|--------------|
| `krebs` | 200 | 168,492 | `application/rss+xml; charset=UTF-8` |
| `cisa` | 200 | 408,320 | `application/rss+xml; charset=utf-8` |
| `recorded-future` | 200 | 513,810 | `application/xml` |
| `microsoft-security` | 200 | 360,383 | `application/rss+xml; charset=UTF-8` |
| `sans-isc` | 200 | 47,453 | `text/xml; charset=utf-8` |
| `dark-reading` | 200 | 77,306 | `text/xml; charset=utf-8` |
| `crowdstrike` | 200 | 5,514 | `application/rss+xml;charset=utf-8` |
| `bleeping-computer` | 200 | 13,076 | `text/xml; charset=utf-8` |
| `hacker-news` | 200 | 59,413 | `text/xml; charset=utf-8` |
| `help-net-security` | 200 | 17,963 | `application/rss+xml; charset=UTF-8` |
| `techcrunch-security` | 200 | 18,181 | `application/rss+xml; charset=UTF-8` |
| `ars-technica` | 200 | 73,884 | `text/xml; charset=utf-8` |
| `cso-online` | 200 | 195,147 | `application/rss+xml; charset=UTF-8` |

No source's byte size changed enough to threaten the 2MB cap, and no source's content-type shifted to `html`, so the plan's Task 3 "expected outcome: zero entries opt in" held exactly.

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire the remaining 11 sources, each URL live-verified as canonical and under cap** - `f6c93c1` (feat)
2. **Task 2: Hermetic config-integrity test over the 13-source array** - `3233bbc` (test)
3. **Task 3: Close the two Phase 1 review carry-overs** - `3f5f263` (fix)

## Files Created/Modified
- `src/lib/config/sources.ts` - 11 sources appended, completing all 13; header doc comment updated to describe the full list and the quiet-vs-broken-source caveat
- `src/lib/config/sources.test.ts` - new hermetic 7-test config-integrity suite
- `src/lib/types.ts` - `SourceConfig` gains `allowHtmlContentType?: boolean`
- `src/lib/pipeline/fetchSource.ts` - content-type gate scoped to per-source opt-in; `readBodyWithCap`'s no-stream branch now enforces the byte cap and observes the abort signal
- `test/productionPage.test.ts` - render-state assertion made source-agnostic (see Deviations)

## Decisions Made
- Used the plan's corrected canonical URLs for `sans-isc` (rolling feed, not the 5.7MB archive), `recorded-future` (post-redirect, no trailing slash), and `crowdstrike` (final post-redirect hop) rather than PROJECT.md's literal table
- Re-probed all 13 sources live this session instead of trusting the plan's 2026-09-21 table verbatim, per the plan's own instruction that external state can drift — found no material differences (byte sizes shifted slightly, as expected for live feeds; content-types and redirect behavior unchanged)
- Left `allowHtmlContentType` unset on every entry, matching the live probe's confirmed zero-html result
- Kept the field itself in `SourceConfig` even with zero current consumers, as the documented escape hatch STATE.md WR-01 asked for

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a hardcoded single-source assumption in `test/productionPage.test.ts`**
- **Found during:** Task 3's full-suite regression run (`npm test`)
- **Issue:** `test/productionPage.test.ts`'s "exactly one of the two valid render states" test asserted specifically on a `krebsonsecurity.com` anchor. With 13 sources now wired, a quiet Krebs feed alongside a contributing non-Krebs source produces neither signal (no Krebs anchor, no empty-state text) even though the page renders correctly with real content — a false failure caused directly by this plan's Task 1 widening the source count, not a defect in the page itself.
- **Fix:** Replaced the Krebs-specific `href` regex with a source-agnostic signal: any `ArticleCard` anchor carries `target="_blank" rel="noopener noreferrer"` and no other element on the page does (confirmed by reading `src/components/ArticleCard.tsx` and `src/app/layout.tsx`), so that attribute pair is checked instead of one hardcoded hostname.
- **Files modified:** `test/productionPage.test.ts`
- **Verification:** `node --test test/productionPage.test.ts` and the full `npm test` (63/63) both pass.
- **Committed in:** `3f5f263` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary to satisfy the plan's own stated success criterion ("Full suite regression: `npm test` passes"). No scope creep — the fix is scoped to the one assertion the widening invalidated; no other test or production code changed as a result.

## Issues Encountered
- The worktree had no `node_modules` (created before dependencies were installed into it, same as Plan 02-01). Ran `npm ci` against the existing `package-lock.json` before the first `npm run build` — restores already-locked dependencies, not a new package install, so it is not gated by the Rule 3 package-legitimacy exclusion. No `package.json`/`package-lock.json` changes resulted.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All 13 sources are live and wired; `fanOut()` and `sortByRecencyDesc()` from Plan 02-01 require no changes to consume the full list
- The config-integrity test (`sources.test.ts`) is in place as a standing invariant for any future source addition/removal
- `SourceConfig.allowHtmlContentType` is available as the documented escape hatch if a future source starts serving valid RSS under `text/html`
- Full regression suite (63 tests) passes with zero failures; `npm run build` and `npm run lint` both exit 0
- Human-check deferred to end-of-phase per `human_verify_mode: end-of-phase`: load the running dev server and confirm articles from several distinct sources appear together, carrying more than two different tier badge colours (02-02-PLAN.md's own `<verification>` human-check item) — several sources contributing nothing at any given moment is expected (Pitfall 4), not a defect

## Self-Check: PASSED

All created/modified files exist (`sources.ts`, `sources.test.ts`, `types.ts`, `fetchSource.ts`, `test/productionPage.test.ts`) and all three task commit hashes (`f6c93c1`, `3233bbc`, `3f5f263`) are present in `git log`.

---
*Phase: 02-full-ingestion-failure-isolation*
*Completed: 2026-09-22*
