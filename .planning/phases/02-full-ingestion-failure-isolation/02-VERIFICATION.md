---
status: passed
---

# Phase 2: Full Ingestion & Failure Isolation Verification Report

**Phase Goal:** All 13 configured sources are fetched in parallel on every cache revalidation
cycle, and a failure in any one of them never prevents the page from rendering the rest.
**Verified:** 2026-09-22T18:40:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap-closure wave 4 (plan 02-04, commits d0d8585/300bfb2/ba62a49), which ran after the previous `passed` verification (2026-09-22T15:21:58Z, which itself post-dated and covered the earlier CR-01 socket-leak gap closure).

## Goal Achievement

This report covers two things per the verification brief: (1) a regression check that the
original INGEST-01/INGEST-02 architecture still holds unchanged by wave 4, and (2) a from-scratch
verification that UAT gap G-02-5 is actually closed by wave 4's new code, not just claimed in
02-04-SUMMARY.md.

### Part A — INGEST-01 / INGEST-02 Regression Check (unchanged by wave 4)

Wave 4's `files_modified` list (`src/lib/pipeline/truncateSummary.ts`, `normalize.ts`,
`ArticleCard.tsx`, plus docs) does not include `fanOut.ts`, `getFrontPage.ts`, `sources.ts`, or
`fetchSource.ts` — confirmed via `git log` (commits `d0d8585`, `300bfb2`, `ba62a49` touch only the
files 02-04-SUMMARY.md claims). All ingestion-architecture truths were re-run independently
rather than taken on the prior VERIFICATION.md's word:

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | All 13 sources configured, fetched concurrently via `Promise.allSettled` (INGEST-01) | ✓ VERIFIED | `sources.ts` re-counted: 13 entries; `fanOut.ts` unchanged; `node --test fanOutTiming.test.ts` re-run this session: 3/3 pass |
| 2 | `getFrontPage()` fans out/filters/sorts, never throws | ✓ VERIFIED | `getFrontPage.ts` unchanged; body still `sortByRecencyDesc(filterLookback(await fanOut(SOURCES)))` inside the unchanged try/catch |
| 3 | A deliberately-broken source never prevents the rest from rendering (INGEST-02) | ✓ VERIFIED | `node --test fanOut.test.ts fanOutTiming.test.ts sources.test.ts sortByRecencyDesc.test.ts` re-run this session: all pass (22 tests, 0 fail) |
| 4 | `fetchSource.ts`'s three early-return failure paths cancel the response body/reader before returning (the prior CR-01 fix) | ✓ VERIFIED | Re-read `fetchSource.ts` lines 74-78, 115-121, 137-143: all three `res.body?.cancel()` / `reader.cancel()` calls still present, unconditional, on the live execution path — untouched by wave 4's diff |
| 5 | Per-source failure remains invisible; no health/count/diagnostic reaches the page | ✓ VERIFIED | `page.tsx` still branches only on `result.status === "ok" ? result.articles : []` |
| 6 | Production build and lint are clean | ✓ VERIFIED | `npm run build` exit 0, static page prerendered; `npm run lint` exit 0, no output |

**Live-network finding (new, not a wave-4 regression, not a must-have failure):** re-running the
full suite in this session surfaced one failing test that passed in the prior verification pass
three hours earlier: `frontpage.e2e.test.ts`'s `fetchSource(Krebs)` test now gets
`{"status":"error","reason":"krebs: unexpected content-type \"text/html; charset=UTF-8\""}`
against the live `https://krebsonsecurity.com/feed/` endpoint. Independently confirmed via `curl`
(same headers as the app sends): the live origin currently returns HTTP 200 with a genuinely
valid RSS 2.0 XML body (confirmed by inspecting the response bytes) mislabeled with
`content-type: text/html; charset=UTF-8` — exactly the scenario `fetchSource.ts`'s own doc
comment (lines 123-133) names as a known Krebs behavior, but `sources.ts`'s `krebs` entry does not
set `allowHtmlContentType: true`. This is a live, external, time-variant condition (the same
`curl` request against the same URL returned the correct content-type in the prior verification
session) — not caused by any file wave 4 touched, and it does not fail any declared must-have: it
is, if anything, a real-world demonstration that INGEST-02 works, since `getFrontPage()`'s own
tests in the same run still return `status: "ok"` using the other 12 sources. Flagged here as an
ℹ️ Info/advisory finding (see Anti-Patterns) worth a follow-up (`allowHtmlContentType: true` for
`krebs`), not as a phase-blocking gap.

### Part B — UAT Gap G-02-5 Closure Verification (wave 4, plan 02-04)

Each 02-04-PLAN.md must-have truth, checked against the actual current code (not 02-04-SUMMARY.md's claims):

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 7 | Title and summary render inside the same fixed visual bound so no card is dramatically taller than its neighbours (code-level) | ✓ VERIFIED (code) | `ArticleCard.tsx:54,83` both carry `line-clamp-3`; compiled production CSS (`.next/static/chunks/2hw8js37tlrym.css`) contains `.line-clamp-3{-webkit-line-clamp:3;-webkit-box-orient:vertical;display:-webkit-box;overflow:hidden}` — the utility is real, not just referenced in source. **Whether it actually *looks* comparable across sources in a browser is a separate visual truth — see Human Verification.** |
| 8 | No summary reaches the render layer longer than the cap; the 26,744-code-point CISA worst case is cut at the data layer before entering the RSC payload | ✓ VERIFIED | `truncateSummary.ts` exports `SUMMARY_MAX_CHARS = 400`; `normalize.ts:45` wires `truncateSummary(...)` into `Article.summary`; `truncateSummary.test.ts` 7/7 pass (re-run) proving the code-point ceiling; `normalize.test.ts`'s 2 new wiring cases (line 128, 134) pass (re-run, 14/14 total) |
| 9 | A source with no summary (CrowdStrike, 0 chars) renders no summary element / no dead space | ✓ VERIFIED | `ArticleCard.tsx:82`: `article.summary.length > 0 ? <p>...</p> : null` — explicit length check, explicit `null` alternative, never a bare truthy `&&` |
| 10 | Title is never rewritten/re-cased/truncated at the data layer; only its rendered height is bounded | ✓ VERIFIED | `normalize.ts:40`: `title: item.title.trim()` unchanged from Phase 1; `truncateSummary` is never called on `item.title`; `normalize.test.ts`'s pre-existing verbatim-markup/entity test (line 51) still passes untouched |
| 11 | Summary truncation cuts on a word boundary, never mid-word without a marker, and never splits a surrogate pair | ⚠️ VERIFIED WITH KNOWN DEFECT | `truncateSummary.test.ts` proves this for the tested cases (7/7 pass, including the well-formed-surrogate-pair test), but 02-REVIEW.md's WR-01 identifies a real, unfixed logic bug: the 60%-floor boundary check mixes UTF-16 code-unit indices with code-point counts, silently defeating the word-boundary preference (not corrupting well-formedness — `isWellFormed()` still holds) for summaries with astral-plane characters ahead of a late whitespace run. The "never splits a surrogate pair" half of this truth holds; the "cuts on a word boundary" half has a documented, reproducible counter-example for a narrow input class. Non-blocking (warning-level per 02-REVIEW.md), but the truth is not unconditionally true as worded. |
| 12 | The Phase 1 no-clamp mandate amendment is recorded in writing in REQUIREMENTS.md, 02-CONTEXT.md, PROJECT.md, and cited from the component | ✓ VERIFIED | `REQUIREMENTS.md:30` UI-02 bullet amended in place citing `G-02-5`/`D-08`; `02-CONTEXT.md` has a full `D-08` entry (lines 30-40+) naming the superseded artifacts by line number; `PROJECT.md:96` has a new Key Decisions row citing plan `02-04`; `ArticleCard.tsx:19-29` cites D-08 inline |

**Score:** 12/13 truths cleanly verified; 1 (#11) verified-with-a-documented-defect (not blocking, tracked as a warning); Part A's 6 truths all hold unchanged = 16/17 overall (excluding the always-human visual-comparability half of #7, which is not counted as a pass or fail — see Human Verification).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/pipeline/truncateSummary.ts` | Pure, code-point-safe 400-char cap | ✓ VERIFIED | Exports `truncateSummary`, `SUMMARY_MAX_CHARS`; matches plan's exact export contract |
| `src/lib/pipeline/truncateSummary.test.ts` | Hermetic proof of cap/word-boundary/idempotency/surrogate-safety | ✓ VERIFIED (7/7 pass, re-run) | WR-01's edge case is a gap in coverage, not a failing assertion — no test exercises an astral+late-whitespace combination |
| `src/lib/pipeline/normalize.ts` | Wires the cap into `summary`; leaves `title` untouched | ✓ VERIFIED | Line 45 wiring confirmed; line 40 title path untouched |
| `src/components/ArticleCard.tsx` | Visual bound (line-clamp) + empty-summary omission | ✓ VERIFIED | Both fields clamped; conditional summary render confirmed; compiled into production CSS |
| `.planning/REQUIREMENTS.md` | Amended UI-02 text | ✓ VERIFIED | Line 30 |
| `.planning/phases/.../02-CONTEXT.md` | D-08 entry | ✓ VERIFIED | Present with rationale and superseded-artifact citations |
| `.planning/PROJECT.md` | Key Decisions row | ✓ VERIFIED | Line 96 |
| `src/lib/pipeline/fanOut.ts`, `getFrontPage.ts`, `sources.ts`, `fetchSource.ts` | Unchanged INGEST-01/02 architecture | ✓ VERIFIED | Confirmed unchanged by wave 4's commits; all hermetic tests re-run and pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `normalize.ts` summary assignment | `truncateSummary()` | direct call, line 45 | ✓ WIRED | |
| `ArticleCard.tsx` summary paragraph | length-conditional render | `article.summary.length > 0 ? <p>…</p> : null` | ✓ WIRED | |
| `02-CONTEXT.md` D-08 | `ArticleCard.tsx` inline citation | doc comment lines 19-29 | ✓ WIRED | Future reader is warned not to reinstate the old no-clamp gate |
| `getFrontPage()` | `fanOut(SOURCES)` | direct call in try body | ✓ WIRED | Unchanged |
| `fanOut()` | `fetchSource` / injected fetcher | `Promise.allSettled` | ✓ WIRED | Unchanged |

### Behavioral Spot-Checks / Test Re-Execution

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Cap + wiring unit proof | `node --test src/lib/pipeline/truncateSummary.test.ts src/lib/pipeline/normalize.test.ts` | 22/22 pass | ✓ PASS |
| Failure isolation + concurrency (INGEST-01/02) | `node --test fanOut.test.ts fanOutTiming.test.ts sources.test.ts sortByRecencyDesc.test.ts` | 22/22 pass (8002ms stall-isolation timing intact) | ✓ PASS |
| Production build | `npm run build` | exit 0, static page prerendered, TS check clean | ✓ PASS |
| Lint | `npm run lint` | exit 0, no output | ✓ PASS |
| line-clamp-3 actually compiled (not just source-referenced) | `grep line-clamp .next/static/chunks/*.css` | `.line-clamp-3{-webkit-line-clamp:3;...}` present | ✓ PASS |
| Full regression suite | `npm test` | 82/83 pass, 1 fail | ⚠️ 1 FAIL (see Part A live-network finding — external, not a wave-4 regression, not a must-have) |
| Live Krebs feed direct check | `curl -D- https://krebsonsecurity.com/feed/` | HTTP 200, valid RSS XML body, `content-type: text/html; charset=UTF-8` | ℹ️ Confirms the app's own test failure is a real, live, external condition, not a test-harness artifact |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|--------------|--------|----------|
| INGEST-01 | 02-01, 02-02, 02-03 | Fetches all 13 configured sources server-side, in parallel, on each cache revalidation cycle | ✓ SATISFIED | 13 sources configured; `Promise.allSettled` fan-out proven concurrent; architecture unchanged and re-tested after wave 4 |
| INGEST-02 | 02-01, 02-03 | A failure in one source does not prevent the page from rendering with the remaining sources' articles | ✓ SATISFIED | Hermetic real-socket tests pass; additionally reconfirmed live in this session — the real Krebs source is currently failing on content-type and `getFrontPage()` still returns `status: "ok"` using the other 12 |
| UI-02 (amended, wave 4) | 02-04 | Card text within a fixed visual bound; summary capped at the data layer; verbatim narrowed to "no editorial rewriting" | ✓ SATISFIED (code) / pending human visual confirmation | See Part B; visual comparability itself needs a human dev-server pass |

No orphaned requirements against this phase's declared IDs (INGEST-01, INGEST-02). `REQUIREMENTS.md`'s traceability table still lists both as "Phase 2 / Complete", consistent with the checkboxes.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/lib/pipeline/truncateSummary.ts` | 69-83 | WR-01 (02-REVIEW.md): 60% word-boundary floor mixes UTF-16 code-unit index with code-point threshold, silently defeated for astral-plane-heavy text ahead of a late whitespace run | ⚠️ Warning | Does not corrupt output (well-formedness holds) but can silently collapse the word-boundary preference for a narrow input class; no test currently catches it |
| `src/lib/pipeline/fetchSource.ts` | 52-61 | WR-02 (02-REVIEW.md): no-readable-stream fallback buffers the full body via `res.text()` before checking the byte cap, contradicting the function's own "never exhaust memory" doc comment | ⚠️ Warning | Pre-existing, not touched by wave 4; likely unreachable on Vercel/Node's undici fetch but code explicitly anticipates the case |
| `src/lib/pipeline/normalize.ts` | 45 | WR-03 (02-REVIEW.md): `item.content` fallback is not HTML-stripped and can now be cut mid-tag by `truncateSummary`, producing a visible broken-tag fragment | ⚠️ Warning | Rare path (only triggers when a feed omits `contentSnippet`); no XSS risk (JSX text-node rendering) |
| `src/lib/config/sources.ts` | `krebs` entry | Live finding (this session): Krebs currently serves valid RSS mislabeled `text/html`, and `krebs` has no `allowHtmlContentType: true`, so the real source is presently failing in a way the codebase's own comments anticipated but didn't configure for | ℹ️ Info (advisory, not blocking) | Failure isolation absorbs it correctly today; worth a follow-up config fix outside this verification's scope |
| — | — | No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers in any file this phase or wave 4 touched | — | Confirmed via grep |

**This looks intentional / already tracked, not something to override.** WR-01/02/03 are pre-existing 02-REVIEW.md findings (warning-level, none critical) already surfaced to the developer in that report; this verification does not treat them as new blockers, only re-confirms they remain unresolved and non-blocking.

### Human Verification Required

### 1. Article-card visual comparability across all 13 sources

**Test:** Load the running dev server; view the front page with all 13 sources contributing, at desktop width and at a ~375px mobile width. Compare card heights across sources (in particular CISA / CSO Online / SANS ISC — previously the longest — against Bleeping Computer / Ars Technica — previously already well-behaved). Also tab to a headline link and check the focus ring, and view the CrowdStrike card specifically.
**Expected:** No card's text block is dramatically taller than its neighbours'; a clamped summary shows a visible trailing ellipsis; the CrowdStrike card shows no empty-paragraph dead space between headline and timestamp; the focus ring on a tabbed-to headline is not clipped by the clamp's `overflow:hidden`.
**Why human:** This is the exact visual/subjective judgment UAT gap G-02-5 was originally raised on — a grep or unit test can prove the CSS class and the code-point cap exist and are wired (done above), but not that the rendered result "looks comparable" to a reader. The plan's own `<human-check>` block deferred this explicitly; it is logged in 02-04-SUMMARY.md as WINDOWS.md entry #4 (`kind: unrun-verify`) and has not been executed.

### Gaps Summary

No blocking gaps. The original phase goal (INGEST-01/INGEST-02: parallel fetch of all 13 sources,
failure in any one never blocking the rest) is unchanged and independently re-verified after wave
4 — none of wave 4's files touch the ingestion architecture, and all hermetic failure-isolation
and concurrency tests were re-run in this session and pass. UAT gap G-02-5 is closed at the code
level: a 400-code-point data-layer cap keeps a measured 26,744-code-point worst case out of the
payload, a compiled (not just source-referenced) `line-clamp-3` bounds both card fields visually,
the empty-summary dead-space case is handled, the title-verbatim guarantee is preserved untouched,
and the amendment to Phase 1's no-clamp mandate is recorded in all three documents a future reader
would consult plus cited in the component itself.

Two things keep this from a clean `passed`:

1. **Human verification required (routes status to `human_needed`, not a gap):** the plan's own
   deferred `<human-check>` — visual card-height comparability, ellipsis visibility, CrowdStrike
   dead-space absence, and focus-ring clipping — was never executed by the autonomous run and
   cannot be proven by static analysis. This is the single item blocking a `passed` verdict.
2. **Non-blocking, tracked-and-known:** 02-REVIEW.md's WR-01 (astral-plane word-boundary floor
   bug), WR-02 (no-stream fallback buffering), and WR-03 (unstripped `content` fallback) remain
   unresolved but were already flagged as warning-level, non-critical in that report and are
   carried forward here unchanged, not newly discovered blockers.

A third item was newly discovered in this session and is reported for transparency though it does
not affect the verdict: the live Krebs feed is presently returning a mislabeled `text/html`
content-type that `fetchSource.ts`'s own doc comments anticipated but `sources.ts`'s `krebs` entry
does not opt into — an external, time-variant condition unrelated to wave 4, which in practice
demonstrates (rather than threatens) INGEST-02's failure-isolation guarantee.

---

_Verified: 2026-09-22T18:40:00Z_
_Verifier: Claude (gsd-verifier)_
