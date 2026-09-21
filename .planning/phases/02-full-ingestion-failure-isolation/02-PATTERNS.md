# Phase 2: Full Ingestion & Failure Isolation - Pattern Map

**Mapped:** 2026-09-21
**Files analyzed:** 3 (all modified, no new files this phase)
**Analogs found:** 3 / 3 (all are self-analogs — each file's own Phase 1 shape is the pattern to extend)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|-----------------|----------------|
| `src/lib/config/sources.ts` | config | CRUD (static data, append-only) | itself (Phase 1 shipped version) | exact — same file, widen the array |
| `src/lib/pipeline/getFrontPage.ts` | service/orchestrator | request-response (fan-out + aggregate) | itself (Phase 1 sequential-loop version) | exact — same file, same discriminated-result contract, loop body changes from sequential to parallel |
| `src/components/SourceTierBadge.tsx` | component | request-response (pure render, SSR) | itself (Phase 1 version, `TIER_STYLES` map) | exact — same file, same map shape, only 5 value rows change |

No genuinely new files are created this phase — every change lands inside a file that already exists and whose own doc comments explicitly anticipate this exact widening (see RESEARCH.md "Recommended Project Structure": "No new files or folders"). Consequently every "analog" is the file's own already-shipped Phase 1 version, not a different file elsewhere in the codebase. `fetchSource.ts`, `filterLookback.ts`, and `types.ts` are reused completely as-is (zero changes) and are listed under Shared Patterns as the contracts the three modified files must not break.

## Pattern Assignments

### `src/lib/config/sources.ts` (config, static-data append)

**Analog:** itself — `src/lib/config/sources.ts` (Phase 1 shipped version, full file above)

**Current shape** (lines 1-23):
```typescript
import type { SourceConfig } from "../types.ts";

/**
 * The fixed list of ingestion sources. Phase 1 wires exactly one entry
 * (Krebs on Security, per CONTEXT.md D-01); Phase 2 appends the other
 * twelve PROJECT.md rows to this same array with no other code changes.
 *
 * The URL below is the canonical, post-redirect form
 * (`https://krebsonsecurity.com/feed/`, trailing slash) rather than the
 * bare `/feed` path that appears in PROJECT.md/CONTEXT.md. ... because
 * Next.js's Data Cache only stores 200 responses, configuring the
 * pre-redirect URL would re-incur that redirect hop on every revalidation
 * cycle forever (RESEARCH.md Pitfall P1-2).
 */
export const SOURCES: SourceConfig[] = [
  {
    id: "krebs",
    name: "Krebs on Security",
    tier: "Security Research",
    url: "https://krebsonsecurity.com/feed/",
  },
];
```

**Pattern to copy for each new entry:** one object literal per source, matching the exact `SourceConfig` field order (`id`, `name`, `tier`, `url`) already used for Krebs. `id` is a short lowercase slug (`"krebs"`); `tier` must be one of the six literal `SourceTier` union values from `types.ts` exactly as spelled there (e.g. `"Enterprise Security"`, not a paraphrase). `url` must be the canonical **post-redirect** URL — the file's own doc comment already establishes this convention for Krebs; RESEARCH.md Pitfall 2 confirms Recorded Future (`https://www.recordedfuture.com/feed`, no trailing slash) and CrowdStrike (`https://www.crowdstrike.com/en-us/blog/feed`) need the same treatment, and Pitfall 1 confirms SANS ISC must use `https://isc.sans.edu/rssfeed_full.xml` (not PROJECT.md's `dailypodcast.xml`, which is 5.7MB and will always exceed `fetchSource.ts`'s 2MB cap).

**Doc-comment convention:** add a short comment above any entry whose configured URL diverges from PROJECT.md's literal table (redirect-canonicalization or byte-cap substitution), following the existing Krebs comment's style — state the divergence and why, citing the pitfall.

---

### `src/lib/pipeline/getFrontPage.ts` (service/orchestrator, request-response fan-out)

**Analog:** itself — `src/lib/pipeline/getFrontPage.ts` (Phase 1 shipped version, full file above)

**Imports pattern** (lines 1-4, unchanged):
```typescript
import { SOURCES } from "../config/sources.ts";
import type { Article, FrontPageResult } from "../types.ts";
import { fetchSource } from "./fetchSource.ts";
import { filterLookback } from "./filterLookback.ts";
```

**Core pattern — current sequential loop to be replaced** (lines 15-35):
```typescript
export async function getFrontPage(): Promise<FrontPageResult> {
  try {
    const articles: Article[] = [];
    for (const source of SOURCES) {
      const result = await fetchSource(source);
      if (result.status === "ok") {
        articles.push(...result.articles);
      }
      // A per-source failure is swallowed here rather than propagated...
    }
    return { status: "ok", articles: filterLookback(articles) };
  } catch (err) {
    return {
      status: "error",
      reason: err instanceof Error ? err.message : "unknown getFrontPage error",
    };
  }
}
```

**Target shape** (per RESEARCH.md Architecture Pattern 1 — `Promise.allSettled` fan-out, not the `Promise.all` the old doc comment suggests):
```typescript
export async function getFrontPage(): Promise<FrontPageResult> {
  try {
    const settled = await Promise.allSettled(SOURCES.map(fetchSource));
    const articles: Article[] = [];
    for (const outcome of settled) {
      if (outcome.status === "fulfilled" && outcome.value.status === "ok") {
        articles.push(...outcome.value.articles);
      }
      // A rejected settlement (should never happen, given fetchSource's
      // never-throws contract) or an {status:"error"} value are both
      // swallowed here, identically — same D-05 silent-degradation
      // treatment as Phase 1's sequential loop.
    }
    const fresh = filterLookback(articles);
    fresh.sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
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

**Error handling pattern (unchanged):** the outer `try/catch` returning the discriminated `{status:"error", reason}` variant is preserved verbatim — only the loop body inside the `try` changes. Per-source failure continues to be swallowed (never surfaced), matching D-05.

**Sort placement:** the `.sort()` on `publishedAt` descending goes *after* `filterLookback()`, not before (RESEARCH.md Pattern 2) — this exact comparator (`new Date(x.publishedAt).getTime()`) mirrors `filterLookback.ts:11`'s own existing comparator style, so it is idiomatic to this codebase, not a new convention.

---

### `src/components/SourceTierBadge.tsx` (component, SSR render)

**Analog:** itself — `src/components/SourceTierBadge.tsx` (Phase 1 shipped version, full file above)

**Imports pattern** (lines 1-2, unchanged):
```typescript
import clsx from "clsx";
import type { SourceTier } from "@/lib/types";
```

**Core pattern — `TIER_STYLES` map, 5 rows to replace** (lines 12-24):
```typescript
const TIER_STYLES: Record<SourceTier, string> = {
  "Security Research":
    "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200", // LOCKED, do not touch (D-04)
  Government: "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200", // replace (D-01)
  "Enterprise Security":
    "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200", // replace (D-01)
  "Threat Intelligence":
    "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200", // replace (D-01)
  "Tech & General":
    "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200", // replace (D-01)
  "Executive News":
    "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200", // replace (D-01)
};
```

**Pattern to copy for each new color row:** same 3-class shape as the locked indigo row — `bg-{color}-50 text-{color}-700 ring-1 ring-inset ring-{color}-200` — swap only the Tailwind color family per tier, keeping the `-50`/`-700`/`-200` shade steps identical across all rows for WCAG AA contrast and equal visual weight (D-03). Do not use `red-*` or `orange-*` families (D-02). Component render logic below the map (lines 26-37) is unchanged.

## Shared Patterns

### Never-throws / discriminated-result contract
**Source:** `src/lib/pipeline/fetchSource.ts` (unchanged this phase), contract shape defined in `src/lib/types.ts` lines 37-45
**Apply to:** `getFrontPage.ts`'s fan-out must preserve this contract on both sides — treat a fulfilled `{status:"error"}` and a rejected settlement identically (swallow, contribute zero articles). Do not introduce any code path that surfaces a per-source failure to the reader (D-05).

### Article shape / lookback filter
**Source:** `src/lib/pipeline/filterLookback.ts` (unchanged, full file above) and `src/lib/types.ts` lines 27-35 (`Article.publishedAt: string`, ISO 8601)
**Apply to:** `getFrontPage.ts`'s new `.sort()` comparator — reuse the exact `new Date(x.publishedAt).getTime()` idiom `filterLookback.ts:11` already uses, applied after `filterLookback()` runs, not before.

### SourceConfig field shape
**Source:** `src/lib/types.ts` lines 18-24 (`SourceConfig = { id, name, tier, url }`) and `src/lib/config/sources.ts`'s Krebs entry
**Apply to:** All 12 new `sources.ts` entries — same 4 fields, same order, `tier` must be a literal from the `SourceTier` union (types.ts lines 10-16).

## No Analog Found

None. All three files to be modified this phase already exist with a Phase 1 shape their own doc comments identify as the pattern to extend — there is no need to look elsewhere in the codebase for an analog.

## Metadata

**Analog search scope:** `src/lib/config/`, `src/lib/pipeline/`, `src/components/`, `src/lib/types.ts`
**Files scanned:** `sources.ts`, `getFrontPage.ts`, `SourceTierBadge.tsx`, `filterLookback.ts`, `types.ts` (5 files read in full; none exceeded 2,000 lines, no targeted offset/limit reads needed)
**Pattern extraction date:** 2026-09-21
