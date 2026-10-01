# Phase 4: Newspaper Front Page, Filtering & Mobile Polish - Pattern Map

**Mapped:** 2026-09-30
**Files analyzed:** 17 (6 modified, 11 new)
**Analogs found:** 15 / 17 (all analogs verified git-tracked via `git ls-files`)

Note: the codebase has zero client components and zero `.tsx` tests. Client files have only a role-match analog (styling/structure from server components); their logic patterns come from 04-RESEARCH.md "Code Examples", which are the authoritative skeletons. Pure `.ts` libs have exact analogs.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/app/page.tsx` (modify) | page (RSC) | request-response | itself (current version) | exact |
| `src/app/layout.tsx` (modify) | layout | request-response | itself | exact |
| `src/app/globals.css` (modify) | config | n/a | itself | exact |
| `src/lib/types.ts` (modify) | model | n/a | itself (line ~100) | exact |
| `src/lib/pipeline/getFrontPage.ts` (modify) | service | transform | itself (`composeFrontPage`) | exact |
| `src/lib/pipeline/getFrontPage.test.ts` (modify) | test | transform | itself | exact |
| `src/lib/formatRelativeTime.ts` (modify) + test | utility | transform | itself | exact |
| `src/lib/planSectionCap.ts` + `.test.ts` (new) | utility | transform | `src/lib/cveChips.ts` + `cveChips.test.ts`; `src/lib/pipeline/truncateSummary.ts` | role-match |
| `src/lib/formatUtcTime.ts` + `.test.ts` (new) | utility | transform | `src/lib/formatRelativeTime.ts` + test | exact |
| `src/lib/config/frontPageLayout.ts` (new) | config | n/a | `src/lib/config/ranking.ts` | exact |
| `src/components/FrontPageFilter.tsx` (new) | provider (client) | event-driven (state) | none in repo (RESEARCH skeleton) | no analog |
| `src/components/SectionFilterBar.tsx` (new) | component (client) | event-driven | `src/components/SourceTierBadge.tsx` (pill classes) | partial |
| `src/components/LastUpdated.tsx` (new) | component (client) | transform | `ArticleCard` `<time>` convention + `formatRelativeTime` | partial |
| `src/components/SectionVisibility.tsx` (new) | component (client) | event-driven | none (RESEARCH skeleton) | no analog |
| `src/components/SectionExpander.tsx` (new) | component (client) | event-driven | `SourceTierBadge.tsx` (pill classes) | partial |
| `test/productionPage.test.ts` (modify) | test | request-response | itself | exact |

## Pattern Assignments

### `src/lib/config/frontPageLayout.ts` (config)

**Analog:** `src/lib/config/ranking.ts` (lines 1-33). Header doc comment citing decision IDs, `.ts` relative imports, named exported constants with rationale comments.

```typescript
import type { SourceTier } from "../types.ts";
/** D-10 rough ordering ... */
export const TIER_WEIGHT: Record<SourceTier, number> = { ... };
export const RANK_HALF_LIFE_HOURS = 6;
```
Apply: `export const SECTION_CARD_CAP = 6; export const MIN_HIDDEN_TO_COLLAPSE = 3;` each with a D-05/D-06 comment.

### `src/lib/planSectionCap.ts` (+ test) (utility, transform)

**Analog:** `src/lib/formatRelativeTime.ts` + `.test.ts` (pure function, doc comment, `node:test`).

Test header convention (`formatRelativeTime.test.ts` lines 1-3):
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRelativeTime } from "./formatRelativeTime.ts";
```
Source uses explicit `.ts` relative imports (required by `node --test`; no `@/` alias in testable libs). Copy the body from RESEARCH.md "Pure cap planner". Test totals 0,1,6,7,8,9,10,26 -> (0,0)(1,0)(6,0)(7,0)(8,0)(6,3)(6,4)(6,20). One `test(...)` per case, descriptive sentence names like existing tests.

### `src/lib/formatUtcTime.ts` (+ test)

**Analog:** `src/lib/formatRelativeTime.ts`. No date library, never throws (invalid date returns a fallback string). Copy body from RESEARCH.md "Deterministic UTC formatting". Test with fixed ISO strings (deterministic, no `Date.now()`).

### `src/lib/formatRelativeTime.ts` (modify)

Current (lines 13-14):
```typescript
export function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
```
Change to `(isoDate: string, now: number = Date.now())` and `now - ...`. Back-compatible with the existing one-arg tests (`formatRelativeTime.test.ts` lines 17-40, which use an `isoAgo(ms)` helper). Add one test passing an explicit `now`. Update the doc comment about "reads the current time itself".

### `src/lib/types.ts` and `src/lib/pipeline/getFrontPage.ts` (modify, generatedAt)

types.ts (line ~100):
```typescript
export type SectionedFrontPageResult =
  | { status: "ok"; articles: ClassifiedArticle[]; sections: SectionGroup[] }
  | { status: "error"; reason: string };
```
Add `generatedAt: string` to the ok variant.

getFrontPage.ts line 43:
```typescript
return { status: "ok", articles: sections.flatMap((group) => group.articles), sections };
```
Add `generatedAt: new Date(now).toISOString()` using the threaded `now` (D-09: nothing reads the clock inside composition). Update the doc comment. Test in `getFrontPage.test.ts`, which uses `NOW = Date.parse("2026-09-23T12:00:00.000Z")` and `composeFrontPage([], NOW)` (line 86): assert `.generatedAt === new Date(NOW).toISOString()`. Existing tests select fields only, so they stay green.

### `src/app/layout.tsx` (modify)

Line 29 only: `<div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">` -> `max-w-7xl` (must equal the page shell/bar inner width; RESEARCH recommends `max-w-7xl`). Do not wrap `{children}` (line 36); the body is `min-h-full flex flex-col` and `main` relies on `flex-1`. The sticky bar must remain a direct child of `<body>` (provider renders no DOM).

### `src/app/page.tsx` (modify)

**Current structure to transform** (lines 23-64): `await getFrontPage()`, `sections = result.status === "ok" ? result.sections : []`, `<main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">`, sr-only `<h1>Latest</h1>`, empty-state `<p className="text-zinc-500 dark:text-zinc-400">No articles in the last 24 hours.</p>`, per-section:

```tsx
<section key={group.section} data-section={group.section} className="flex flex-col gap-4">
  <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
    <span aria-hidden="true">{SECTION_EMOJI[group.section]}</span> {group.section}
  </h2>
  <div className="flex flex-col gap-6">
    {group.articles.map((article) => (<ArticleCard key={article.url} article={article} />))}
  </div>
</section>
```
Keep: the quiet empty state for error and ok-empty (no provider/bar mounted; never render `reason`), `key={article.url}`, `data-section`, sr-only h1, `SECTION_EMOJI` resolved here on the server (do not import `config/sections` in client files; pass `{ section, emoji, count }[]`). New: `max-w-7xl` shell, `grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3` for the primary slice, `planSectionCap(total)` + `slice`, overflow grid inside `<SectionExpander>` only when `hiddenCount > 0`, count span with `data-count` and sr-only `, N articles` (RESEARCH Pitfall 8), heading id as `section-heading-${index}` (Pitfall 14), wrap each section in `<SectionVisibility>`, wrap everything in `<FrontPageFilter>` with `<SectionFilterBar>` outside `<main>`. Build every asserted string as one template-literal text node (Pitfall 5). No `cookies()/headers()/useSearchParams/dynamic` exports (Pitfall 10). Update the stale doc comment (lines 13-22) that says "no grid, count, show-more".

### Client components (new): `FrontPageFilter`, `SectionVisibility`, `LastUpdated`, `SectionExpander`, `SectionFilterBar`

**No in-repo client analog.** Copy skeletons from 04-RESEARCH.md "Code Examples" (Filter context + visibility wrapper, Hydration-safe Updated text, Expander). Adopt these in-repo conventions:

- Header doc comment citing decision IDs and the Next docs file consulted (see `CveChips.tsx` lines 3-14: "verified against node_modules/next/dist/docs/...", "Renders plain JSX text children only (T-01-07)").
- `@/` alias imports in `.tsx` (e.g. `import { formatRelativeTime } from "@/lib/formatRelativeTime";`).
- `clsx` composition as in `SourceTierBadge.tsx`.

**Pill geometry to reuse** (`SourceTierBadge.tsx` lines 33-37, `CveChips.tsx` lines 24-25):
```tsx
className={clsx(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
  TIER_STYLES[tier],
)}
```
Shade-step convention `-50 / -700 / -200` with `ring-1 ring-inset`. For unpressed pill and expander use `ring-zinc-500` (RESEARCH Pitfall 7; amends UI-SPEC's zinc-400/600). Follow 04-UI-SPEC.md for exact sizes (`min-h-11`, `md:min-h-8`), sticky classes (`sticky top-0 bg-white/90 backdrop-blur`), `max-md:scrollbar-none` (already in Tailwind 4.3.3, no `@utility`). Every surface needs a `dark:` variant; Tailwind scale values only, never concatenated class strings.

**LastUpdated must** use `useSyncExternalStore` (module-scope `subscribe`/`getMinute`, server snapshot `null`), not effect+setState (fails `react-hooks/set-state-in-effect`) and not `Date.now()` in render (fails `react-hooks/purity`). Keep `<time dateTime title>` as in `ArticleCard`.

**SectionVisibility/SectionExpander must** render `hidden` (never conditional rendering) so all cards stay in the server HTML (D-07). Section expander uses `useId()` for `aria-controls`, `flushSync` before `scrollIntoView` on collapse (Pitfall 11).

### `test/productionPage.test.ts` (modify)

**Analog:** itself. Reuse: `hasArticleAnchorTag` helper (lines 31-36), `fetch(BASE_URL)` + `await res.text()` per test, `matchAll` regex extraction (line 133), and the empty-state branch guard (lines 149-154).

```typescript
const dataSections = [...body.matchAll(/data-section="([^"]+)"/g)].map((m) => m[1]);
```
Add invariant-based tests (RESEARCH Pitfall 12), never live-data-fixed: per section chunk (split on `data-section="`), total = `<article` count; if total >= 9 then primary == 6, overflow region present, sums equal; else no overflow and no expander button; pill `data-count` equals heading `data-count`; `Updated HH:MM UTC` present via single-text-node string; no `dangerouslySetInnerHTML`/storage grep gate in src. Existing "byte-identical HTML" test (lines 184-194) must keep passing. The `data-section` order test still works because `data-section` stays on the server-rendered `<section>`. The plan must run `npm run build` before `npm test` (the test only spawns `next start`, Pitfall 15), and re-check `.next/prerender-manifest.json` has `/` static with 900s revalidation.

## Shared Patterns

### Doc-comment-with-decision-IDs
**Source:** every file (`ranking.ts` 1-10, `getFrontPage.ts` 10-31, `CveChips.tsx` 3-14). Apply to all new files: cite D-xx, threat IDs, and why.

### Pure logic in `.ts` with `.ts` relative imports + colocated `node:test`
**Source:** `formatRelativeTime.ts`/`.test.ts`, `getFrontPage.ts` lines 1-8. **Apply to:** `planSectionCap`, `formatUtcTime`, `frontPageLayout`. Client `.tsx` cannot be unit-tested under `node --test`, so keep logic out of it.

### Plain-text rendering (T-01-07) and no error leakage (T-01-10/T-03-04)
**Source:** `page.tsx` header comment, `CveChips.tsx`. No `dangerouslySetInnerHTML`; client props limited to `{section, emoji, count}[]`, `generatedAt`, `total`; never pass `reason` or whole article objects to client components.

### Never-throws pipeline
**Source:** `getFrontPage.ts` lines 59-72; keep the try/catch and error variant unchanged.

### Styling rules
Tailwind scale values only, `dark:` on every surface, colours from zinc neutral; red/orange stay reserved (CVE chips). Existing heading style (page.tsx line 50): `text-sm font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400`.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/components/FrontPageFilter.tsx` | client provider | event-driven | No `"use client"` file exists; use RESEARCH "Filter context + visibility wrapper" |
| `src/components/SectionVisibility.tsx` | client wrapper | event-driven | Same |

(`SectionFilterBar`, `LastUpdated`, `SectionExpander` have only partial analogs, for styling and `<time>` convention; logic from RESEARCH skeletons.)

## Metadata

**Analog search scope:** all tracked files under `src/`, `test/` (via `git ls-files`)
**Files read:** page.tsx, layout.tsx, globals.css, SourceTierBadge.tsx, CveChips.tsx (head), getFrontPage.ts (+test head), formatRelativeTime.ts (+test), types.ts (tail), ranking.ts, productionPage.test.ts
**Pattern extraction date:** 2026-09-30
