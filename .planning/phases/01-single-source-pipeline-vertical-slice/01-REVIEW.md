---
phase: 01-single-source-pipeline-vertical-slice
reviewed: 2026-09-19T00:00:00Z
depth: standard
files_reviewed: 19
files_reviewed_list:
  - src/app/layout.tsx
  - src/app/page.tsx
  - src/components/ArticleCard.tsx
  - src/components/SourceTierBadge.tsx
  - src/lib/config/sources.ts
  - src/lib/formatRelativeTime.ts
  - src/lib/pipeline/fetchSource.ts
  - src/lib/pipeline/fetchWithValidatedRedirect.ts
  - src/lib/pipeline/filterLookback.ts
  - src/lib/pipeline/getFrontPage.ts
  - src/lib/pipeline/normalize.ts
  - src/lib/types.ts
  - src/lib/formatRelativeTime.test.ts
  - src/lib/pipeline/fetchWithValidatedRedirect.test.ts
  - src/lib/pipeline/filterLookback.test.ts
  - src/lib/pipeline/frontpage.e2e.test.ts
  - src/lib/pipeline/normalize.test.ts
  - test/fixtures/hostileRedirectServer.ts
  - test/productionPage.test.ts
findings:
  critical: 1
  warning: 5
  info: 3
  total: 9
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-09-19
**Depth:** standard
**Files Reviewed:** 19
**Status:** issues_found

## Summary

The pipeline's redirect-validation logic (`fetchWithValidatedRedirect.ts`) is well-built for the specific case it was designed and tested against: it rejects cross-host, non-HTTPS, and suffix/prefix-lookalike redirect targets using exact string equality on `URL.host`, bounds the hop count correctly (verified by tracing the loop against the 5-hop/6-hop tests), and clears its timers on every exit path. The UI layer (`ArticleCard`, `SourceTierBadge`, `page.tsx`, `layout.tsx`) renders all feed-supplied text through ordinary JSX text nodes with no `dangerouslySetInnerHTML` anywhere, so the stored-XSS threat this phase calls out (T-01-07) is correctly closed. No authentication surface, no hardcoded secrets, no `eval`, no obviously dangerous patterns.

However, tracing the *full* request lifecycle — not just the redirect-decision code path — surfaces one real gap in the timeout story the plan and threat model explicitly claim is closed: the per-hop `AbortController` only bounds the time to receive response *headers*; it is cleared before the response *body* is ever read, and `fetchSource.ts`'s body-reading loop (`readBodyWithCap`) has no timeout of its own. A slow-drip origin that sends headers immediately and then trickles the body indefinitely is not aborted by anything in this code — only by Vercel's platform-level function timeout, which is far larger than the "fresh 8s per hop" budget the code and its tests advertise. This is the review's one Critical finding; everything else below is a Warning or Info-level robustness/quality gap.

## Critical Issues

### CR-01: Per-hop timeout only covers response headers, not the response body — slow-body DoS is unmitigated

**File:** `src/lib/pipeline/fetchWithValidatedRedirect.ts:26-67`, `src/lib/pipeline/fetchSource.ts:81-89`

**Issue:** Each hop's `AbortController`/`setTimeout(..., TIMEOUT_MS)` pair is created immediately before `fetch(...)`, and `clearTimeout(timer)` runs in the `finally` block that executes as soon as `fetch()` resolves — i.e. as soon as response *headers* arrive, well before the body is consumed. `fetch()` in Node/undici resolves on headers, not on full body receipt, so by the time `fetchWithValidatedRedirect` returns `res` to `fetchSource`, the 8-second guard is already disarmed.

`fetchSource.ts` then calls `readBodyWithCap(res, MAX_BODY_BYTES)`, which loops `reader.read()` with **no `AbortSignal` and no time budget at all** — it only bounds the *size* of the body (2MB), never the *time* it takes to receive it. A hostile or merely slow/misbehaving origin can respond with valid headers instantly (passing every check) and then trickle bytes at an arbitrarily slow rate — e.g. one byte every few seconds, staying just under the 2MB cap — holding the connection, and the enclosing Vercel Function invocation, open far longer than the "fresh 8s AbortController per hop" the threat model (T-01-02) and this phase's own `must_haves` claim as the mitigation ("each hop gets its own fresh 8s AbortController, so a redirect chain cannot extend the per-hop time budget"; "A deliberately slow origin ... is aborted by the per-source timeout").

The hostile-fixture test suite (`fetchWithValidatedRedirect.test.ts`, `hostileRedirectServer.ts`) only exercises a `/hang` endpoint that **never writes any response at all** (headers never arrive), which the current code does correctly abort. It does not test — and the implementation does not handle — a origin that sends headers and then stalls mid-body. That branch is untested because it is unguarded, not because it's unreachable: it is exactly the kind of origin behavior a real (compromised or merely broken) RSS source can exhibit, and Phase 2 multiplies this from 1 source to 13.

**Fix:** Give the body-read phase its own bounded lifetime, ideally reusing the same per-hop budget so the *whole* hop (connect + headers + body) is capped, not just the connect/header portion:

```typescript
// fetchWithValidatedRedirect.ts — keep the controller alive for the caller
// to reuse across the body read, instead of only guarding fetch() itself.
export async function fetchWithValidatedRedirect(
  startUrl: string,
  init: RequestInit & { next?: { revalidate?: number } } = {}
): Promise<{ response: Response; signal: AbortSignal }> {
  // ...same validation loop...
  // On the terminal 2xx/non-redirect response, return the still-active
  // signal (with its own fresh timeout re-armed for the body-read phase)
  // alongside the response, instead of only the bare Response.
}
```

```typescript
// fetchSource.ts — bound the body read with a stall-aware timeout instead
// of an unbounded reader.read() loop.
async function readBodyWithCap(
  res: Response,
  maxBytes: number,
  signal: AbortSignal
): Promise<string> {
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error("Body read aborted (stalled origin)");
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error(`Response body exceeded ${maxBytes} byte cap`);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
}
```

At minimum, wrap the whole `fetch()` + body-read sequence in a single `AbortController` whose timer is armed once at the start of the hop and only cleared after the body is fully read (or re-armed with a short "stall" window on each chunk received), so "per-hop timeout" actually means what the tests and threat model claim it means. Add a fixture route to `hostileRedirectServer.ts` that sends headers immediately and then drips 1 byte every couple of seconds, and assert `fetchSource` still resolves to the error variant within a bounded time.

## Warnings

### WR-01: `normalize()` never validates that a feed item's `link` belongs to the source's own domain

**File:** `src/lib/pipeline/normalize.ts:17-38`

**Issue:** `normalize` validates only that `item.link` parses as a URL with an `https:`/`http:` scheme (T-01-04). It does not check that the link's host is the source's own domain (or a reasonable subdomain of it). `URL.host` deliberately excludes userinfo, which means a feed item whose `link` is e.g. `https://krebsonsecurity.com@evil.tld/x` passes every existing guard, is stored verbatim as `article.url`, and is rendered as a clickable outbound link under the "Krebs on Security" source name and tier badge — while actually navigating to `evil.tld`. The file's own doc comment states "every field arriving from the feed is untrusted external input," so this is a real gap relative to its own stated threat model, not merely a hypothetical: a compromised or maliciously-injected feed entry can make Havadis present an attacker's URL as if it were the trusted source's own article.

**Fix:**
```typescript
const parsedSourceHost = new URL(source.url).host;
if (parsedLink.host !== parsedSourceHost && !parsedLink.host.endsWith(`.${parsedSourceHost}`)) {
  return null; // link claims to be from `source` but resolves to a different host
}
```
Decide and document the exact policy (exact-host vs. subdomain-of-source) rather than leaving link-host validation absent entirely.

### WR-02: Untrusted XML is parsed with no documented entity-expansion / XXE hardening

**File:** `src/lib/pipeline/fetchSource.ts:91-102`

**Issue:** `parser.parseString(xmlText)` hands attacker-reachable XML (from an external, "untrusted" feed per this file's own comments) to `rss-parser`/`xml2js`. Nothing in this phase's code or its RESEARCH/PATTERNS docs evaluates whether the underlying parser disables external entity resolution or is resistant to entity-expansion ("billion laughs") payloads. The 2MB `MAX_BODY_BYTES` cap bounds the *serialized* XML size but does not bound in-memory expansion from nested entity definitions, which can blow up by several orders of magnitude from a small input. This is squarely in scope for a pipeline whose own documentation calls feed content "untrusted external input."

**Fix:** Confirm (and record in RESEARCH.md/PATTERNS.md) that the `xml2js`/`sax` stack `rss-parser@3.13.0` depends on does not expand DTD-declared entities by default; if it does, disable DTD processing or switch to a parser mode that rejects `<!DOCTYPE`/`<!ENTITY` declarations outright before calling `parseString`.

### WR-03: Response body is always decoded as UTF-8 regardless of the actual `Content-Type` charset

**File:** `src/lib/pipeline/fetchSource.ts:25-48`

**Issue:** `readBodyWithCap` always does `Buffer.concat(chunks...).toString("utf-8")`. The `content-type` header is checked only for the presence of the substring `"xml"` (line 74), never for its `charset` parameter. Phase 1's single source happens to serve UTF-8, so this doesn't manifest yet, but the function is otherwise written to be source-agnostic (per its own doc comments) and Phase 2 fans this exact function out to 12 more feeds. A source serving `ISO-8859-1`/`windows-1252` XML will silently produce mojibake in every title/summary rather than an error, and will not be caught by any existing test.

**Fix:** Parse the `charset` parameter from `content-type` and pass the corresponding `TextDecoder` encoding, defaulting to `utf-8` only when the header omits a charset:
```typescript
const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim() ?? "utf-8";
return new TextDecoder(charset).decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
```

### WR-04: Exact-`host`-equality redirect check rejects a legitimate same-origin redirect that includes an explicit default port

**File:** `src/lib/pipeline/fetchWithValidatedRedirect.ts:24,55-59`

**Issue:** `originalHost` is captured from `currentUrl.host` for the *configured* URL, which for `https://krebsonsecurity.com/feed/` omits the default port (`host === "krebsonsecurity.com"`). If a same-origin redirect target explicitly includes the default port (e.g. `Location: https://krebsonsecurity.com:443/feed/`, which some servers/CDNs emit), `target.host` becomes `"krebsonsecurity.com:443"`, which is not string-equal to `originalHost` and gets rejected as a "host mismatch" even though it is the same origin. This fails safe (over-rejects rather than under-rejects), so it is not a security hole, but it is a real correctness bug that would silently turn a healthy source into the D-03 empty state the moment any CDN in front of a Phase-2 source starts emitting explicit-port redirects.

**Fix:** Normalize both sides by comparing `URL.hostname` plus an explicit default-port-aware port comparison, or strip a trailing `:443`/`:80` that matches the URL's own protocol default before comparing.

### WR-05: 3xx redirect response bodies are never drained or canceled before the next hop is issued

**File:** `src/lib/pipeline/fetchWithValidatedRedirect.ts:39-61`

**Issue:** When a 3xx is received, the code reads `res.headers.get("location")` and moves on to the next hop without consuming or canceling `res.body`. Most redirect responses carry an empty or tiny body, so this is low-impact in practice, but leaving a response's body stream neither read nor explicitly canceled is a known source of socket/connection-pool leaks in undici-based fetch clients over a long-lived serverless instance.

**Fix:** `await res.body?.cancel();` (or drain it) before assigning `currentUrl = target` and continuing the loop.

## Info

### IN-01: `readBodyWithCap`'s no-stream fallback path bypasses the size cap entirely

**File:** `src/lib/pipeline/fetchSource.ts:26-28`

**Issue:** When `res.body` is falsy, the function falls back to `await res.text()` with no size enforcement at all, inconsistent with the capped path immediately below it. Low likelihood in practice (undici `fetch()` responses to a real GET normally carry a body stream), but it's a silent gap in an otherwise carefully-capped function.

**Fix:** Either remove the fallback (treat a missing body as an error) or apply the same byte cap by checking `res.headers.get("content-length")` before calling `res.text()`.

### IN-02: `MAX_BODY_BYTES` cap uses strict `>`, allowing a body of exactly the documented 2MB limit through

**File:** `src/lib/pipeline/fetchSource.ts:19,38`

**Issue:** The comment says the cap "matches the Vercel Data Cache's documented 2MB per-entry item size cap," but the check (`total > maxBytes`) permits a body of exactly `2 * 1024 * 1024` bytes to pass, which is already at the boundary the cache is documented to reject. A body landing exactly on that boundary risks a silent Data Cache write failure downstream rather than a clean, attributable error from this function.

**Fix:** Use `total >= maxBytes` or set `MAX_BODY_BYTES` slightly below the documented limit to leave margin.

### IN-03: Normalized `article.url` is stored from the raw, untrimmed `item.link` rather than the parsed/canonicalized URL

**File:** `src/lib/pipeline/normalize.ts:22,32`

**Issue:** `item.link` is validated by constructing `new URL(item.link)` (which tolerates and strips leading/trailing whitespace per the WHATWG URL spec), but the stored `url` field uses `item.link` verbatim rather than `parsedLink.toString()` or `parsedLink.href`. A feed emitting a link with incidental surrounding whitespace or non-canonical encoding would pass validation but render an `href` that isn't the canonicalized form actually used to validate it.

**Fix:** Store `url: parsedLink.href` instead of `item.link` so the validated and rendered URL are guaranteed to be the same string.

---

_Reviewed: 2026-09-19_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
