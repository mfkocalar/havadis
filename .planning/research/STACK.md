# Stack Research

**Domain:** Stateless, serverless, public daily security-news aggregation web app (RSS/Atom ingestion + rendering) on Vercel free tier
**Researched:** 2026-09-14
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Next.js (App Router) | 16.3.5 | Framework, Server Components, per-fetch Data Cache | Already decided. Verified against current Next.js docs: the classic `fetch(url, { next: { revalidate } })` Data Cache model **still exists as a first-class layer in Next.js 16** — it is not removed or deprecated, only *superseded* if you opt into the new "Cache Components" model (`cacheComponents: true` + `'use cache'`). Since this project doesn't need `use cache`'s extra machinery, stay on the default (Cache Components **off**) and use plain `fetch` + `next.revalidate`, exactly as already decided in PROJECT.md. |
| React | 19.3.0 | UI runtime (via Next.js) | Pinned automatically by `create-next-app`; no action needed, just don't downgrade. |
| TypeScript | 5.x (NOT 7.x, see note) | Type safety | **Do not install the bare `typescript@latest` (7.0.2)** — that's the new native-compiled TS-Go-based major version line; Next.js 16's toolchain and most current ecosystem tooling still targets the TS 5.x line. Pin `typescript@^5.7` explicitly rather than trusting `npm install -D typescript` to grab latest. |
| Tailwind CSS | 4.3.3 | Styling, "newspaper" responsive layout | v4 is CSS-first (no `tailwind.config.js` required) via `@import "tailwindcss";` in `globals.css` + `@tailwindcss/postcss` in `postcss.config.mjs`. `create-next-app --tailwind` scaffolds this correctly out of the box for Next 16. Confirmed current install path against tailwindcss.com/docs/guides/nextjs. |
| Vercel (Hobby/free plan) | — | Hosting, CDN, Data Cache, Function runtime | Already decided. Confirmed 2026 Hobby limits relevant to this app (see Pitfalls/limits table below): 100GB bandwidth/mo, ~100K function invocations/mo, Fluid Compute default (up to 300s execution, far more than an RSS fetch+parse needs), Data Cache item size cap 2MB per entry (a single RSS feed response is comfortably under this). |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `rss-parser` | 3.13.0 | Parse RSS 2.0 **and** Atom XML into one normalized item shape | Use for all 13 feeds. Confirmed via source (rbren/rss-parser README) and npm: `parser.parseString(xmlText)` parses a **raw XML string** you already fetched — it does not force you to use its own internal `parseURL` HTTP client. This is exactly the seam this project needs: `fetch(url, { next: { revalidate: 900 } })` gets the raw text (native fetch, cached by Next's Data Cache), then hand that text to `rss-parser` for structural normalization only. It also transparently normalizes RSS-vs-Atom differences (e.g. Atom's `updated` → `lastBuildDate`) into one consistent item shape (`title`, `link`, `pubDate`, `isoDate`, `content`, `contentSnippet`, `creator`, `guid`, `categories`) — critical since the 13 sources are a mix of RSS 2.0 and Atom feeds and the app needs one common shape to dedupe/classify/rank against. |
| `fast-xml-parser` | 5.11.1 | Fallback low-level XML parser | Only reach for this if one specific feed's XML is malformed/non-standard enough that `rss-parser`'s `customFields` option can't cleanly extract what's needed (rare, but SANS ISC's podcast-style feed or CISA's .xml advisory feed are the most likely candidates to need a peek). Don't make it the primary parser — it returns a generic XML-as-JSON tree, not a normalized RSS/Atom item shape, so you'd re-implement RSS/Atom normalization yourself for no benefit over `rss-parser`. |
| `clsx` | 2.1.1 | Conditional Tailwind class composition | Use for anything with more than one conditional class (active filter tab, source-tier badge color variants). Trivial (240 bytes), avoids template-literal class string bugs. |
| `tailwind-merge` | 3.7.0 | Resolve conflicting Tailwind classes when composing | Only needed if you build a shared `<Badge>`/`<Card>` component that accepts a `className` override prop and want caller classes to correctly win over defaults. Skip it if components don't take class overrides — for a v1 this small, you likely don't need it; add only if you hit a real conflict. |
| `@tailwindcss/typography` | 0.5.20 | Prose styling plugin | Optional — only useful if article summaries are rendered as raw/rich HTML blocks needing default prose spacing. If summaries are plain-text snippets styled with your own card layout (more likely for a "newspaper front page" of headlines+snippets), skip this; it adds a plugin dependency for a look you can get with 3-4 utility classes. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| ESLint (`eslint-config-next`) | Lint | Ships with `create-next-app`; keep default Next.js + Core Web Vitals rule set. |
| `vercel` CLI | Local dev parity, `vercel dev`, log/metric inspection | Useful for confirming actual `x-vercel-cache` header behavior (HIT/STALE/MISS) once deployed — see Pitfalls note on verifying SWR in production, not just locally. |

## Installation

```bash
# Scaffold (already effectively decided, shown for completeness)
npx create-next-app@latest havadis --typescript --tailwind --app --eslint

# Core ingestion
npm install rss-parser@^3.13.0

# Optional fallback XML parser (install only if/when a feed needs it)
npm install fast-xml-parser@^5.11.1

# Supporting UI utilities
npm install clsx@^2.1.1

# Optional, add only if you hit a real class-conflict case
npm install tailwind-merge@^3.7.0

# Pin TypeScript to the 5.x line explicitly (see "What NOT to Use")
npm install -D typescript@^5.7
```

No `date-fns` install is recommended for v1 — see rationale below.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| `rss-parser` for feed parsing | `fast-xml-parser` as primary parser | If you were building a generic multi-format feed platform (JSON Feed, arbitrary XML dialects) rather than a fixed 13-source RSS/Atom list — the extra normalization work `fast-xml-parser` requires only pays off at that scale. |
| `rss-parser` for feed parsing | `feedparser` / `feedme` (streaming parsers) | If a feed were multi-megabyte or you needed streaming/backpressure. None of the 13 sources are anywhere near that size; streaming adds complexity with no payoff here. |
| Plain Tailwind utilities + `clsx` | `shadcn/ui` (Radix + Tailwind component layer) | If v2 adds real interactive surfaces — modals, dropdowns, comboboxes, accessible dialogs. `shadcn/ui` is free (you own the copied code, no runtime license), and is Vercel's own recommended component layer, so it's not ruled out for cost reasons. For v1's actual UI (a card grid, section headers, a client-side filter, and small badges) it adds Radix primitives and generated component files you don't need yet — hand-rolled Tailwind is less code to maintain for this scope. Revisit if the filter UI grows into tabs-with-keyboard-nav or a command palette. |
| Hand-rolled relative-time formatter | `date-fns` `formatDistanceToNow` | If the 24h lookback window constraint (PROJECT.md) is ever relaxed to show multi-day/week-old content, or if the app needs locale-aware/i18n time formatting. At that point date-fns's correctness (pluralization, locale data) starts to outweigh its size. |
| Next's native fetch Data Cache | `unstable_cache()` wrapping a custom fetch | If the ingestion function needed to cache a *derived* value (e.g., the fully classified+ranked+deduped article list) rather than each raw feed fetch. Not needed for v1 since deriving the front page from 13 already-cached raw fetches is cheap (string parsing + array ops), well within function execution budgets — no reason to add another cache layer. If profiling later shows classification/ranking itself is expensive, `unstable_cache` (Next 15 API, still present in Next 16 outside Cache Components) or migrating to `'use cache'` are the next steps, not v1 scope. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|--------------|
| `date-fns` (or any date-formatting library) for v1's relative timestamps | The app's own 24-hour lookback window (PROJECT.md) means every displayed timestamp is always "under a day old." That collapses relative-time formatting to three cases — minutes, hours, "just now" — a ~15-line pure function handles this completely and correctly with zero dependency risk (no locale/tree-shaking edge cases like the ones tracked in date-fns's own GitHub issues around bundler tree-shaking regressions). Pulling in a formatting library for a problem this constrained is dependency weight with no payoff. | Hand-rolled `formatRelativeTime(isoDate: string): string` utility, unit-tested directly (feeds a "few minutes ago / N hours ago" style string). |
| `cacheComponents: true` (Next.js 16 Cache Components / `'use cache'`) for this ingestion pipeline | It's the *newer* caching paradigm, but it changes the mental model (closures become part of cache keys, no `cookies()`/`headers()` inside cached functions, needs `cacheLife`/`cacheTag` instead of `next.revalidate`) for a benefit this project doesn't need — the per-fetch Data Cache with `next.revalidate` already gives exactly the "15-minute stale-while-revalidate, no cron/DB" behavior PROJECT.md specifies, and is officially confirmed (Vercel docs, updated 2026-08-21) to remain a fully supported, separate layer in Next.js 16 when Cache Components is off. Adopting Cache Components here is a net-new migration cost for zero behavior change. | Default Next.js config (Cache Components off) + `fetch(url, { next: { revalidate: 900 } })` per source, exactly as already decided. |
| `rss-parser`'s built-in `parseURL()` for the actual fetching | It uses Node's raw `http`/`https` client internally, which is invisible to Next.js's Data Cache — you'd lose the entire "don't refetch on every request" behavior this app is built around, and would have to reimplement caching yourself (e.g. hand-rolled TTL memoization), duplicating what `fetch` + `next.revalidate` already gives for free. | Native `fetch(url, { next: { revalidate: 900, tags: [sourceId] } })` to get the raw XML text, then `parser.parseString(xmlText)` to structure it. |
| Any paid UI kit / component marketplace (e.g. paid shadcn-adjacent registries, Tailwind UI paid blocks) | Explicitly out of budget per PROJECT.md's free-tier constraint, and unnecessary — the actual UI surface (headline cards, section groupings, tier badges, a client-side category filter) is standard enough to build directly in Tailwind utilities. | Plain Tailwind CSS + `clsx`, optionally free `shadcn/ui` components (MIT-licensed, code you own) if/when interactive components are needed later. |
| Vercel Cron as the *only* mechanism for keeping the cache warm, assuming it can run every 15 minutes | **Confirmed (2026): Vercel Hobby plan cron jobs are capped at once per day, and at most 2 cron jobs per project.** A cron expression more frequent than daily (e.g. every 15 min) fails at deploy time on Hobby with "Hobby accounts are limited to daily cron jobs." This directly affects the mentioned "optional v1.1 Vercel Cron pre-warm" — it cannot replicate the 15-minute revalidation window on the free tier; it can only do one pre-warm pass per day. | For v1, keep relying purely on visitor-triggered `fetch`+`revalidate` (as already decided — no cron needed for v1). If a v1.1 pre-warm is still wanted on the free tier, either (a) accept a **once-daily** Vercel Cron warm instead of a 15-min one, or (b) use a free external scheduler (e.g. a GitHub Actions scheduled workflow, or a third-party free cron pinger) to hit a lightweight Route Handler every 15 min — this stays outside Vercel Cron's daily cap without paying for Vercel Pro. Flag this explicitly as a decision point if v1.1 is scoped. |
| `typescript@latest` installed blindly | As of registry check (2026-09-14), bare `latest` resolves to `7.0.2`, a new major line; pinning to whatever "latest" happens to be at scaffold time risks picking up a version ahead of what the rest of the ecosystem (Next.js 16's own toolchain, ESLint configs) has stabilized against. | Pin explicitly: `typescript@^5.7` (or whatever 5.x `create-next-app` scaffolds — check the generated `package.json` and keep that range). |

## Stack Patterns by Variant

**If a specific feed's Atom/RSS output breaks `rss-parser`'s default field mapping (e.g. missing `pubDate`, nonstandard namespaced fields):**
- Use `rss-parser`'s `customFields` option (`{ item: [['custom:field', 'aliasName']] }`) to extract it
- Because this stays inside the same normalized-item pipeline rather than forking to a second parser for one source

**If ingestion/classification logic later grows expensive enough that per-request CPU time becomes a concern (unlikely at 13 sources/24h lookback, but worth naming):**
- Wrap the *derived* (classified + deduped + ranked) result in `unstable_cache()` (Next 15/16 API, still available outside Cache Components) keyed on nothing but a coarse time bucket, rather than re-deriving on every cache-cold request
- Because this adds one more cache layer without requiring the Cache Components migration

**If v1.1 adds the optional pre-warm job:**
- Use a **once-daily** Vercel Cron (Hobby-legal) calling a Route Handler that simply performs the same 13 fetches (populating Data Cache before the first visitor of the day) if daily-freshness at first-load is the actual goal
- Because a true 15-minute pre-warm is not achievable on Vercel Cron within Hobby limits — don't build v1.1 assuming it is

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|------------------|-------|
| `next@16.3.5` | `react@19.3.0`, `tailwindcss@4.3.3` | This is the current mutually-compatible set `create-next-app@latest` scaffolds as of 2026-09-14; don't hand-pick older React/Tailwind majors against Next 16. |
| `tailwindcss@4.x` | `@tailwindcss/postcss@4.x` (matching major/minor) | v4's PostCSS plugin moved to its own package (`@tailwindcss/postcss`); do not use the old `tailwindcss` v3-style `postcss.config.js` plugin array format (`tailwindcss: {}, autoprefixer: {}`) — v4 setup is `{ plugins: { "@tailwindcss/postcss": {} } }` with autoprefixer handled internally. |
| `rss-parser@3.x` | Node.js runtime on Vercel Functions (any current LTS) | No known incompatibility; it depends on `xml2js`, a long-stable pure-JS dependency with no native bindings — safe for Vercel's serverless bundling. |

## Sources

- Direct npm registry queries (`registry.npmjs.org/<pkg>/latest`) for all pinned versions — HIGH confidence, ground truth as of 2026-09-14
- [nextjs.org/docs/app/api-reference/functions/fetch](https://nextjs.org/docs/app/api-reference/functions/fetch) (fetched directly, `lastUpdated: 2026-08-25`) — confirmed `next.revalidate` semantics, per-URL+method+headers+body cache-key matching, memoization vs persistent-cache distinction — HIGH confidence
- [vercel.com/docs/caching/runtime-cache/data-cache](https://vercel.com/docs/caching/runtime-cache/data-cache) (fetched directly, `last_updated: 2026-08-21`) — confirmed Data Cache remains a separate, fully supported layer in Next.js 16 outside Cache Components; confirmed 2MB item size limit, Hobby/Pro shared-cache-per-team scoping, LRU eviction, stale-while-revalidate-style time-based revalidation — HIGH confidence
- `vercel:cdn-caching` skill (bundled Vercel skill reference) — confirmed `x-vercel-cache: STALE` / `stale_time` reason as the mechanism that serves last-good content immediately while regenerating in the background — HIGH confidence
- `vercel:next-cache-components` skill (bundled Vercel skill reference) — confirmed Cache Components is opt-in via `cacheComponents: true` and is a parallel/newer model, not a replacement requirement — HIGH confidence
- [github.com/rbren/rss-parser](https://github.com/rbren/rss-parser) (fetched directly) — confirmed `parseString()` accepts raw XML text, RSS/Atom normalization, `customFields`, returned item shape — HIGH confidence
- WebSearch cross-checks (multiple independent sources) for: `fast-xml-parser` vs `rss-parser` positioning, Vercel Hobby plan limits (bandwidth, function timeout, invocations, cache size), Vercel Cron Hobby daily-only limit, date-fns tree-shaking caveats, Tailwind v4 Next.js install steps — MEDIUM-to-HIGH confidence (verified against Vercel's own docs pages where cited above; cron daily-limit and Hobby numeric limits cross-checked across 3+ independent third-party sources reporting the same figures)

---
*Stack research for: Havadis — serverless RSS aggregation on Vercel free tier*
*Researched: 2026-09-14*
