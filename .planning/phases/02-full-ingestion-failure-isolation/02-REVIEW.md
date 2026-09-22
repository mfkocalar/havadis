---
phase: 02-full-ingestion-failure-isolation
reviewed: 2026-09-22T15:08:59Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/lib/pipeline/fanOut.ts
  - src/lib/pipeline/sortByRecencyDesc.ts
  - src/lib/pipeline/sortByRecencyDesc.test.ts
  - src/lib/pipeline/getFrontPage.ts
  - src/lib/config/sources.ts
  - src/lib/pipeline/frontpage.e2e.test.ts
  - src/components/SourceTierBadge.tsx
  - src/lib/config/sources.test.ts
  - src/lib/types.ts
  - src/lib/pipeline/fetchSource.ts
  - test/productionPage.test.ts
  - test/fixtures/hostileRedirectServer.ts
  - src/lib/pipeline/fanOut.test.ts
  - src/lib/pipeline/fanOutTiming.test.ts
findings:
  critical: 1
  warning: 4
  info: 2
  total: 7
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-09-22T15:08:59Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

The fan-out/failure-isolation design itself (`Promise.allSettled` in `fanOut.ts`, the never-throws contract on `fetchSource.ts`, the socket-level proofs in `hostileRedirectServer.ts` + `fanOut.test.ts`/`fanOutTiming.test.ts`) is sound and well-tested against real sockets, not just unit-mocked. The most serious finding is a genuine resource leak: `fetchSource.ts` discards `Response` objects on every early-return failure path (`!res.ok`, rejected content-type, and the byte-cap-exceeded path) without draining or cancelling `res.body`. Given this runs inside a long-lived Node process (`next start`, and Vercel's warm/Fluid Compute functions) on a recurring 15-minute revalidation cycle against 13 external hosts that are expected to fail sometimes, this leaks a socket on every occurrence and will accumulate over the process lifetime. Beyond that, there are a few robustness/consistency gaps worth fixing: `fanOut`'s isolation guarantee silently depends on `fetcher` never throwing synchronously, `frontpage.e2e.test.ts` enforces an https-only invariant that `normalize.ts` does not actually guarantee, and `fetchSource.ts` shares one mutable `rss-parser` `Parser` instance across all 13 concurrent parses, safe today only because of an undocumented, dependency-internal synchronicity assumption.

## Critical Issues

### CR-01: `fetchSource.ts` leaks the response body/socket on every early-return failure path

**File:** `src/lib/pipeline/fetchSource.ts:113-139, 143-154`
**Issue:** Node's global `fetch` (undici) only frees the underlying socket back to the connection pool once a `Response`'s body has been fully consumed or explicitly cancelled. `fetchSource` discards `res` without touching `res.body` in three places:
- `!res.ok` (line 113-118): returns immediately, leaving the error-page body (e.g. a 404/500 page) unread.
- content-type rejection (line 134-139): returns immediately, leaving the whole body unread.
- byte-cap exceeded inside `readBodyWithCap` (line 74-76): the function throws without calling `reader.cancel()` or aborting `controller`, so `res.body`'s underlying connection is left open and continues to be written to by the server; nothing in `fetchSource`'s catch block (line 144-154) aborts the controller either, and by the time `finally { clearTimeout(timer) }` runs, the scheduled timeout that would eventually abort it has been cleared — so the connection is never torn down by anything in this function.

This is not a one-off cost: every one of the 13 sources is fetched again on every ~15-minute Data Cache revalidation, and any source that is persistently down, misconfigured, or exceeds the 2MB cap (the exact scenario `MAX_BODY_BYTES` exists to guard against, per `sources.ts`'s own SANS ISC comment) will leak a socket on every single cycle for the lifetime of the process — both under `next start` (see `test/productionPage.test.ts`, a genuinely long-running process) and under Vercel's warm/Fluid Compute reuse model this project's own `AGENTS.md`/skill notes describe. Over time this exhausts the host's outbound connection pool for that origin and can turn a single flaky source into hangs/timeouts for otherwise-healthy requests.

**Fix:**
```ts
if (!res.ok) {
  await res.body?.cancel();
  return { status: "error", reason: `${source.id}: non-2xx status ${res.status}` };
}

// ...

if (!lowerContentType.includes("xml") && !(htmlOptIn && lowerContentType.includes("html"))) {
  await res.body?.cancel();
  return { status: "error", reason: `${source.id}: unexpected content-type "${contentType}"` };
}
```
And in `readBodyWithCap`, cancel the reader/stream (not just release the lock) before throwing on cap-exceeded, or have the caller abort `controller` on any `readBodyWithCap` failure so the underlying connection is actually torn down rather than merely stopping our own reads of it:
```ts
if (total > maxBytes) {
  const err = new Error(`Response body exceeded ${maxBytes} byte cap`);
  await reader.cancel(err).catch(() => {});
  throw err;
}
```

## Warnings

### WR-01: `fanOut`'s isolation guarantee assumes `fetcher` never throws synchronously

**File:** `src/lib/pipeline/fanOut.ts:29`
**Issue:** `Promise.allSettled(sources.map((source) => fetcher(source)))` only isolates failures that surface as *rejected promises*. If a `fetcher` implementation throws before it manages to return a `Promise` (a valid implementer of the `(source: SourceConfig) => Promise<FrontPageResult>` type signature, e.g. a non-`async` function with an early `throw`), `Array.prototype.map` itself throws synchronously, `Promise.allSettled` is never reached, and the exception propagates out of `fanOut` uncaught by anything in this file. That exception is then caught by `getFrontPage`'s outer `try/catch`, collapsing the *entire* page into the page-wide error variant — which is precisely the failure mode `fanOut`'s own header comment (lines 9-12) says `Promise.allSettled` exists to prevent. The default `fetchSource` is declared `async`, so it can't trigger this today, and `fanOut.test.ts`'s "rejected settlement" test only exercises an `async` throwing fetcher (which becomes a rejection, not a sync throw), so this gap is untested.
**Fix:** Make the guarantee hold regardless of what `fetcher` does, e.g.:
```ts
const settled = await Promise.allSettled(
  sources.map((source) => Promise.resolve().then(() => fetcher(source)))
);
```

### WR-02: `frontpage.e2e.test.ts` asserts an https-only invariant the pipeline does not actually enforce

**File:** `src/lib/pipeline/frontpage.e2e.test.ts:47-51`
**Issue:** This test asserts `new URL(article.url).protocol === "https:"` for every article returned by `getFrontPage()` against the live feeds. `normalize.ts` (the function that actually produces `article.url`) explicitly accepts both `http:` and `https:` links from third-party feed `<link>` items — that is a documented, deliberate part of its contract ("dropped unless its protocol is `https:` or `http:`"). Since these are live, externally-controlled RSS/Atom feeds, any of the 13 sources publishing a plain `http://` article link (common for older CMS setups) will make this e2e test fail — not because of a regression, but because the test enforces an invariant one layer of the pipeline does not provide.
**Fix:** Either loosen the assertion to match `normalize.ts`'s actual contract (`protocol === "https:" || protocol === "http:"`), or — if https-only is genuinely the desired product contract — tighten `normalize.ts` to reject `http:` links and add a unit test for that in `normalize.test.ts`, rather than leaving the contract only enforced by an e2e test against live, uncontrolled data.

### WR-03: Module-level `rss-parser` `Parser` instance is shared, mutably, across concurrent fan-out parses

**File:** `src/lib/pipeline/fetchSource.ts:31, 161`
**Issue:** `const parser = new Parser();` is a single module-scope instance reused by every call to `fetchSource`, and `fanOut` calls `fetchSource` for all 13 sources concurrently via `Promise.allSettled`. `rss-parser`'s `Parser` wraps one shared, mutable `xml2js.Parser` (`this.xmlParser`), which itself holds a shared, mutable `this.saxParser`. This is only safe today because `xml2js`'s default (non-`async`) parse path is fully synchronous end-to-end (write → emit `end` → `reset()` all happen within one synchronous call), so JS's run-to-completion semantics prevent two `parseString` calls from actually interleaving mid-parse — but that is an implementation detail of a third-party dependency, not a guarantee this codebase documents, tests, or controls. A future `rss-parser`/`xml2js` version (or an `options.async` change) that makes parsing genuinely asynchronous would let concurrent parses corrupt each other's in-progress state, since there is no per-call isolation.
**Fix:** Instantiate a fresh `Parser` per call (cheap — it's a small constructor) instead of a shared module-level singleton:
```ts
export async function fetchSource(source: SourceConfig): Promise<FrontPageResult> {
  const parser = new Parser();
  // ...
}
```

### WR-04: Concurrency timing assertion has thin margin, risking CI flakiness

**File:** `src/lib/pipeline/fanOutTiming.test.ts:37-63`
**Issue:** The concurrency proof requires `elapsed < 2000` after three 900ms-delayed fetches against three separately-spun-up local HTTP servers. That leaves only ~1100ms of slack to cover Node process/test startup overhead, three server binds, and scheduling jitter — on a loaded or resource-constrained CI runner this margin can be consumed by scheduling noise alone, producing a false-negative failure unrelated to any real concurrency regression in `fanOut`.
**Fix:** Widen the upper bound (e.g. `< 2500` or `< 3000`) — a sequential fan-out would still take ~2700ms, so there remains ample separation between "concurrent" and "sequential" without needing such a tight ceiling.

## Info

### IN-01: `readBodyWithCap`'s no-stream fallback does not actually enforce the cap during the read, contrary to its own comment

**File:** `src/lib/pipeline/fetchSource.ts:34-45, 52-61`
**Issue:** The function's header comment claims "Both the streaming path... and the no-stream path... enforce `maxBytes`... — neither path can return an uncapped or unabortable body." The no-stream branch (`if (!res.body)`) actually calls `await res.text()` to fully buffer the entire body into memory *before* checking `Buffer.byteLength(text, "utf-8") > maxBytes` — it validates the size only after the full, uncapped read has already completed, unlike the streaming branch which aborts mid-read. In practice this branch is likely unreachable under Node's built-in fetch (undici always exposes a `ReadableStream` body when content exists), but the comment overstates the guarantee this code path actually provides.
**Fix:** Either remove the now-effectively-dead fallback branch (if `res.body` is genuinely never null for a body-bearing response under this runtime), or correct the comment to note that the no-stream path only validates-after-buffering rather than capping-during-read.

### IN-02: `productionPage.test.ts` render-state check depends on exact literal HTML attribute ordering

**File:** `test/productionPage.test.ts:84-104`
**Issue:** `hasArticleAnchor` is detected via the regex `/target="_blank" rel="noopener noreferrer"/`, which only matches if React renders those two attributes in exactly that order and with exactly that spacing. This happens to match `ArticleCard.tsx`'s current JSX prop order, but attribute order is an implementation detail, not a contract — any incidental reordering of props in `ArticleCard.tsx` (with no behavioral change) would silently break this test's detection logic rather than the feature it's meant to verify.
**Fix:** Match on a less order-sensitive signal, e.g. two independent regexes (`/target="_blank"/` and `/rel="noopener noreferrer"/`) both required, or a lookahead-based pattern that doesn't depend on attribute order.

---

_Reviewed: 2026-09-22T15:08:59Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
