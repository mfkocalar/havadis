# Phase 1: Single-Source Pipeline (Vertical Slice) - Pattern Map

**Mapped:** 2026-09-15
**Files analyzed:** 10 (files to be created)
**Analogs found:** 0 / 10 — no existing application code in this repository

## No Existing Codebase — This Phase Originates the Patterns

Verified via `ls -la` and `find`: the repository root contains only `.git/`, `.claude/`, `.planning/`, and `.gitignore`. There is no `app/`, `src/`, `lib/`, `package.json`, or any other application source file. `git ls-files` on a repo with no commits/tracked files confirms nothing is tracked yet either.

This is a from-scratch, greenfield first phase (per RESEARCH.md's "Summary": "scaffolds the Next.js project in place inside an existing, non-empty repo... but no application code exists yet"). Consequently:

- There are **no existing-codebase analogs** to search for or reference — no controllers, services, components, or configs exist anywhere in this repo to copy patterns from.
- The correct, honest output here is **not** to fabricate analog file paths or invent "closest match" files that don't exist.
- Instead, the origin patterns for every file in this phase come from **RESEARCH.md's own "Code Examples" and "Architecture Patterns" sections**, which were live-verified this session (2026-09-15) against Krebs on Security's actual feed, Next.js 16's actual docs, and a real `create-next-app` scaffold run. These are the canonical patterns the planner should assign — copied below verbatim with their source locations in RESEARCH.md for traceability.

**Downstream phases (2, 3, 4) will have real analogs to map against** once this phase's files exist — e.g., Phase 2's additional 12 sources should pattern-map against this phase's `lib/config/sources.ts` and `lib/pipeline/fetchSource.ts`. Flag this explicitly to the planner: this phase's own output files become the analog set for all future phases.

## File Classification

| New File | Role | Data Flow | Origin Pattern (RESEARCH.md section) | Match Quality |
|----------|------|-----------|----------------------------------------|----------------|
| `src/lib/config/sources.ts` | config | CRUD (static data) | RESEARCH.md "Architecture Patterns" diagram + CONTEXT.md D-01 (Krebs URL, canonical trailing-slash form per Pitfall P1-2) | no analog — new pattern |
| `src/lib/pipeline/fetchWithValidatedRedirect.ts` | utility | request-response | RESEARCH.md "Architecture Patterns → Pattern 1" (full code example, lines ~184-231) | no analog — new pattern |
| `src/lib/pipeline/fetchSource.ts` | service | request-response | RESEARCH.md "Architecture Patterns → Pattern 2" + `.planning/research/ARCHITECTURE.md` fetcher-never-throws pattern | no analog — new pattern |
| `src/lib/pipeline/normalize.ts` | transform/utility | transform | RESEARCH.md "Code Examples → normalize.ts" (full code example, lines ~393-421) | no analog — new pattern |
| `src/lib/pipeline/filterLookback.ts` | utility | transform | RESEARCH.md "Code Examples → 24h lookback filter" (lines ~426-431) | no analog — new pattern |
| `src/lib/pipeline/getFrontPage.ts` | service | request-response (orchestrator) | RESEARCH.md architecture diagram: single orchestrator composing fetchSource → normalize → filterLookback | no analog — new pattern |
| `src/lib/formatRelativeTime.ts` | utility | transform | RESEARCH.md "Code Examples → Relative-time formatter" (lines ~436-445) | no analog — new pattern |
| `src/lib/types.ts` | model | — | Implied by `normalize.ts`'s `Article` type and `SourceConfig` import (RESEARCH.md line ~396) | no analog — new pattern |
| `src/app/page.tsx` | component (Server Component) | request-response | RESEARCH.md architecture diagram: "app/page.tsx calling getFrontPage() directly — no Route Handler indirection" | no analog — new pattern |
| `src/components/ArticleCard.tsx` | component | request-response (render) | CONTEXT.md D-02/D-03/D-04 (visual direction, empty state, tier badge) + RESEARCH.md UI-02 usage snippet (`<time>` with `title` attribute, lines ~447-451) | no analog — new pattern |
| `src/components/SourceTierBadge.tsx` | component | request-response (render) | CONTEXT.md D-04 (colored pill, single-tier color for Security Research) | no analog — new pattern |

## Pattern Assignments

### `src/lib/config/sources.ts` (config, static data)

**Origin:** RESEARCH.md architecture diagram + Pitfall P1-2

No analog exists. Structure as a `SourceConfig[]` array (even with one entry) so Phase 2 can append 12 more entries with zero refactor, per CONTEXT.md code_context: "structure the fetch/normalize stages as if more sources will be added... don't hardcode Krebs-specific logic outside `lib/config/sources.ts`."

Use the **canonical post-redirect URL** (`https://krebsonsecurity.com/feed/`, trailing slash) as the configured value — not the bare `/feed` from PROJECT.md — per Pitfall P1-2, to avoid a permanently-uncached extra redirect hop on every revalidation cycle. Still keep the redirect-validation loop fully implemented regardless.

### `src/lib/pipeline/fetchWithValidatedRedirect.ts` (utility, request-response)

**Origin:** RESEARCH.md Pattern 1 (verbatim example provided)

```typescript
const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 5;

export async function fetchWithValidatedRedirect(
  startUrl: string,
  init: RequestInit & { next?: { revalidate?: number } } = {}
): Promise<Response> {
  let currentUrl = new URL(startUrl);
  const originalHost = currentUrl.host;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(currentUrl.toString(), {
        ...init,
        redirect: "manual", // never let fetch auto-follow — validate first
        signal: controller.signal,
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) throw new Error(`Redirect (${res.status}) with no Location header`);
        const target = new URL(location, currentUrl);
        if (target.protocol !== "https:") throw new Error(`Rejected redirect: non-HTTPS target ${target.protocol}`);
        if (target.host !== originalHost) throw new Error(`Rejected redirect: host mismatch (${target.host} !== ${originalHost})`);
        currentUrl = target;
        continue;
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Too many redirects (> ${MAX_REDIRECTS}) fetching ${startUrl}`);
}
```

**Critical constraint:** `redirect: 'manual'` must be used from the first line of code (Pitfall P1-1) — there is no safe retrofit if `redirect: 'follow'` is used first.

### `src/lib/pipeline/fetchSource.ts` (service, request-response)

**Origin:** `.planning/research/ARCHITECTURE.md` "fetcher-never-throws" pattern + RESEARCH.md Pattern 2

No analog. Must never throw — return a discriminated result (`{ status: 'ok', articles } | { status: 'error', reason }`) per CONTEXT.md D-03's empty-state requirement. Calls `fetchWithValidatedRedirect(source.url, { next: { revalidate: 900 } })`, then hands raw XML text to `rss-parser.parseString()`. Do NOT use `rss-parser`'s own `parseURL()` — it bypasses Next's Data Cache (CLAUDE.md constraint, RESEARCH.md "Don't Hand-Roll").

Send a browser-like `User-Agent` header defensively (Assumption A1 — unresolved anti-bot risk for Krebs from Vercel IPs; zero-cost mitigation).

### `src/lib/pipeline/normalize.ts` (transform, request-response)

**Origin:** RESEARCH.md "Code Examples → normalize.ts" (verbatim, verified field-by-field against Krebs's live feed)

```typescript
import type Parser from "rss-parser";
import type { SourceConfig } from "@/lib/types";

export type Article = {
  title: string;
  url: string;
  source: string;
  sourceTier: string;
  publishedAt: string; // ISO 8601
  summary: string;
};

export function normalize(item: Parser.Item, source: SourceConfig): Article | null {
  if (!item.title || !item.link || !item.isoDate) return null; // skip malformed entries defensively
  return {
    title: item.title.trim(),
    url: item.link,
    source: source.name,
    sourceTier: source.tier,
    publishedAt: item.isoDate,
    summary: (item.contentSnippet ?? item.content ?? "").trim(),
  };
}
```

**Security note (RESEARCH.md Security Domain V5):** treat every field from fetched RSS XML as untrusted; the `null` guard above is the validation gate. Render `title`/`summary` as plain text via JSX's default escaping — never `dangerouslySetInnerHTML`.

### `src/lib/pipeline/filterLookback.ts` (utility, transform)

**Origin:** RESEARCH.md "Code Examples → 24h lookback filter" (verbatim)

```typescript
export function filterLookback(articles: Article[], hours = 24): Article[] {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return articles.filter((a) => new Date(a.publishedAt).getTime() >= cutoff);
}
```

### `src/lib/pipeline/getFrontPage.ts` (service, orchestrator)

**Origin:** RESEARCH.md architecture diagram — the single orchestrator composing `fetchSource(KREBS_CONFIG)` → `normalize()` → `filterLookback(24h)`, returning `{ status: 'ok'|'error', articles }`. No Route Handler indirection — `app/page.tsx` awaits this directly (Anti-Pattern 1 in ARCHITECTURE.md).

### `src/lib/formatRelativeTime.ts` (utility, transform)

**Origin:** RESEARCH.md "Code Examples → Relative-time formatter" (verbatim)

```typescript
export function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
```

Usage in `ArticleCard.tsx` (satisfies UI-02's absolute-time-on-hover via native `title` attribute, per CONTEXT.md's Claude's Discretion note):

```tsx
<time dateTime={article.publishedAt} title={new Date(article.publishedAt).toLocaleString()}>
  {formatRelativeTime(article.publishedAt)}
</time>
```

### `src/lib/types.ts` (model)

**Origin:** Implied by `normalize.ts`'s import of `SourceConfig` and `Article`. No analog — define `Article` (see above) and `SourceConfig = { name: string; tier: string; url: string }` here as the shared shape both `sources.ts` and `normalize.ts` import.

### `src/app/page.tsx` (component, Server Component)

**Origin:** RESEARCH.md architecture diagram: "app/page.tsx calling getFrontPage() directly." No analog. Awaits `getFrontPage()`, renders `<ArticleCard>` list, or CONTEXT.md D-03's quiet empty-state message when `status === 'error'` or zero articles.

### `src/components/ArticleCard.tsx` (component, render)

**Origin:** No analog. Must satisfy UI-02 fields (source name, tier badge, verbatim title, summary, relative+absolute time, link to original) and CONTEXT.md D-02 ("Modern editorial" — sans-serif headlines, whitespace, card with subtle shadow, TechCrunch/The Verge feel). Renders `<SourceTierBadge>` and the `<time>` pattern above.

### `src/components/SourceTierBadge.tsx` (component, render)

**Origin:** No analog. CONTEXT.md D-04: colored text label/pill, distinct color per tier, not plain-text-only, not icon+label. Only "Security Research" tier's color needs to be picked this phase (Claude's Discretion, Assumption A2 — purely cosmetic, reversible). Use `clsx@2.1.1` for the conditional-variant branching per RESEARCH.md Supporting Libraries, written to accept a `tier` prop so Phase 2 can add 5 more tiers with zero refactor.

## Shared Patterns

### Fetcher-never-throws
**Source:** `.planning/research/ARCHITECTURE.md` (fetcher-never-throws pattern), RESEARCH.md Pattern 1/2
**Apply to:** `fetchSource.ts`, `getFrontPage.ts` — both must return a discriminated result object, never throw uncaught, so `page.tsx` can always render its full layout (CONTEXT.md D-03).

### Redirect validation (INGEST-03)
**Source:** RESEARCH.md Pattern 1
**Apply to:** `fetchWithValidatedRedirect.ts` now; every future source fetch added in Phase 2/3.

### Caching via `next.revalidate` only
**Source:** RESEARCH.md Pattern 2
**Apply to:** every `fetch()` call to a source URL — `next: { revalidate: 900 }`, no `cache: 'force-cache'` companion, no hand-rolled TTL map.

### Plain-text rendering of untrusted feed content
**Source:** RESEARCH.md Security Domain (V5 Output Encoding)
**Apply to:** `ArticleCard.tsx` — render `title`/`summary` via normal JSX text nodes; never `dangerouslySetInnerHTML`.

### No auth anywhere (UI-06)
**Source:** RESEARCH.md Architectural Responsibility Map
**Apply to:** all files this phase — no middleware, session cookie, or login route should be introduced.

## No Analog Found

All 11 files above have no existing-codebase analog — this is the expected, correct state for a from-scratch first phase. See "No Existing Codebase" section above for the origin-pattern substitution used instead.

## Metadata

**Analog search scope:** entire repository root (`/Users/mkh/CyberSecurity/SecurityNews`), confirmed via `ls -la` and `find` — only `.git/`, `.claude/`, `.planning/`, `.gitignore` exist.
**Files scanned:** 0 application source files (none exist)
**Pattern extraction date:** 2026-09-15
**Note for future phases:** Once this phase's files exist and are committed, they become the analog set for Phase 2 (source fan-out) — e.g. new source-fetch wiring should pattern-map against this phase's `sources.ts`/`fetchSource.ts`, not re-derive from RESEARCH.md again.

---
*Phase: 1-Single-Source Pipeline (Vertical Slice)*
*Mapped: 2026-09-15*
