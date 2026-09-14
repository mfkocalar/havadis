# Architecture Research

**Domain:** Server-rendered, stateless RSS aggregation web app (Next.js App Router on Vercel)
**Researched:** 2026-09-14
**Confidence:** HIGH (Next.js/App Router patterns) / MEDIUM (Vercel platform limits — verified via search but figures vary slightly by source and plan-version)

## Standard Architecture

### System Overview

```
┌───────────────────────────────────────────────────────────────────────┐
│  REQUEST TIME (Server Component render, Vercel Serverless Function)   │
│                                                                         │
│   page.tsx (Server Component)                                          │
│        │  calls                                                       │
│        ▼                                                               │
│   lib/pipeline/getFrontPage()  ─── orchestrator, no I/O of its own    │
│        │                                                               │
│        ▼                                                               │
│   ┌─────────────────────────── fan-out (parallel) ──────────────────┐ │
│   │  fetchSource(CISA)  fetchSource(Krebs)  ...  fetchSource(CSO)   │ │
│   │   fetch() + next:{revalidate:900}  → each cached independently  │ │
│   │   Promise.allSettled — one throw/timeout ≠ page failure         │ │
│   └───────────────────────────────┬───────────────────────────────── │
│                                    ▼                                  │
│                          normalize (per source)                       │
│                                    ▼                                  │
│                          trim to 24h lookback                         │
│                                    ▼                                  │
│                          dedupe (title+url key)                       │
│                                    ▼                                  │
│                          classify (7 sections, first-match keyword)   │
│                                    ▼                                  │
│                          rank (recency + source-tier weight)          │
│                                    ▼                                  │
│                          view model (flat Article[] w/ section field) │
│        │                                                               │
│        ▼                                                               │
│   Server Component renders newspaper layout, grouped by section       │
│        │  hydrates                                                    │
│        ▼                                                               │
│   Client Component: <CategoryFilter> — filters the already-rendered   │
│   snapshot client-side (no refetch, no server round-trip)             │
└───────────────────────────────────────────────────────────────────────┘

CACHE LAYER (Vercel Data Cache, keyed per fetch() call/URL, TTL 15 min)
— sits between "fetchSource" and the network. This is the *only*
persistence in the system. It is disposable and regenerable.
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `page.tsx` (Server Component) | Orchestrates render; calls the pipeline entrypoint; no business logic | Async Server Component, top-level `await` |
| Fetchers (`lib/sources/*`) | One `fetch()` per RSS source, per-source timeout/error isolation, own cache entry | `fetch(url, { next: { revalidate: 900 }, signal })` wrapped in try/catch, returns a result object (never throws) |
| Normalizer | Source-specific raw feed item → common `Article` shape | Pure function, one mapping table per source (most map cleanly to a shared RSS/Atom field set) |
| Lookback filter | Drop articles older than 24h | Pure function over `Article[]`, applied right after normalization |
| Deduplicator | Collapse same story across sources | Pure function, `Map` keyed by normalized `(title, url)` |
| Classifier | Assign each article to 1 of 7 sections | Pure function, ordered keyword/regex rule list, first-match-wins, default fallback |
| Ranker | Order articles within each section | Pure function, sort by `f(recency, sourceTier)` |
| View model builder | Shape final data for rendering | Pure function, flat sorted `Article[]` with `section` field attached |
| Server Component tree | Render newspaper layout grouped by section | Pure presentational components, receive view model as props |
| `<CategoryFilter>` (Client Component) | Toggle visible section(s) | `"use client"`, local `useState`, filters/hides pre-rendered data — **no new fetch** |

## Recommended Project Structure

```
src/
├── app/
│   ├── page.tsx                 # Server Component: calls getFrontPage(), renders layout
│   ├── layout.tsx                # Root layout, fonts, Tailwind globals
│   └── globals.css
├── components/
│   ├── SectionGroup.tsx          # Renders one section's articles (Server Component)
│   ├── ArticleCard.tsx           # Single article row/card (Server Component)
│   ├── CategoryFilter.tsx        # "use client" — filter control
│   └── SourceTierBadge.tsx       # Presentational
├── lib/
│   ├── config/
│   │   └── sources.ts            # 13 sources: url, name, tier, weight — single source of truth
│   ├── config/
│   │   └── sections.ts           # 7 sections + ordered keyword/regex rules, default section
│   ├── pipeline/
│   │   ├── fetchSource.ts        # fetch + parse one feed, returns SourceFetchResult (never throws)
│   │   ├── normalize.ts          # RawFeedItem → Article
│   │   ├── dedupe.ts             # Article[] → Article[]
│   │   ├── classify.ts           # Article → Article & { section }
│   │   ├── rank.ts               # grouped Article[] → sorted Article[]
│   │   └── getFrontPage.ts       # orchestrator: composes the above, the ONLY thing page.tsx calls
│   └── types.ts                  # Article, SourceConfig, Section, SourceFetchResult
└── ...
```

### Structure Rationale

- **`lib/pipeline/` as plain modules, not Route Handlers:** each stage is a pure (or fetch-only) function. This keeps the pipeline unit-testable in isolation (pass in fixture arrays, assert output) without spinning up HTTP.
- **`lib/config/sources.ts` and `lib/config/sections.ts` are data, not code paths:** adding/removing a source or tweaking a keyword rule is a one-line diff, matching the "no source-management UI, code change to edit" constraint from PROJECT.md.
- **One orchestrator function (`getFrontPage`):** `page.tsx` should call exactly one function. This is the seam that lets you test "does the whole pipeline produce a sane view model" independent of React rendering, and it's the one place that composes stage order — if the order ever needs to change (e.g., dedupe before or after lookback-trim), there's one call site to edit.

## Architectural Patterns

### Pattern 1: Server Component calls `lib/` directly — no Route Handler in the loop

**What:** `page.tsx` (or a nested Server Component) directly `await`s `getFrontPage()`, a plain async function in `lib/pipeline/`. There is no internal `/api/*` Route Handler that the page fetches over HTTP.

**When to use:** Whenever the only consumer of the data is the page itself (true here — no external API consumers, no mobile app, no webhook needed).

**Trade-offs:**
- Pros: no extra network hop (a Route Handler called from a Server Component means the same Vercel Function fetching itself over HTTPS — pure overhead, adds latency and a failure mode with zero benefit here); one fewer place for cache semantics to diverge; simpler to reason about and test (call a function, not fetch a URL).
- Cons: if you *later* need the same aggregated data outside the page (e.g., a JSON API, an RSS-out feed, a mobile client), you'd want to extract a Route Handler at that point — but that's a v2 concern, not a v1 one. Don't build it speculatively.

**Why this matters for per-source caching specifically:** Next.js's Data Cache is keyed at the individual `fetch()` call (URL + options), not at the page or Route Handler level. Each of the 13 `fetch(sourceUrl, { next: { revalidate: 900 } })` calls gets its own independent cache entry and its own 15-minute revalidation clock. That granularity is exactly what you want — one source revalidating doesn't invalidate the others — and it's preserved identically whether the fetch happens inside a Server Component's call graph or inside a Route Handler. Since there's no benefit to the Route Handler indirection here, skip it.

**Example:**
```typescript
// lib/pipeline/getFrontPage.ts
export async function getFrontPage(): Promise<FrontPageViewModel> {
  const results = await Promise.allSettled(
    SOURCES.map((source) => fetchSource(source))
  );

  const rawArticles = results
    .filter((r): r is PromiseFulfilledResult<SourceFetchResult> => r.status === "fulfilled")
    .flatMap((r) => r.value.articles);
  // note: fetchSource() itself never rejects (see Pattern 2) — allSettled is
  // belt-and-suspenders in case a truly unexpected throw slips through.

  const fresh = filterLookback(rawArticles, { hours: 24 });
  const deduped = dedupe(fresh);
  const classified = deduped.map(classify);
  return buildViewModel(rank(classified));
}

// app/page.tsx
export default async function Page() {
  const viewModel = await getFrontPage();
  return <FrontPage viewModel={viewModel} />;
}
```

### Pattern 2: Fetchers never throw — they return a discriminated result

**What:** Each per-source fetch+parse function catches everything internally (network error, timeout, malformed XML) and returns `{ status: "ok", articles } | { status: "error", source, reason }` rather than letting an exception propagate.

**When to use:** Always, for any of the 13 independent third-party feeds — you cannot control their uptime or feed validity, and the whole page must render regardless.

**Trade-offs:**
- Pros: `Promise.all` becomes usable (simpler types than `allSettled`, since failure is a normal value, not a rejection); the failure is a typed, inspectable value instead of a caught exception with `unknown` shape; failures are trivially loggable (`console.error` in Vercel function logs) and could later be surfaced in the UI (e.g., "1 source unavailable") without restructuring.
- Cons: slightly more boilerplate per fetcher (an explicit try/catch and a timeout wrapper) — worth it given 13 unreliable sources.

**Example:**
```typescript
// lib/pipeline/fetchSource.ts
export async function fetchSource(source: SourceConfig): Promise<SourceFetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(source.url, {
      next: { revalidate: 900 },
      signal: controller.signal,
      headers: { "User-Agent": "HavadisBot/1.0 (+https://havadis.example)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const parsed = await parseFeed(xml); // throws on malformed XML — caught below
    return { status: "ok", source, articles: parsed.map((i) => normalize(i, source)) };
  } catch (err) {
    console.error(`[fetchSource] ${source.name} failed:`, err);
    return { status: "error", source, reason: String(err) };
  } finally {
    clearTimeout(timeout);
  }
}
```
Note: a *thrown* fetch error is not cached by Next.js's Data Cache — only successful responses are cached — so a failed source is automatically retried on the next request after the revalidate window without any special retry logic.

### Pattern 3: Pipeline stages as pure functions over arrays (small-v1 merge guidance)

**What:** Normalize → dedupe → classify → rank are each a pure `Article[] → Article[]` (or `Article → Article`) function with no I/O.

**When to use:** Always for these four stages — none of them need to be separate services, API routes, or even separate files if you want to move faster; they need to be separate *functions* so each is independently testable with fixture data, but file/module boundaries are a judgment call.

**Trade-offs — what to merge for v1:**
- **Keep separate:** fetch (has I/O + failure modes) vs. everything else (pure). This is the one boundary that matters architecturally.
- **Safe to merge for v1:** normalize + lookback-filter can live in the same file/function (normalize-and-trim), since trimming is just one extra `.filter()` after mapping. Classify + rank are also fine merged into one `classifyAndRank(articles): Record<Section, Article[]>` if that reads cleaner — they're both simple, deterministic, pure transforms and neither is likely to be swapped independently in v1.
- **Keep separate even in v1:** dedupe. It has a distinct, easy-to-get-wrong algorithm (key construction, which duplicate to keep) and is the stage most likely to need isolated unit tests and later tuning (e.g., fuzzy title matching in v2) — worth its own function and test file from day one.

## Data Flow

### Request Flow (cache hit — the common case)

```
Browser request → Vercel Edge/CDN
    ↓ (Data Cache has a fresh entry for the derived page — ISR-style)
Cached HTML served directly, no Function invocation, no fetch to any RSS source
```

### Request Flow (cache miss / revalidation — happens ~every 15 min, in background)

```
Vercel Function invoked
    ↓
getFrontPage()
    ↓ (fan-out, parallel, Promise.allSettled)
13× fetchSource() → [ok|error] × 13
    ↓ (flatten "ok" results only)
normalize + trim(24h)
    ↓
dedupe (title+url)
    ↓
classify (7 sections, first-match keyword rule)
    ↓
rank (recency + source-tier weight, within each section)
    ↓
view model: flat Article[] with `section` field, sorted
    ↓
Server Components render newspaper layout (grouped by section)
    ↓
HTML + embedded view-model data sent to browser
    ↓
CategoryFilter (Client Component) hydrates, holds `activeSection` state,
filters the already-rendered DOM/data client-side — zero server round-trip
```

### Key Data Flows

1. **Ingestion fan-out:** 13 independent `fetch()` calls run concurrently (not sequentially) so total pipeline latency is bounded by the *slowest single source* (plus a hard per-source timeout), not the sum of all 13. This is what keeps the whole revalidation inside Vercel's function duration budget.
2. **Failure isolation:** a source's failure produces an empty contribution to `rawArticles`, not an exception — it flows through the rest of the pipeline as "zero articles from this source this cycle," never as a crash.
3. **Cache-then-compute:** the *inputs* (raw feed responses) are what Next.js caches per source; the *outputs* (deduped/classified/ranked view model) are recomputed on every request that isn't itself served from the full-route cache. This is fine at this traffic scale — the pipeline's CPU cost (parsing + array ops over a few hundred items) is trivial compared to the network I/O it replaces.
4. **Client filter never re-derives data:** the flat, classified, ranked `Article[]` is the single source of truth handed from server to client. The client only decides which subset to *display*; it never re-fetches, re-classifies, or re-ranks.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current design (public, no auth, ~13 sources) | Exactly as described. Data Cache absorbs virtually all traffic; Function only runs on background revalidation (~every 15 min), not per-visitor. |
| Traffic grows (viral spike) | No change needed — this is the scenario the fetch-cache architecture is *for*. All visitors during a 15-min window get the same cached HTML; the pipeline doesn't re-run per visitor. |
| More sources (13 → 40+) | Fan-out pattern still holds (`Promise.allSettled` over N), but watch the Vercel Function duration budget — verify `maxDuration` is set explicitly and per-source timeouts stay well under it; consider batching sources into a couple of parallel groups if N gets large enough that even parallel worst-case latency risks the ceiling. |
| Need historical/archive pages | This is the point where "essentially stateless" breaks down — would require a real store (Blob/KV/Postgres) to snapshot past pipeline runs. Explicitly out of scope per PROJECT.md; don't reach for it prematurely. |

### Scaling Priorities

1. **First real risk, even at v1 scale:** Vercel Function duration limit on the revalidation path. Hobby-plan Functions default to a low duration ceiling (single digits of seconds) unless `maxDuration` is explicitly configured (configurable up to 60s on Hobby, higher with Fluid Compute) — with 13 sequential fetches this could be exceeded even though each individual source is fast; the fan-out (parallel) pattern plus a strict per-source timeout (e.g., 8s) is the mitigation, not sequential fetching. Set `export const maxDuration = 30` (or similar) explicitly rather than relying on the default.
2. **Second-order concern:** a consistently slow/hanging source (not erroring, just slow) could drag out the whole revalidation cycle even in parallel mode if its timeout is too generous. Keep per-source timeouts short and uniform (8–10s) — a source is more useful showing zero articles this cycle than blocking the whole page.

## Anti-Patterns

### Anti-Pattern 1: Wrapping the pipeline in a Route Handler "just in case"

**What people do:** Build `/api/front-page` as a Route Handler that runs the whole ingestion pipeline and returns JSON, then have `page.tsx` `fetch()` that same-origin URL to get its data — "in case we need an API later."

**Why it's wrong:** Adds a full HTTP round-trip (DNS/TLS/handshake or at minimum an internal function invocation) to every single page render for zero benefit today; complicates cache-key reasoning (now there's a cache entry for the Route Handler's response *and* for each underlying source fetch); adds a failure mode (the self-fetch can itself time out or fail) that a direct function call cannot have.

**Do this instead:** Call `lib/pipeline/getFrontPage()` directly from the Server Component. If a real external API consumer shows up later (v2), extract a thin Route Handler at that point that itself calls the same `lib/` function — the refactor is trivial because the pipeline was already decoupled from the page.

### Anti-Pattern 2: One `fetch()` per feed but awaited sequentially in a `for` loop

**What people do:** `for (const source of SOURCES) { const r = await fetchSource(source); ... }` — easy to write, easy to reason about one-at-a-time, but each source's latency adds to the *next* source's wait, so total pipeline time ≈ sum of all 13 sources' response times.

**Why it's wrong:** With 13 independent third-party feeds (some notoriously slow), sequential awaiting can push total revalidation time past Vercel's Function duration limit, causing the *entire* revalidation to fail (and all sources to miss their cache refresh) even though 12 of 13 sources were healthy and fast.

**Do this instead:** `Promise.allSettled(SOURCES.map(fetchSource))` — concurrent fan-out, bounded by the slowest source's own timeout, not the sum.

### Anti-Pattern 3: Letting `rss-parser`/XML-parse exceptions escape the fetcher

**What people do:** Call the XML parser directly inside the pipeline's main flow without a local try/catch, assuming "if the HTTP fetch succeeded, the body must be valid RSS."

**Why it's wrong:** Malformed XML, HTML error pages served with a 200 status, truncated responses, and CDATA/encoding quirks are common across 13 different publishers' feed pipelines — a parse-time throw here, uncaught, propagates up and can fail the whole `getFrontPage()` call (or, if only caught at the top via `allSettled`, silently drops a whole source in a way that's harder to distinguish from a network failure for logging purposes).

**Do this instead:** Catch parse errors at the same boundary as fetch errors, inside `fetchSource()`, and return the same `{ status: "error", reason }` shape for both — one failure boundary per source, one type to reason about downstream.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| 13 RSS/Atom feeds (CISA, Krebs, Dark Reading, etc.) | Native `fetch()` per source, `next: { revalidate: 900 }`, own AbortController timeout | Treat every feed as untrusted and unreliable: some publishers rate-limit or block default user agents — send an explicit `User-Agent` header; some serve gzip without proper headers — `fetch()` handles standard cases but verify each of the 13 individually during Phase 1–2 build-out |
| Vercel Data Cache | Implicit, via `fetch()`'s `next.revalidate` option | This is the *only* persistence layer; no explicit cache API calls needed for v1 (no KV/Blob) |
| Vercel Serverless Functions (default runtime for the page's revalidation work) | Implicit — the Next.js build target | Explicitly set `maxDuration` on the route/page rather than relying on plan defaults, given 13 concurrent outbound calls |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `page.tsx` ↔ `lib/pipeline/getFrontPage()` | Direct async function call | No Route Handler; see Pattern 1 |
| `getFrontPage()` ↔ `fetchSource()` (×13) | `Promise.allSettled` over direct calls | Failure isolation happens here — this is the seam that must never let one source's problem propagate |
| Pipeline stages (normalize/dedupe/classify/rank) ↔ each other | Plain function composition, `Article[]` in/out | Pure, synchronous, no I/O — trivially unit-testable with fixture arrays |
| Server Component tree ↔ `<CategoryFilter>` (Client Component) | Props down (view model, serialized once at render) + client-local `useState` for the active filter | No server round-trip for filtering; the flat `Article[]` view model is the single shared data source for both server-rendered groups and client-side filtering logic |

## Suggested Build Order (MVP vertical slice → full v1)

The dependency chain is: **rendering shell → one real source → fan-out with failure isolation → dedupe → classify → rank → client filter → polish.** Each step is a shippable, demoable increment; nothing later blocks something earlier.

1. **Static shell.** Next.js App Router + Tailwind project, layout, a `SectionGroup`/`ArticleCard` component pair rendering **hardcoded fake articles** (no network). Proves the newspaper-style visual structure. Zero pipeline code yet.
2. **One real source, end-to-end.** Wire exactly one fetcher (e.g., CISA) → `normalize` → render its real titles/dates/links on the page, all articles dumped into a single section (no classification yet), no dedup (only one source, nothing to dedupe). This is the smallest slice that proves `fetch()` + `revalidate: 900` actually caches, that `normalize()`'s `Article` shape is workable, and that a real feed's quirks (encoding, missing fields) are handled. Apply the 24h lookback trim here too — it's cheap and belongs with normalization from the start.
3. **Fan-out to all 13 sources with failure isolation.** Add the remaining 12 `SourceConfig` entries and switch to `Promise.allSettled`. Deliberately point one source at a broken/unreachable URL during dev to prove the page still renders fully with 12/13 sources. This is the step where Pattern 1/2 (no Route Handler, fetchers-never-throw) and the timeout/`maxDuration` guardrails must be in place — don't defer them past this step.
4. **Deduplication.** Only meaningful once ≥2 sources can report overlapping stories — add the `(title, url)`-keyed dedupe stage now.
5. **Classification.** Port the 7-section keyword/regex ruleset from the reference repo; every article gets a `section`; default section (`INDUSTRY_POLICY`) as fallback.
6. **Ranking.** Recency + source-tier weight sort within each section.
7. **View model + grouped newspaper layout.** Build the flat, classified, ranked `Article[]` view model; render it grouped by section with real section headers (7 groups) instead of the single dumped list from step 2.
8. **Client-side category filter.** Add `<CategoryFilter>` as a Client Component over the already-rendered view model — no new server work, per PROJECT.md's own framing.
9. **Polish pass.** Mobile responsiveness, relative timestamps, source-tier badges, empty/error states (e.g., a section with zero classified articles this cycle), loading/skeleton state for the rare cold-cache request.

Do **not** front-load steps 4–6 before step 3 is solid — dedup/classify/rank are meaningless (and untestable with realistic data) until multiple real sources are flowing through the pipeline with failure isolation proven. Conversely, don't defer the failure-isolation guardrails (Promise.allSettled, per-source timeout, try/catch inside fetchSource) past step 3 "to add later" — retrofitting them after all 13 sources are wired in is exactly the scenario where a single flaky feed takes down the whole page during a demo.

## Sources

- [Next.js `fetch` API reference — `next.revalidate` semantics](https://nextjs.org/docs/app/api-reference/functions/fetch) — HIGH confidence, official docs
- [Next.js Caching (Previous Model) guide](https://nextjs.org/docs/app/guides/caching-without-cache-components) — HIGH confidence, official docs
- [Next.js ISR guide](https://nextjs.org/docs/app/guides/incremental-static-regeneration) — HIGH confidence, official docs
- [Vercel Functions Limits](https://vercel.com/docs/functions/limitations) — MEDIUM confidence, official docs (figures cross-referenced against secondary sources below since exact default vs. configurable duration varies by account/plan-version)
- [Vercel Limits overview](https://vercel.com/docs/limits) — MEDIUM confidence, official docs
- Secondary confirmation on Hobby-plan Function duration defaults/ceilings (10s default, up to 60s configurable on Hobby, up to 300s with Fluid Compute) — MEDIUM confidence, cross-checked across multiple third-party 2026 summaries; verify exact current numbers against `vercel.com/docs/functions/limitations` at implementation time since these figures do shift between plan-version rollouts
- General knowledge of Next.js App Router Server Component / Route Handler / Client Component boundaries and `Promise.allSettled` fan-out patterns — HIGH confidence, standard, stable patterns

---
*Architecture research for: Havadis (stateless RSS aggregation web app, Next.js on Vercel)*
*Researched: 2026-09-14*
