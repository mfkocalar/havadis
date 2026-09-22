---
phase: 02-full-ingestion-failure-isolation
reviewed: 2026-09-22T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/components/ArticleCard.tsx
  - src/lib/pipeline/fetchSource.ts
  - src/lib/pipeline/normalize.test.ts
  - src/lib/pipeline/normalize.ts
  - src/lib/pipeline/truncateSummary.test.ts
  - src/lib/pipeline/truncateSummary.ts
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-09-22T00:00:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Incremental review of the 02-04 gap-closure change (a new `truncateSummary` normalizer wired into `normalize.ts` and `ArticleCard.tsx` to close UAT G-02-5), plus `fetchSource.ts` — included because it changed (a response-body-cancellation fix) but had never itself been reviewed.

No security vulnerabilities, crashes, or data-loss risks were found; there is no XSS exposure (`ArticleCard.tsx` renders every feed-derived field as an ordinary JSX text node, never via a raw-HTML injection prop) and `truncateSummary`'s Unicode-code-point handling is well-formedness-safe (no split surrogate pairs). The `fetchSource.ts` body-cancellation fix itself is correct and complete for the return paths it targets.

Three warnings were found, all logic/robustness gaps rather than crashes:
1. `truncateSummary.ts`'s "cut must be at or beyond 60% of budget" floor check compares a UTF-16 code-unit index against a code-point-based threshold, silently defeating the floor for summaries containing supplementary-plane characters (emoji, some CJK-extension/mathematical-alphanumeric text) ahead of the cut point.
2. `fetchSource.ts`'s no-readable-stream fallback path buffers the entire response body before the size cap is checked, contradicting the function's own documented goal of never exhausting memory on an unbounded body.
3. `normalize.ts`'s `item.content` fallback is not HTML-stripped (unlike `contentSnippet`), so raw markup can reach `Article.summary` and now risks being cut mid-tag by `truncateSummary`, producing visible broken-tag text on the card — this also makes `ArticleCard.tsx`'s doc comment ("rss-parser already delivers an HTML-stripped snippet") inaccurate for this code path.

Two info-level items (a doc-comment accuracy note and a whitespace-only-title edge case) are also listed below.

## Warnings

### WR-01: 60% cut-boundary floor check mixes UTF-16 code units with code-point counts, silently defeating the floor for astral-plane content

**File:** `src/lib/pipeline/truncateSummary.ts:69-83`
**Issue:** `budget`/`minBoundary` are derived from the code-point slice (`Array.from(text).slice(0, budget)`), but `lastWhitespace = cut.search(...)` returns an index measured in UTF-16 code units of the reconstructed string `cut`. For text containing any supplementary-plane (surrogate-pair) characters before the last whitespace run inside the slice, the UTF-16 index is inflated relative to the true code-point offset, so the `lastWhitespace >= minBoundary` check can pass even when the real code-point position of the whitespace is well below the documented 60% floor.

Concrete repro: `"\u{1F512}".repeat(150) + " " + "b".repeat(2000)`. The true whitespace offset inside the 399-code-point slice is `150/399 ≈ 37.6%` — below the 60% floor and thus, per the comment's own stated intent, should be rejected (keeping the full budget). Instead, the UTF-16 index of that same whitespace is `300` (each preceding emoji costs 2 units), which clears `minBoundary = floor(399*0.6) = 239`, so the cut is accepted and the result collapses to ~151 code points instead of the intended ~399. This does not corrupt the string (search/slice stay self-consistent on the same UTF-16 string, so no lone surrogates result — `isWellFormed()` still holds), but it silently breaks the "don't collapse to a handful of words" guarantee the comment describes, for any summary with astral-plane text ahead of a late whitespace run.

**Fix:** Do the boundary comparison in code-point space consistently, e.g.:
```ts
const sliceCodePoints = Array.from(cut); // re-split cut by code point
const lastWhitespaceCp = sliceCodePoints
  .map((ch, i) => (/\s/u.test(ch) ? i : -1))
  .reduce((last, i) => (i >= 0 ? i : last), -1);
if (lastWhitespaceCp >= minBoundary) {
  cut = sliceCodePoints.slice(0, lastWhitespaceCp).join("");
}
```
(or otherwise convert `lastWhitespace` back to a code-point offset before comparing against `minBoundary`). Add a test that combines astral-plane characters *with* a whitespace boundary below/above the 60% mark — the existing astral test only checks length/well-formedness with no whitespace present, so it cannot catch this.

### WR-02: No-stream fallback in `readBodyWithCap` buffers the full body before the size cap is enforced

**File:** `src/lib/pipeline/fetchSource.ts:52-61`
**Issue:** The streaming branch enforces `maxBytes` incrementally and cancels the reader the instant the cap is exceeded, keeping memory bounded. The `!res.body` fallback branch does the opposite: it calls `await res.text()` — fully materializing the entire response body in memory — and only checks `Buffer.byteLength(text, "utf-8") > maxBytes` afterward. This directly contradicts the function's own doc comment ("erroring rather than exhausting the function on an unbounded stream"): in this branch, an unbounded body is fully read into memory before the cap can reject it. The path is presumably rare (most fetch implementations on Vercel/Node expose `res.body` as a `ReadableStream`), but the code explicitly anticipates and handles the case, so the gap is real for whatever runtime/polyfill would hit it.
**Fix:** Either remove the fallback (since it appears effectively dead on the target runtime) or enforce a hard `Content-Length`-independent read limit before buffering, e.g. reject early if `res.headers.get("content-length")` exceeds `maxBytes` as a fast-path guard, and/or document explicitly that this branch is a best-effort fallback with a known unbounded-buffering caveat rather than implying it shares the same guarantee as the streaming path.

### WR-03: `item.content` fallback is not HTML-stripped, and can now be cut mid-tag by `truncateSummary`

**File:** `src/lib/pipeline/normalize.ts:45` (pre-existing `??` fallback), interacting with `src/lib/pipeline/truncateSummary.ts:46-91` (new)
**Issue:** `summary: truncateSummary((item.contentSnippet ?? item.content ?? "").trim())` falls back to `item.content` when a feed omits `contentSnippet`. Per `rss-parser`'s own docs, `contentSnippet` is the HTML-stripped excerpt, but `content` is not — it can contain raw markup (`<p>`, `<img>`, entities, etc.). Because `ArticleCard.tsx` renders `article.summary` as a plain JSX text child (not `dangerouslySetInnerHTML`), there is no XSS risk, but any markup in `content` is displayed to the reader as literal visible text (e.g. `<p>Some text</p>`). The new `truncateSummary` cut makes this worse than before: a whitespace/length-based cut has no awareness of tag boundaries, so a long `content` fallback can now be truncated mid-tag (e.g. `...<img src="/foo.j…`), producing a more conspicuous broken-looking fragment than the untruncated raw markup previously would have. This also means `ArticleCard.tsx`'s doc comment claim that "`rss-parser` already delivers an HTML-stripped snippet" is not true for every code path that can populate `summary` (see IN-01).
**Fix:** Either strip HTML from the `content` fallback before it enters `Article.summary` (e.g. a small tag-stripping pass in `normalize.ts` for the `content`-fallback branch only), or drop the `content` fallback entirely and treat a missing `contentSnippet` the same as "no summary" (matching the CrowdStrike zero-summary case already handled by `ArticleCard.tsx`).

## Info

### IN-01: `ArticleCard.tsx` doc comment overstates the HTML-stripping guarantee

**File:** `src/components/ArticleCard.tsx:12-14`
**Issue:** The comment states "`rss-parser` already delivers an HTML-stripped snippet" as part of the justification for treating `article.summary` as safe plain text. That guarantee holds only for the `contentSnippet` source field, not for the `item.content` fallback `normalize.ts` uses when `contentSnippet` is absent (see WR-03). The lack of an XSS vector still holds (JSX text-node rendering escapes regardless of content), but the comment's stated reasoning is incomplete.
**Fix:** Either narrow the comment to say "field values are rendered as plain text regardless of their contents, so no HTML-stripping guarantee is relied on here" (removing the dependency on an assumption that doesn't hold end-to-end), or fix WR-03 so the assumption becomes true.

### IN-02: Whitespace-only `title` passes the presence guard and renders an empty headline link

**File:** `src/lib/pipeline/normalize.ts:27, 40`
**Issue:** `if (!item.title || ...) return null;` only rejects a missing or empty-string title. A feed item with `title: "   "` (whitespace only) is truthy and passes the guard, then `item.title.trim()` becomes `""`, producing an `Article` with an empty `title`. `ArticleCard.tsx` would then render `<a href="...">{""}</a>` — a card with a source badge and timestamp but no visible headline text or clickable label content.
**Fix:** Reject on the trimmed value instead: `const title = item.title?.trim(); if (!title || !item.link || !item.isoDate) return null;` and use `title` in the returned object.

---

_Reviewed: 2026-09-22T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
