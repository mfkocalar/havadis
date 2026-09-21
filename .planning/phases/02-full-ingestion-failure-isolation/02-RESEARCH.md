# Phase 2: Full Ingestion & Failure Isolation - Research

**Researched:** 2026-09-21
**Domain:** Parallel fan-out ingestion + per-source failure isolation for a 13-source RSS/Atom aggregator (Next.js App Router on Vercel, no DB)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Source-Tier Badge Colors**
- **D-01:** Claude designs a cohesive 6-color palette for the 5 tiers still using the neutral default (Government, Enterprise Security, Threat Intelligence, Tech & General, Executive News), matching the existing Security Research indigo pill's visual style (soft background, ring, WCAG AA text contrast). No semantic mapping — colors differentiate tiers visually, they don't rank or categorize them.
- **D-02:** Red and orange are reserved — not used for any tier badge. Kept free for CVE-ID chips (Phase 3, CLASSIFY/UI-03) and urgency-tinted cues (Phase 4 section ordering).
- **D-03:** All 6 tier badges are equal visual weight — same pill size/shape/font-weight across all tiers, differentiated only by color. Government (CISA) does not get special prominence.
- **D-04:** Security Research's shipped indigo pill (`bg-indigo-50 text-indigo-700 ring-indigo-200`) stays locked exactly as-is; the other 5 colors are chosen to complement it, not the reverse. No changes to already-verified Phase 1 code for this component beyond adding new map entries.

**Failure Isolation / Silent Degradation**
- **D-05:** Per-source failure stays fully invisible to the reader, reconfirmed now that it's a real situation across 13 sources of very different posting cadence. A quiet source and a broken source look identical: zero contribution to the combined list, no distinction anywhere in the UI, no count, no indicator. Reconfirms HEALTH-01's v2 deferral.
- **D-06:** The extreme edge case — all 13 sources fail in the same revalidation cycle — reuses Phase 1's exact quiet-empty-state message verbatim (01-CONTEXT.md D-03). No new UI path distinguishing "everything failed" from "one source failed" or "genuinely zero articles in the window."
- **D-07:** No minimum-article-count floor before rendering. Even if only 1 of 13 sources succeeds and yields a single article, that article renders normally.

### Claude's Discretion
- Combined article-list ordering. `getFrontPage.ts` currently just concatenates articles in source-iteration order with no sorting. User explicitly deferred discussing this — Claude picks a reasonable interim order (most likely recency-descending across all combined sources) for the flat list that exists before Phase 3 builds real classification + ranking. This is a transitional choice Phase 3 will replace, not a lasting product decision.
- Exact hex/Tailwind color tokens for the 5 remaining tier badges, within the constraints above (no red/orange, equal visual weight, complements the locked indigo).
- CISA's specific posting cadence and any XML/feed-format quirks (flagged as a known unknown in 01-CONTEXT.md's Specifics section) — a research/implementation concern, not a product decision. Investigate when actually wiring CISA's `SourceConfig` entry.
- Parallel-fetch mechanism (`Promise.all` vs `Promise.allSettled` vs another pattern) and any concurrency staggering — purely technical, must preserve the existing never-throws-per-source contract `fetchSource` already implements.
- Whether to fetch all 13 sources with uniform per-source timeout (already ~8s, INGEST-03/Phase 1) or whether any source needs a different budget — technical, decide during planning if a specific source's real-world latency demands it.

### Deferred Ideas (OUT OF SCOPE)
None new this phase. HEALTH-01 (per-source health/diagnostics signal) remains explicitly deferred to v2 per REQUIREMENTS.md, reconfirmed by D-05 rather than revisited.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INGEST-01 | System fetches all 13 configured RSS/Atom sources server-side, in parallel, on each cache revalidation cycle | Architecture Pattern 1 (`Promise.allSettled` fan-out) gives the concrete replacement for `getFrontPage.ts`'s sequential loop. All 12 new source URLs were live-verified this session (Common Pitfalls 1-3) so the 13-entry `SOURCES` array can be built from confirmed-working canonical URLs rather than PROJECT.md's unverified table. Environment Availability confirms Vercel's current Hobby limits (300s duration, 1,024 file descriptors) give ample headroom for 13 concurrent connections. |
| INGEST-02 | A failure in one source (timeout, malformed XML, HTTP error, dead feed) does not prevent the page from rendering with the remaining sources' articles | Pitfall 5 / Architecture Pattern 1 explain why `Promise.allSettled` (not the `Promise.all` example in the existing doc comment) is the safer fan-out choice specifically for this requirement — it prevents a future regression in `fetchSource`'s never-throws contract from collapsing all 13 sources into a page-wide failure. Pitfall 1 (SANS ISC's oversized feed) and Pitfall 4 (multiple sources legitimately quiet right now) both confirm the existing `{status:"error"}`/silent-degradation contract (D-05) is already exercised correctly by real, live failure/quiet conditions across the widened source set. |

</phase_requirements>

## Summary

Phase 2 widens Phase 1's proven single-source pipeline to 13 sources. The pipeline shape, the never-throws `fetchSource` contract, and the discriminated `FrontPageResult` type are all already built and require zero changes. The only code that changes is: (1) `getFrontPage.ts`'s sequential `for` loop → a parallel fan-out, (2) `sources.ts` gains 12 more `SourceConfig` entries, (3) `SourceTierBadge.tsx`'s `TIER_STYLES` map gets 5 new color rows (already fully specified in `02-UI-SPEC.md`, not a research concern).

This session live-probed all 12 new feed URLs (not just read PROJECT.md's table) and found two concrete, verified problems the planner must account for: **SANS ISC's configured URL (`dailypodcast.xml`) is 5.7MB — nearly 3x over `fetchSource.ts`'s existing 2MB body cap — and will fail on every single revalidation cycle forever if wired in as-is.** A verified alternative URL (`https://isc.sans.edu/rssfeed_full.xml`, 47KB) returns fresh, valid, parseable content and should be used instead. Separately, **Recorded Future and CrowdStrike's PROJECT.md URLs both redirect** (one hop for Recorded Future, two for CrowdStrike) — following the same "Next's Data Cache doesn't store 3xx, so configure the canonical post-redirect URL" pattern `sources.ts` already documents for Krebs, both should be wired in with their canonical final URLs to avoid re-incurring an uncached redirect hop on every revalidation.

For the fan-out mechanism itself: this research recommends `Promise.allSettled` over the `Promise.all` example in `getFrontPage.ts`'s own doc comment — not because `fetchSource` needs it (it never throws, by contract and by Phase 1's closed threat register), but because `Promise.allSettled` is what keeps a *future regression* of that contract from taking down the whole page instead of one source, which is the entire point of INGEST-02. This is a small, deliberate belt-and-suspenders choice, not a correctness requirement of the current code.

Vercel's current platform limits (verified live against `vercel.com/docs/functions/limitations`, `last_updated: 2026-08-24`) give this phase generous headroom: Hobby-plan functions with Fluid Compute (the platform default for new projects) now default to a 300-second max duration and a 1,024 shared file-descriptor ceiling — 13 concurrent outbound connections at an 8s-per-source cap is nowhere close to either limit. No `maxDuration` export or connection-batching is needed.

**Primary recommendation:** Add the 12 remaining sources to `sources.ts` using the verified canonical URLs below (not PROJECT.md's literal table for the 2 redirecting sources and SANS ISC), convert `getFrontPage.ts`'s loop to `Promise.allSettled(SOURCES.map(fetchSource))`, and add a recency-descending `.sort()` on the combined article array immediately after the existing `filterLookback()` call — no other pipeline code changes are needed.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Parallel fetch fan-out / concurrency orchestration | API/Backend | — | `getFrontPage()` runs inside the Vercel Function invoked during Server Component render; no client involvement |
| Per-source failure isolation (discriminated result contract) | API/Backend | — | `fetchSource()`'s never-throws contract and `FrontPageResult` discriminant are pure backend/data-layer concerns |
| Source configuration (13 `SourceConfig` entries) | API/Backend | — | Static data module (`sources.ts`), not a UI or DB concern — matches "code change to edit" constraint (PROJECT.md) |
| Per-source fetch caching (Vercel Data Cache via `next.revalidate`) | API/Backend | CDN/Static | The Data Cache is documented (Vercel docs) as a platform caching layer adjacent to, but distinct from, the CDN edge cache; it is keyed and populated inside the Function's fetch calls, so backend is primary |
| Combined article-list ordering (interim recency sort) | API/Backend | — | Pure data transform inside `getFrontPage.ts`, before the view reaches any component |
| Tier badge color rendering (5 new palette rows) | Frontend Server (SSR) | — | `SourceTierBadge.tsx` is an ordinary (non-`"use client"`) Server Component; no client JS involved, per `02-UI-SPEC.md` |
| Redirect-target host validation (existing, unchanged this phase) | API/Backend | — | `fetchWithValidatedRedirect.ts` runs server-side before any response reaches the browser |

## Standard Stack

No new external packages are introduced by this phase. Every piece of this fan-out reuses code and dependencies Phase 1 already installed and verified.

### Core (unchanged from Phase 1 — reused as-is)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `rss-parser` | 3.13.0 | RSS 2.0 / Atom → normalized item shape | Already pinned and installed; `parser.parseString()` used identically across all 13 sources — no per-source parser configuration needed (verified this session: all 12 new sources' live feeds parse cleanly, see Package/Feed verification below) |
| `clsx` | 2.1.1 | Conditional Tailwind class composition | Already used by `SourceTierBadge.tsx`; the 5 new tier-color rows use the same `TIER_STYLES` map pattern, no new usage pattern introduced |

### Alternatives Considered
None — this phase deliberately does not introduce dedup, classification, or ranking infrastructure (out of scope per `02-CONTEXT.md`'s Phase Boundary), so no new library decision surfaces at all.

**Installation:** None required — `npm install` already reflects the full dependency set this phase needs.

**Version verification:** Not re-run this session since no package versions change. Phase 1's pinned versions (`rss-parser@3.13.0`, `clsx@2.1.1`) were already verified against the npm registry at project init (`.claude/CLAUDE.md` Technology Stack section, dated 2026-09-14) and remain installed per this session's `package.json` read `[VERIFIED: package.json]`.

## Package Legitimacy Audit

**Not applicable this phase.** No new external packages are installed. `rss-parser@3.13.0` and `clsx@2.1.1` were already gated and approved during Phase 1 / project init; re-running the legitimacy check against unchanged, already-installed versions would be redundant.

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  Vercel Function invocation (on cache-miss / 15-min revalidation)     │
│                                                                          │
│   page.tsx (Server Component)                                          │
│        │ await                                                         │
│        ▼                                                               │
│   getFrontPage()  ── orchestrator, no I/O of its own                   │
│        │                                                               │
│        ▼                                                               │
│   ┌────────────────── fan-out (Promise.allSettled) ─────────────────┐ │
│   │ fetchSource(CISA)  fetchSource(Krebs)  ...  fetchSource(CSO)    │ │
│   │  each: fetch() + next:{revalidate:900} (own Data Cache entry)   │ │
│   │  each: never throws — returns {status:"ok"|"error", ...}        │ │
│   └───────────────────────────┬─────────────────────────────────────┘ │
│                                ▼                                       │
│                    flatten "ok" results' articles                     │
│                    (an "error"/rejected settlement contributes         │
│                     zero articles — swallowed, not surfaced)          │
│                                ▼                                       │
│                    filterLookback(articles, 24h)                      │
│                                ▼                                       │
│                    sort by publishedAt, descending  ← NEW this phase  │
│                                ▼                                       │
│   page.tsx renders the flat card list (unchanged from Phase 1)        │
└──────────────────────────────────────────────────────────────────────┘

CACHE LAYER: 13 independent Data Cache entries, one per fetch() call/URL,
each on its own 15-min clock. A source's failure is never cached (Data
Cache only stores 2xx) — the next revalidation retries automatically.
```

### Recommended Project Structure

No new files or folders. Every change lands in a file that already exists and already anticipates this exact change:

```
src/lib/config/sources.ts       # add 12 SourceConfig entries (data-only diff)
src/lib/pipeline/getFrontPage.ts # for-loop → Promise.allSettled fan-out + sort
src/components/SourceTierBadge.tsx # 5 TIER_STYLES rows (per 02-UI-SPEC.md, not a research concern)
```

### Pattern 1: `Promise.allSettled` fan-out over a never-throwing fetcher

**What:** `getFrontPage()` maps `SOURCES` through `fetchSource` inside `Promise.allSettled`, then filters to fulfilled settlements whose value has `status: "ok"`.

**When to use:** Whenever the per-source contract ("never throws") is itself the safety property one specific requirement (here, INGEST-02) depends on. `fetchSource` already honors that contract — Phase 1's closed threat register (T-01-01 through T-01-20, `threats_open: 0`) confirms every failure path inside it resolves rather than rejects `[VERIFIED: .planning/phases/01-single-source-pipeline-vertical-slice/01-SECURITY.md]`. The reason to still prefer `allSettled` over the `Promise.all` example in `getFrontPage.ts`'s own doc comment is what happens if that contract is ever violated by a future edit: with `Promise.all`, a single unexpected `throw` inside any one `fetchSource` call propagates to `getFrontPage`'s own outer `try/catch` (`getFrontPage.ts:16,29-34`), which returns the page-wide `{status:"error"}` variant — i.e. a bug in *one* source's fetcher would silently take down *all 13* sources' worth of content, exactly the failure this phase exists to prevent. `Promise.allSettled` cannot propagate a single rejection into a whole-page failure: a rejected settlement is just another value in the results array to filter out, with the same "contributes zero articles" treatment as an `{status:"error"}` value.

**Trade-off:** A few extra lines to unwrap `PromiseSettledResult<FrontPageResult>` into the same flattening logic already used for the `"ok"` branch. `getFrontPage.ts`'s own doc comment example shows `Promise.all` — CONTEXT.md's "Claude's Discretion" section explicitly leaves this choice open, so `Promise.allSettled` is a discretionary but recommended upgrade over that doc comment's example, not a deviation from a locked decision.

**Example (adapted from this project's own `getFrontPage.ts`, illustrating the target shape):**
```typescript
// lib/pipeline/getFrontPage.ts — target shape, illustrative
export async function getFrontPage(): Promise<FrontPageResult> {
  try {
    const settled = await Promise.allSettled(SOURCES.map(fetchSource));
    const articles: Article[] = [];
    for (const outcome of settled) {
      if (outcome.status === "fulfilled" && outcome.value.status === "ok") {
        articles.push(...outcome.value.articles);
      }
      // A rejected settlement (should never happen, given fetchSource's
      // contract) or an {status:"error"} value are both swallowed here,
      // identically — same D-05 silent-degradation treatment as Phase 1.
    }
    const fresh = filterLookback(articles);
    fresh.sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );
    return { status: "ok", articles: fresh };
  } catch (err) {
    return {
      status: "error",
      reason: err instanceof Error ? err.message : "unknown getFrontPage error",
    };
  }
}
```

### Pattern 2: Combined-list interim ordering is a one-line sort, placed after the lookback filter

**What:** `02-CONTEXT.md`'s "Claude's Discretion" section defers combined-list ordering to this phase. Confirmed this session: it is a trivial, single `.sort()` call, not a design concern. `Article.publishedAt` is already an ISO 8601 string `[VERIFIED: src/lib/types.ts:32-33, quoted: "publishedAt: string; /** ISO 8601 published timestamp. */"]`, so `new Date(x.publishedAt).getTime()` is a direct, already-used comparator (the same pattern `filterLookback.ts:11` already uses: `new Date(article.publishedAt).getTime()`).

**Where it belongs:** After `filterLookback(articles)`, not before. Sorting before the lookback trim wastes comparator work on articles that get dropped immediately after; sorting after operates on the smaller, already-trimmed array. This has no effect on correctness (the filter is order-independent), only a negligible efficiency preference.

### Anti-Patterns to Avoid
- **Wrapping the 13-source fetch in a Route Handler "just in case a JSON API is needed later":** adds an HTTP round-trip and a second cache-key surface for zero benefit today — not needed until a real external consumer exists (v2 concern, per this project's own `.planning/research/ARCHITECTURE.md` Anti-Pattern 1).
- **Configuring a source's pre-redirect URL "because that's what PROJECT.md says":** Next's Data Cache only stores 200 responses (already documented in `sources.ts`'s own comment for Krebs); a source configured with a URL that 301s will re-incur that redirect, uncached, on every revalidation cycle forever. Verified this session that this applies to 2 of the 12 new sources (Recorded Future, CrowdStrike) — see Common Pitfalls below.
- **Trusting a feed's declared byte size never being tested:** SANS ISC's PROJECT.md URL was never spot-checked against `fetchSource.ts`'s own 2MB `MAX_BODY_BYTES` cap before this session — it is 5.7MB. See Pitfall 1 below.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Detecting "this source's fetch is stuck/slow" | A custom polling/heartbeat mechanism | The existing `AbortController` + `SOURCE_TIMEOUT_MS` budget already in `fetchSource.ts` (unchanged this phase) | Already built, already proven under load in Phase 1 (T-01-16, T-01-18); reused verbatim across all 13 sources with zero source-specific tuning needed (confirmed this session — no source in the live probe needed a longer budget) |
| Proving 13 fetches actually run concurrently, not sequentially | A production log-timestamp audit as the only verification | A local test using the existing `test/fixtures/hostileRedirectServer.ts` fixture, extended with 2-3 more delayed-but-completing routes (mirroring its existing `/drip-then-complete` pattern), asserting total elapsed time ≈ max(delays), not sum(delays) | This fixture already exists, is hermetic (binds `127.0.0.1` only), and already proves exactly this kind of timing property for the single-source timeout case — extending it is far cheaper than building new fixture infrastructure |
| Detecting a feed too large for the body cap | A guess-and-check in production | `curl -sS -o /dev/null -w "%{size_download}"` (or reading `Content-Length`) against each source's real feed URL during planning/build, before wiring it into `sources.ts` | Cheap, deterministic, already caught a real problem this session (SANS ISC) |

**Key insight:** Every mechanism this phase needs — timeout, redirect validation, byte cap, discriminated result, hermetic test fixture — was already built and proven in Phase 1 for one source. The only genuinely new work is widening the *data* (12 more `SourceConfig` rows, verified/corrected against live probes) and the *fan-out control flow* (one function's loop body). Resist the urge to add new abstraction layers for this.

## Common Pitfalls

### Pitfall 1: SANS ISC's configured feed URL is nearly 3x over the existing byte cap — verified, not theoretical

**What goes wrong:** `PROJECT.md`'s table lists SANS ISC's feed as `https://isc.sans.edu/dailypodcast.xml`. This session fetched that URL live: it is **5,721,795 bytes (5.7MB)** `[VERIFIED: live fetch this session, 2026-09-21, curl -sS against https://isc.sans.edu/dailypodcast.xml -o /tmp/cisa.xml equivalent, wc -c reported 5721795]`. `fetchSource.ts`'s `MAX_BODY_BYTES` cap is `2 * 1024 * 1024` (2,097,152 bytes) `[VERIFIED: src/lib/pipeline/fetchSource.ts:20, quoted: "const MAX_BODY_BYTES = 2 * 1024 * 1024;"]`. Every single fetch of this URL will throw `Response body exceeded 2097152 byte cap` inside `readBodyWithCap` (`fetchSource.ts:64`), which `fetchSource` correctly converts to `{status:"error"}` — so the page won't crash, but SANS ISC will contribute exactly zero articles on every revalidation cycle, forever, indistinguishable from a genuinely dead source (D-05).

**Why it happens:** `dailypodcast.xml` is SANS ISC's full podcast-episode archive feed (accumulated over years of daily episodes with full show-note bodies), not a rolling recent-items feed. PROJECT.md's source table was ported from the reference repo without re-verifying byte size against this project's own byte cap.

**How to avoid:** Use a different, verified SANS ISC endpoint instead: `https://isc.sans.edu/rssfeed_full.xml`. Verified this session: 47,453 bytes (well under the cap), `content-type: text/xml; charset=utf-8` (passes the content-type gate), and — critically — it parses cleanly through this project's actual installed `rss-parser@3.13.0` with 10 items, all carrying a valid `isoDate`, newest item dated the same day as the live check (2026-09-21) `[VERIFIED: node -e script this session using rss-parser@3.13.0 against the live-fetched body; output confirmed "total items: 10" and the newest item's isoDate as "2026-09-21T10:33:53.000Z"]`. This feed mixes SANS ISC's daily diary posts and its "Stormcast" podcast-episode announcements (not the full podcast archive) — both are legitimate Enterprise Security-tier content for this project's purposes.

**Warning signs:** A source silently contributing 0 articles on every cycle, with no error visible anywhere (by design, per D-05) — this is exactly why checking byte size *before* wiring in a source, rather than trusting a discovery-time source list, matters. This is a build-time verification step, not a runtime concern to code around.

### Pitfall 2: Two of the 12 new source URLs redirect — configure the canonical post-redirect URL, per the pattern `sources.ts` already documents

**What goes wrong:** `sources.ts`'s own comment already explains why Krebs's configured URL is the canonical post-redirect form: "Next.js's Data Cache only stores 200 responses, [so] configuring the pre-redirect URL would re-incur that redirect hop on every revalidation cycle forever" `[VERIFIED: src/lib/config/sources.ts:11-14]`. This session live-probed all 12 new PROJECT.md URLs with the exact `User-Agent`/`Accept` headers `fetchSource.ts` sends, and found 2 that redirect:

- **Recorded Future:** PROJECT.md's URL `https://www.recordedfuture.com/feed/` returns `HTTP/2 301` with `location: https://www.recordedfuture.com/feed` (same host, drops the trailing slash) `[VERIFIED: live curl -I this session against https://www.recordedfuture.com/feed/]`. The target, `https://www.recordedfuture.com/feed`, returns `HTTP/2 200`, `content-type: application/xml` `[VERIFIED: live curl this session]`.
- **CrowdStrike:** PROJECT.md's URL `https://www.crowdstrike.com/blog/feed/` returns `HTTP/2 301` → `https://www.crowdstrike.com/blog/feed` (same host, drops trailing slash), which itself returns **another** `HTTP/2 301` → `https://www.crowdstrike.com/en-us/blog/feed` (same host, added locale prefix), which finally returns `HTTP/2 200`, `content-type: application/rss+xml;charset=utf-8` `[VERIFIED: live curl chain this session, both hops confirmed same-host: www.crowdstrike.com]`. Two full redirect hops, both same-host (would pass `fetchWithValidatedRedirect.ts`'s host-equality check fine either way), but both wasted on every uncached revalidation if the pre-redirect URL is configured.

**Why it happens:** PROJECT.md's source table was compiled from the reference repo at project-init time and never re-verified live against this project's own redirect-following code, the same gap that produced Krebs's pre-redirect URL in the original PROJECT.md table (already caught and corrected for Krebs in Phase 1).

**How to avoid:** Configure `sources.ts` with the canonical, post-redirect URLs verified above:
- Recorded Future: `https://www.recordedfuture.com/feed` (no trailing slash)
- CrowdStrike: `https://www.crowdstrike.com/en-us/blog/feed`

Both were confirmed this session to parse cleanly with `rss-parser@3.13.0` (50 items / 10 items respectively, all with valid `isoDate`).

**Warning signs:** Same as Krebs's original gotcha — nothing crashes, the source just silently pays a wasted, uncached redirect round-trip on every 15-minute revalidation, forever. Not a correctness bug, a pure latency/efficiency one, but free to avoid.

### Pitfall 3: CISA's 2-digit RFC822 year format — checked, does NOT break `rss-parser`

**What goes wrong (checked, not found):** `02-CONTEXT.md` and `01-CONTEXT.md` both flag CISA's format/cadence as a known unknown worth investigating. This session fetched CISA's live feed (`https://www.cisa.gov/cybersecurity-advisories/all.xml`, 427,927 bytes, well under the byte cap) and found its `<pubDate>` values use a 2-digit year: `Fri, 18 Sep 26 12:00:00 +0000` (not `2026`) `[VERIFIED: live fetch this session]`. This is a legitimate concern to flag — a stricter RFC822 date parser could plausibly reject a 2-digit year. **Verified this session that it does not**: running the fetched body through this project's actual `rss-parser@3.13.0` produced `isoDate: "2026-09-18T12:00:00.000Z"` for every one of CISA's 30 items, with zero items missing an `isoDate` `[VERIFIED: node -e script this session, output: "items missing isoDate: 0 / 30"]`.

**Why it happens:** `rss-parser`'s internal date-normalization dependency tolerates 2-digit years (interpreting them in the current century) — a defensive design choice by that library, not something this project's code does.

**How to avoid:** Nothing to do — this is a non-issue, confirmed by direct test rather than assumed. Included here so the planner doesn't re-flag CISA's date format as an open risk requiring its own mitigation task; it doesn't.

**Warning signs:** N/A — refuted this session, not observed in practice.

### Pitfall 4: Several sources will legitimately contribute zero articles at any given moment — expected, not a bug

**What goes wrong (expected behavior, not a defect):** Live-probing all 12 new sources this session showed several with a newest item older than 24 hours as of the probe time (2026-09-21): Recorded Future's newest item was 2026-09-17 (4 days old), Microsoft Security Blog's was 2026-09-17, CrowdStrike's was 2026-09-17, TechCrunch Security's was 2026-09-19 `[VERIFIED: node -e rss-parser probe this session against each live-fetched body, newest isoDate reported per source]`. Under the 24h lookback filter (`filterLookback.ts`, unchanged this phase), each of these would contribute 0 articles on a refresh happening "now." This directly confirms `02-CONTEXT.md` D-05's premise — "a quiet source and a broken source look identical" — is a real, observed condition across multiple sources right now, not a hypothetical edge case CISA alone exercises.

**Why it happens:** Different publishers post at genuinely different cadences; this is exactly why D-05 exists.

**How to avoid:** Nothing — this is by design (D-05, D-07). Included here only so a future contributor doesn't mistake a quiet-but-healthy source for a bug during manual QA immediately after wiring the fan-out in.

**Warning signs:** N/A — expected. If concerned during manual verification, re-fetch the same source's URL directly and confirm its newest `pubDate`/`isoDate` really is outside the 24h window, rather than assuming a fetch/parse failure.

### Pitfall 5: A latent bug in the never-throws contract would silently defeat INGEST-02 under `Promise.all`, but not under `Promise.allSettled`

**What goes wrong:** Already covered in Architecture Pattern 1 above — repeated here as a pitfall because it's the single highest-leverage decision in this phase's plan. If `getFrontPage.ts` uses `Promise.all(SOURCES.map(fetchSource))` (the literal example in its own doc comment) and a future edit to `fetchSource.ts` or one of its dependencies (`normalize.ts`, `fetchWithValidatedRedirect.ts`) introduces a code path that throws instead of returning `{status:"error"}`, that throw propagates through `Promise.all`'s rejection into `getFrontPage`'s outer `catch` (`getFrontPage.ts:29-34`), which returns the page-wide error variant — collapsing 13 sources' worth of content into the same "No articles in the last 24 hours" empty state a reader can't distinguish from a genuinely quiet 24h window (D-06). This is the exact failure mode INGEST-02 exists to prevent, reintroduced by a mechanism choice, not by a missing catch block.

**Why it happens:** `Promise.all`'s example in `getFrontPage.ts`'s own comment predates this concern being made explicit; it was written when the contract was Phase 1's problem to prove, not Phase 2's problem to defend against regression.

**How to avoid:** Use `Promise.allSettled`, filtering to fulfilled settlements as shown in Pattern 1 above.

**Warning signs:** None observable today — `fetchSource`'s contract currently holds (Phase 1's threat register confirms `threats_open: 0`). This pitfall is about defending a currently-true invariant against future regression, not about a bug that exists right now.

## Code Examples

### Extending the existing hostile-fixture test pattern to prove parallelism (Success Criterion 1)

```typescript
// Illustrative extension of test/fixtures/hostileRedirectServer.ts's existing
// /drip-then-complete pattern — add N routes that each complete after a fixed
// delay, then assert wall-clock elapsed time for N concurrent fetchSource()
// calls is close to max(delay), not sum(delay). This fixture already exists
// and already proves an analogous timing property (T-01-16's re-verification
// used /drip-then-complete's ~331ms completion to pin the timeout budget's
// permissive boundary) — extend it rather than building new infrastructure.
const start = Date.now();
await Promise.allSettled(
  fixtureSourceConfigs.map((source) => fetchSource(source))
);
const elapsed = Date.now() - start;
// elapsed should be close to the slowest single fixture route's delay,
// not the sum of all fixture routes' delays.
```

### Verifying a feed's byte size before wiring it into `sources.ts` (the check that caught Pitfall 1)

```bash
curl -sS -o /dev/null -w "%{size_download} bytes\n" \
  -A "Mozilla/5.0 (compatible; HavadisBot/0.1; +https://havadis.app/about) automated cybersecurity news aggregator" \
  "https://isc.sans.edu/rssfeed_full.xml"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| This project's own `.planning/research/ARCHITECTURE.md` (2026-09-14) recommended explicitly setting `export const maxDuration = 30` given "Hobby-plan Functions default to a low duration ceiling (single digits of seconds) unless maxDuration is explicitly configured" | Verified live against `vercel.com/docs/functions/limitations` (`last_updated: 2026-08-24`) this session: Hobby-plan functions with Fluid Compute (the platform default for new projects) now have a **300-second default AND maximum** duration — no configuration needed to reach it `[CITED: vercel.com/docs/functions/limitations]` | Sometime between 2026-09-14 (this project's init research) and 2026-08-24's doc snapshot — Vercel's Hobby defaults changed under Fluid Compute's rollout | No `maxDuration` export is needed for this phase's 13-source parallel fan-out (worst case ≈ 8s + parse overhead, nowhere near 300s). Harmless to add defensively, but not a blocking requirement the way the project's own prior research implied. **Caveat:** whether *this specific* Vercel project has Fluid Compute active is a dashboard/project setting this session could not verify from the repo — see Open Questions. |

**Deprecated/outdated:** The 10-second Hobby duration ceiling assumption baked into this project's own `PITFALLS.md` and `ARCHITECTURE.md` (both dated 2026-09-14) is superseded by Vercel's current documented Hobby defaults. Not a blocking correction for this phase (this phase doesn't need the extra duration budget regardless), but worth knowing if a future phase's planning leans on the old 10s figure.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | This specific Vercel project has Fluid Compute enabled (the stated platform default for new projects), giving it the 300s Hobby duration ceiling rather than an older non-Fluid default | State of the Art, Environment Availability | Low — even the older ~10s-ish ceiling comfortably covers a ~8s-bounded parallel fan-out; only relevant if a future phase needs a much longer budget |
| A2 | Undici/Node's global `fetch` exposes a mechanism (e.g. a custom DNS lookup or dispatcher override) to validate a redirect target's *resolved IP*, not just its hostname string, for a future private-IP-denylist hardening pass | T-01-05 Threat Re-evaluation Groundwork | Low for this phase (no code change required now) — but if the security capability's threat modeling for this phase assumes this mechanism exists without verifying it, the actual hardening implementation could stall on an unverified technical assumption |

## Open Questions

1. **Is Fluid Compute actually active on this project's Vercel deployment?**
   - What we know: Vercel's current docs state Fluid Compute is the default for *new* projects, giving 300s Hobby duration; this repo has no `vercel.json` or other config overriding it.
   - What's unclear: Whether this project (created 2026-09-14 per PROJECT.md) was provisioned before or after that default took effect, and whether anyone has toggled it manually in the Vercel dashboard — neither is visible from the repo.
   - Recommendation: Not a blocker for this phase (headroom is ample either way). If precise confirmation is wanted, check the Vercel dashboard's Project Settings → Functions, or inspect a deployed function's logs for its configured max duration — not deferrable to code inspection alone.

2. **What exact mechanism would a future private-IP/DNS-rebinding hardening pass (T-01-05) use to check a redirect's *resolved* IP, not just its hostname string?**
   - What we know: `fetchWithValidatedRedirect.ts`'s current check is `target.host !== originalHost` (exact string equality on the hostname/port) — it says nothing about what IP that hostname resolves to at connection time. `01-SECURITY.md`'s AR-01 explicitly names "the 13-source hardening pass" (this phase) as where the accepted DNS-rebinding risk "becomes material," and PITFALLS.md's Pitfall 3 recommends checking the resolved target against a private/reserved-IP denylist before connecting.
   - What's unclear: Node's global `fetch` (undici) does not, by default, hand application code the resolved IP before connecting — implementing this would need either a custom DNS lookup preceding the fetch or a custom dispatcher/agent with a lookup override, neither of which this session verified against undici's actual current API surface.
   - Recommendation: This is explicitly the security capability's own threat-modeling responsibility for this phase (per `02-CONTEXT.md`'s canonical refs: "re-evaluate T-01-05's disposition during this phase's own threat modeling"), not something this research resolves. Flagging here only so the planner knows groundwork/context exists and doesn't attempt to silently defer or silently implement it without the security capability's involvement.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Live network access to all 13 feed origins | Fan-out fetch (INGEST-01) | ✓ (12/13 checked live this session; Krebs already proven in Phase 1) | — | If a source goes down between this session and implementation, `fetchSource`'s existing timeout/error handling already covers it — no fallback needed, that's the point of this phase |
| Vercel Fluid Compute (300s Hobby duration) | Headroom for 13 concurrent fetches | Unconfirmed for this specific project (see Open Questions) | — | Even without Fluid Compute, a ~10s-class default comfortably covers an 8s-bounded parallel fan-out; no blocking fallback needed |
| `rss-parser@3.13.0`, `clsx@2.1.1` | Feed parsing, badge styling | ✓ (installed, per `package.json` read this session) | 3.13.0 / 2.1.1 | N/A |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** Fluid Compute confirmation (fallback: even the more conservative default duration is more than sufficient for this phase's workload).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth anywhere in this app (UI-06); unaffected by this phase |
| V3 Session Management | no | No sessions exist |
| V4 Access Control | no | No protected resources exist |
| V5 Input Validation | yes | Every field from all 13 feeds remains untrusted external input, normalized through the existing `normalize.ts` (unchanged this phase): `link` gated to `https:`/`http:` protocol only, `title`/`isoDate` required or the item is dropped `[VERIFIED: src/lib/pipeline/normalize.ts:17-28]`. This phase widens the *number* of untrusted sources feeding this same validation, not the validation itself. |
| V6 Cryptography | no | No cryptographic operations in this phase |
| V12/V13 SSRF-adjacent (redirect-target validation) | yes | `fetchWithValidatedRedirect.ts`'s existing HTTPS-only + exact-host-equality check (unchanged this phase) — see Threat Re-evaluation Groundwork below for why this phase is where its current scope (hostname string equality, not resolved-IP validation) becomes materially more exercised |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SSRF via a compromised/rebound feed-host redirecting the server-side fetch to a private/internal address | Spoofing | `fetchWithValidatedRedirect.ts`'s HTTPS-only + exact-host-equality check, already in place; T-01-05 (accepted risk, Phase 1) explicitly named this phase as where the residual DNS-rebinding gap becomes material across 13 sources instead of 1 — full IP-resolution validation remains a groundwork item for the phase's own security capability to size, not resolved by this research (see Open Questions #2) |
| Malformed/oversized response body from any of the 13 origins consuming function memory/time | Denial of Service | `readBodyWithCap`'s existing `MAX_BODY_BYTES` cap (unchanged this phase) — verified this session to correctly catch a real 5.7MB feed (SANS ISC's PROJECT.md URL) before it would reach the parser |
| One source's slow/hanging origin stalling the whole revalidation cycle | Denial of Service | `fetchSource`'s existing per-source `SOURCE_TIMEOUT_MS` (8s) budget, now exercised concurrently across 13 origins instead of sequentially across 1 — Vercel's file-descriptor (1,024 shared) and duration (300s Hobby w/ Fluid Compute) ceilings both have ample headroom for 13 concurrent connections at this budget `[CITED: vercel.com/docs/functions/limitations]` |

## Sources

### Primary (HIGH confidence)
- Live probes of all 12 new source URLs this session (`curl` with the project's actual `User-Agent`/`Accept` headers) — confirmed redirect behavior, content-types, and byte sizes for Recorded Future, Microsoft Security Blog, SANS ISC, Dark Reading, CrowdStrike, Bleeping Computer, The Hacker News, Help Net Security, TechCrunch Security, Ars Technica, CSO Online, and CISA
- Live parse of every fetched feed body through this project's actual installed `rss-parser@3.13.0` (via `node -e`) — confirmed zero parse failures, zero missing `isoDate` fields across all 12 new sources, and specifically confirmed CISA's 2-digit-year `pubDate` format parses correctly
- `vercel.com/docs/functions/limitations` (fetched directly this session, `last_updated: 2026-08-24`) — Hobby duration (300s default/max with Fluid Compute), memory (2GB), file descriptors (1,024 shared), concurrency (auto-scales to 30,000)
- This project's own shipped source files, read directly this session: `src/lib/pipeline/fetchSource.ts`, `getFrontPage.ts`, `fetchWithValidatedRedirect.ts`, `normalize.ts`, `filterLookback.ts`, `src/lib/config/sources.ts`, `src/lib/types.ts`, `test/fixtures/hostileRedirectServer.ts`, `src/lib/pipeline/frontpage.e2e.test.ts`

### Secondary (MEDIUM confidence)
- WebSearch cross-check on Vercel Fluid Compute concurrent-connection behavior — did not surface an explicit documented per-invocation outbound-connection-count limit beyond the file-descriptor ceiling already confirmed via the primary source above

### Tertiary (LOW confidence)
- None relied upon for this research — every load-bearing claim above was either read directly from this project's own code or live-verified this session.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, nothing to re-verify
- Architecture: HIGH — every mechanism (timeout, redirect validation, byte cap, discriminated result) already shipped and proven in Phase 1; only the fan-out control flow and source data are new
- Pitfalls: HIGH — all three concrete pitfalls (SANS ISC byte cap, Recorded Future/CrowdStrike redirects, CISA date format) were live-verified this session against the actual project code and actual live feeds, not inferred from PROJECT.md's table alone

**Research date:** 2026-09-21
**Valid until:** Feed URLs and byte sizes are live external state that can drift — treat the specific URLs/byte-size findings as valid for roughly 30 days; the architectural/pipeline findings (fan-out pattern, sort placement, Vercel limits) are stable and not time-sensitive in the same way.
