# Phase 3: Deduplication, Classification & Ranking - Pattern Map

**Mapped:** 2026-09-23
**Files analyzed:** 15 (10 new pipeline/config modules + 4 updated files + 1 new component; test files follow the same analog as their source module)
**Analogs found:** 15 / 15 (all files have an in-repo analog; this is a young, single-pattern codebase — every new file is a same-shape sibling of an existing one)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/lib/pipeline/decodeHtmlEntities.ts` | utility | transform | `src/lib/pipeline/truncateSummary.ts` | exact (pure string transform, single exported function, colocated test) |
| `src/lib/pipeline/canonicalizeUrl.ts` | utility | transform | `src/lib/pipeline/truncateSummary.ts` | exact |
| `src/lib/pipeline/normalizeTitleForDedupe.ts` | utility | transform | `src/lib/pipeline/truncateSummary.ts` | exact |
| `src/lib/pipeline/dedupe.ts` | service (pipeline stage) | batch/transform | `src/lib/pipeline/filterLookback.ts` | exact (array-in, array-out pipeline stage, pure) |
| `src/lib/pipeline/classify.ts` | service (pipeline stage) | transform | `src/lib/pipeline/normalize.ts` | role-match (per-item classification logic keyed on config, same "pure decision function" shape) |
| `src/lib/pipeline/extractCves.ts` | utility | transform | `src/lib/pipeline/truncateSummary.ts` | exact |
| `src/lib/pipeline/rank.ts` | service (pipeline stage) | batch/transform | `src/lib/pipeline/sortByRecencyDesc.ts` | exact (array sort/score stage being directly superseded) |
| `src/lib/pipeline/groupBySection.ts` | service (pipeline stage) | batch/transform | `src/lib/pipeline/filterLookback.ts` | exact |
| `src/lib/config/sections.ts` | config | — | `src/lib/config/sources.ts` | exact (pure-data config module, heavily commented with rationale) |
| `src/lib/config/ranking.ts` | config | — | `src/lib/config/sources.ts` | exact |
| `src/lib/pipeline/normalize.ts` (UPDATE) | service | transform | itself (existing file, extend title handling) | exact — self |
| `src/lib/pipeline/getFrontPage.ts` (UPDATE) | controller/orchestrator | request-response | itself (existing file, extend stage chain) | exact — self |
| `src/lib/types.ts` (UPDATE) | model | — | itself (existing file, extend types) | exact — self |
| `src/components/CveChips.tsx` | component | request-response (SSR render) | `src/components/SourceTierBadge.tsx` | exact (small stateless pill-rendering Server Component, config-keyed styling) |
| `src/components/ArticleCard.tsx` (UPDATE) | component | request-response (SSR render) | itself (existing file, extend meta row) | exact — self |
| `src/app/page.tsx` (UPDATE) | route/page | request-response (SSR render) | itself (existing file, swap flat map for grouped map) | exact — self |
| `src/lib/pipeline/sortByRecencyDesc.ts` (REMOVE candidate) | — | — | n/a (deletion candidate, see D-note below) | n/a |

**Tests:** every new `*.ts` module above gets a colocated `*.test.ts` following the existing `truncateSummary.test.ts` / `filterLookback.test.ts` / `normalize.test.ts` pattern (Vitest-style, one `describe`/`test` block per behavior, fixture objects built inline — see `frontpage.e2e.test.ts` for the multi-source fixture style). No dedicated analog file content is reproduced here since the CONTEXT/RESEARCH docs already specify exact required fixture cases (future-dated clamp, `worm` false positive, double-encoded entity, 4-CVE overflow).

## Pattern Assignments

### `src/lib/pipeline/decodeHtmlEntities.ts` / `canonicalizeUrl.ts` / `normalizeTitleForDedupe.ts` / `extractCves.ts` (utility, transform)

**Analog:** `src/lib/pipeline/truncateSummary.ts` (full file read above)

**Imports pattern** — these files have effectively **no imports** in the analog (pure string logic, zero dependencies):
```typescript
// truncateSummary.ts has no import statements at all — just exported consts + a function.
```
Follow this: `decodeHtmlEntities.ts`, `canonicalizeUrl.ts` (uses only the built-in `URL`/`URLSearchParams`), `normalizeTitleForDedupe.ts`, and `extractCves.ts` should all be zero-dependency pure functions, matching STACK.md's dependency-minimalism bias already enacted here.

**Core transform pattern** (`truncateSummary.ts` lines 46-92): a single exported pure function, heavily commented with **why** each constant/branch exists (not just what it does), an exported constant for any "magic number" (`SUMMARY_MAX_CHARS`), and defensive code-point-safe string handling (`Array.from(text)` rather than raw indexing) called out explicitly in a comment. New files should:
- Export one primary function plus any derived constants (e.g. `TRACKING_PARAM_EXACT`, `CVE_PATTERN`) at module scope.
- Document *why* a design choice was made (e.g. why NFKC not NFC, why the tracking-param list is `[ASSUMED]`) directly above the code, exactly as `truncateSummary.ts`'s docstring explains the 60%-boundary floor.
- Keep the function pure and synchronous — no I/O.

**Doc-comment convention** (top-of-file, lines 1-17 of `truncateSummary.ts`): a module-level comment block explaining what problem this solves, referencing the originating decision ID (e.g. "D-08") and any measured/live evidence backing the design. New files must open with an equivalent block referencing their driving decision ID (D-01, D-04, D-13 respectively) per this repo's established documentation-density convention.

---

### `src/lib/pipeline/dedupe.ts` / `rank.ts` / `groupBySection.ts` (pipeline stage, batch transform)

**Analog:** `src/lib/pipeline/filterLookback.ts` (full file, 13 lines) and `src/lib/pipeline/sortByRecencyDesc.ts` (full file, 24 lines)

**Core stage pattern** (`filterLookback.ts` lines 1-12):
```typescript
import type { Article } from "../types.ts";

export function filterLookback(articles: Article[], hours = 24): Article[] {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return articles.filter((article) => new Date(article.publishedAt).getTime() >= cutoff);
}
```
Pattern to copy: signature is `(articles: Article[], ...params) => Article[]`, imports only `type { Article }` from `../types.ts`, computes any "current instant" **once** before iterating (exactly what D-09 requires: `now` threaded as a parameter, not read fresh per-article) — `filterLookback.ts`'s `const cutoff = Date.now() - ...` computed once, before `.filter()`, is the direct in-repo precedent for `rank.ts` taking `now: number` as an explicit parameter rather than calling `Date.now()` internally.

**Immutability pattern** (`sortByRecencyDesc.ts` lines 19-23):
```typescript
export function sortByRecencyDesc(articles: Article[]): Article[] {
  return [...articles].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
}
```
Copy the `[...articles].sort(...)` never-mutate-the-input idiom for `rank.ts`'s `rankWithinSection`.

**Deletion candidate note:** `sortByRecencyDesc.ts` is the direct predecessor `rank.ts`/`groupBySection.ts` supersede. RESEARCH.md recommends deleting it and its test; CONTEXT.md leaves this to Claude's discretion. If kept, it needs a comment explaining why it still exists with no caller.

---

### `src/lib/pipeline/classify.ts` (pipeline stage, transform, config-driven)

**Analog:** `src/lib/pipeline/normalize.ts` (full file above) for per-item decision-function shape, plus `src/lib/config/sources.ts` for the config-table pattern it reads from.

**Function shape** (`normalize.ts` lines 26-47): one item in, one decision out, with early-return guard clauses and a doc comment explaining *why each guard exists* and citing the relevant threat ID (`T-01-04`). `classify.ts` should mirror: `export function classify(article): Section`, early loop-and-return per rule, and a comment citing D-05/D-06 the way `normalize.ts` cites its own decisions.

**Config-table pattern** (`sources.ts` lines 1-21, 58-68): a single exported `const` array/record, each entry/branch documented inline with a comment explaining *why this specific value differs from the "obvious" default* (e.g. SANS ISC's non-default URL, `worm` → `computer worm`). `src/lib/config/sections.ts`'s `SECTION_KEYWORDS`/`CLASSIFICATION_ORDER` should carry the same per-entry rationale comments already drafted in RESEARCH.md's "Deviations from the reference taxonomy" section — copy that prose directly into code comments next to each keyword list per D-07's "every deviation... documented in a code comment" requirement.

---

### `src/lib/config/sections.ts` / `src/lib/config/ranking.ts` (config)

**Analog:** `src/lib/config/sources.ts` (full file above)

**Top-of-file doc comment** (lines 1-20): explains the origin of the data (PROJECT.md's table), which decision ID it satisfies, and calls out any entries needing special explanation. Copy this shape exactly — `sections.ts` should open with a comment tracing to D-05/D-07/D-12, `ranking.ts` to D-09/D-10.

**Per-entry inline comments** (lines 28-34, 41-45, 58-68, 81-89): every non-obvious value gets a comment directly above/beside it explaining the deviation from the "obvious" choice and citing live evidence where available. `ranking.ts`'s `TIER_WEIGHT` and `RANK_HALF_LIFE_HOURS` (already drafted in RESEARCH.md Pattern 3) already follow this convention — use that draft verbatim, it matches house style.

**Single exported typed array/record, no default export, no class** — `sources.ts` exports `SOURCES: SourceConfig[]` as its only export; `sections.ts`/`ranking.ts` should likewise export plain typed consts (`SECTION_DISPLAY_ORDER: Section[]`, `SECTION_KEYWORDS: Record<Section, string[]>`, `TIER_WEIGHT: Record<SourceTier, number>`), no classes, no default exports — consistent with every other file in this codebase.

---

### `src/lib/pipeline/normalize.ts` (UPDATE — add entity decoding to title)

**Analog:** itself, current lines 39-46:
```typescript
  return {
    title: item.title.trim(),
    ...
    summary: truncateSummary((item.contentSnippet ?? item.content ?? "").trim()),
  };
```
Pattern to copy for the D-04 change: `summary` already shows the "wrap the raw field in a pure transform function before it enters the returned object" pattern (`truncateSummary(...)`). Apply the identical wrapping style to `title`: `title: decodeHtmlEntities(item.title.trim())` (decode after trim, mirroring the summary line's `.trim()`-then-transform order), and update the file's own doc comment (lines 18-24) which currently says title is deliberately NOT capped — add a note that title *is* now decoded (a different transform than capping) and update the class comment that currently states normalize performs "no... deduplication" to also note it now decodes entities per D-04. Must also update the existing test at `normalize.test.ts:51-61` per RESEARCH.md Pitfall 6 (expected value changes from `"R&amp;D..."` to `"R&D..."`).

---

### `src/lib/pipeline/getFrontPage.ts` (UPDATE — new stage chain, `now` param, `sections` field)

**Analog:** itself, full current file above (27 lines):
```typescript
export async function getFrontPage(): Promise<FrontPageResult> {
  try {
    return { status: "ok", articles: sortByRecencyDesc(filterLookback(await fanOut(SOURCES))) };
  } catch (err) {
    return {
      status: "error",
      reason: err instanceof Error ? err.message : "unknown getFrontPage error",
    };
  }
}
```
**Pattern to copy exactly:**
- The **try/catch-never-throws contract** (lines 19-26) — every new stage call must stay inside this same `try` block; do not add a second try/catch per stage.
- The **single-expression composition style** — stages are nested function calls (`sortByRecencyDesc(filterLookback(await fanOut(SOURCES)))`), not a multi-line `let` chain. Extend this style: `const deduped = dedupe(filterLookback(await fanOut(SOURCES)));` then classify/extractCves/group as subsequent `const` steps if the one-liner gets too long to stay readable — either is consistent with house style; the file is currently small enough for one-liners but D-09 requiring a `now` parameter threaded through justifies breaking into named `const` steps for clarity.
- The **doc comment above the function** (lines 7-17) narrates the exact stage order and cites the CONTEXT.md decision driving the empty/error-state behavior — update it to narrate the new order (fanOut → filterLookback → dedupe → classify → extractCves → groupBySection) and add the `now` parameter default (`getFrontPage(now: number = Date.now())`) matching D-09's "takes `now` as an input" requirement.
- Import style: `import { X } from "./y.ts";` with explicit `.ts` extensions (lines 1-5) — every new pipeline import must keep this extension convention.

---

### `src/lib/types.ts` (UPDATE — add `Section`, `SectionGroup`, extend `Article`/`FrontPageResult`)

**Analog:** itself, full current file above (55 lines).

**Pattern to copy:**
- Union string-literal type definition style (lines 10-16, `SourceTier`): `export type Section = "Vulnerabilities" | "Advisories" | ... ;` — flat string-literal union, no enum, matching `SourceTier`'s exact shape.
- Doc comment above each type citing its origin (line 9: `/** The six source tiers from PROJECT.md's 13-source table. */`) — new `Section` type needs an equivalent comment citing D-12/CLASSIFY-03 and PROJECT.md's taxonomy.
- `Article` type extension (lines 36-44): add `section: Section;` and `cves: string[];` as new required fields (not optional) in the same flat-object-literal-type style, with an inline comment on `cves` noting it's already-deduplicated/uppercased per D-13, mirroring the existing `/** ISO 8601 published timestamp. */` inline-field-comment convention.
- `FrontPageResult` discriminated union (lines 52-54): add `sections: SectionGroup[]` to the `"ok"` variant alongside the existing `articles: Article[]`, keeping the discriminant-on-`status` pattern unchanged. Add a new `export type SectionGroup = { section: Section; articles: Article[] };` following the same flat-object-type convention.
- Doc comment above `FrontPageResult` (lines 46-51) explicitly says "must never throw" — do not weaken this contract when adding `sections`.

---

### `src/components/CveChips.tsx` (component, SSR render)

**Analog:** `src/components/SourceTierBadge.tsx` (full file above, 42 lines)

**Imports pattern** (lines 1-2):
```typescript
import clsx from "clsx";
import type { SourceTier } from "@/lib/types";
```
`CveChips.tsx` doesn't need a config-record lookup (RESEARCH.md's draft hardcodes one class string), so `clsx` may be unnecessary unless composing conditional classes — follow `SourceTierBadge`'s `@/lib/types` path-alias import style regardless.

**Pill construction pattern** (lines 17-29, 31-41): a `Record<Key, string>`-keyed (or here, single-constant) Tailwind class string using the exact `{hue}-50 / {hue}-700 / {hue}-200` triad, and a small stateless function component that returns a `<span>` (or here `<a>`) with `inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap` as the base classes:
```typescript
export function SourceTierBadge({ tier }: { tier: SourceTier }) {
  return (
    <span className={clsx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", TIER_STYLES[tier])}>
      {tier}
    </span>
  );
}
```
Copy this exact base-class string verbatim into `CveChips.tsx`'s `CHIP_CLASSES` (already done in RESEARCH.md's Pattern 6 draft — confirmed consistent with this analog) so the chip matches the tier badge's shape/size per D-15, adding only `bg-red-50 text-red-700 ring-1 ring-inset ring-red-200 font-mono` as the color/font delta. Doc comment above the component should cite D-14/D-15 the way `SourceTierBadge`'s comment (lines 4-16) cites D-01/D-02/D-03/D-04.

**No client-side state, no `"use client"` directive** — `SourceTierBadge` is a plain Server Component (no hooks, no directive); `CveChips` must stay the same (plain `<a>` links only, per RESEARCH.md's explicit "no client interactivity" architecture-map entry).

---

### `src/components/ArticleCard.tsx` (UPDATE — add `<CveChips>` to meta row)

**Analog:** itself, lines 36-41 (the meta row):
```typescript
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {article.source}
        </span>
        <SourceTierBadge tier={article.sourceTier} />
      </div>
```
**Pattern to copy:** insert `<CveChips cves={article.cves} />` immediately after `<SourceTierBadge tier={article.sourceTier} />` inside this same `div` — the row is already `flex flex-wrap items-center gap-2`, so D-15's "wrap on narrow viewports" requirement is satisfied by the existing container with zero new CSS, exactly as RESEARCH.md's Pattern 6 notes. Add the import `import { CveChips } from "@/components/CveChips";` alongside the existing `import { SourceTierBadge } from "@/components/SourceTierBadge";` (line 2), keeping the `@/components/...` path-alias convention. The file's own top-of-file doc comment (lines 1-30) explicitly enumerates "All six UI-02 fields render as plain JSX text nodes" — update this comment to note the CVE chips are a 7th rendered element and still not raw-HTML injection (matches the "plain JSX text node" guarantee, since `CveChips` also emits plain string children).

---

### `src/app/page.tsx` (UPDATE — render `result.sections` instead of flat `result.articles`)

**Analog:** itself, full current file above (40 lines).

**Pattern to copy exactly:**
- The **discriminant-only branch** (line 19: `const articles = result.status === "ok" ? result.articles : [];`) — keep this exact shape but rename/retarget to `const sections = result.status === "ok" ? result.sections : [];`.
- The **empty-state check stays keyed on total article count, not section count** — page.tsx's current `articles.length === 0` empty-state check (line 27) must become an aggregate check (e.g. `sections.length === 0`, since `groupBySection` already drops empty section buckets per D-16, an empty `sections` array is exactly equivalent to zero articles overall) — preserves the file's own doc-comment promise (lines 4-10) that the quiet empty state is unconditional.
- **Nested map, one level added**: outer `.map` over `sections` rendering `<h2>{emoji} {section}</h2>` (D-16's per-non-empty-section heading), inner `.map` over `group.articles` rendering `<ArticleCard key={article.url} article={article} />` exactly as today (line 34) — the `key={article.url}` choice is unchanged and becomes newly *safe* to rely on for uniqueness once `dedupe.ts` guarantees no two rendered articles share a URL (already flagged as an Integration Point in CONTEXT.md).
- **Update the doc comment** (lines 4-16): the current comment explicitly says "Ordering/ranking is Phase 3's concern; two articles sharing a published timestamp both render as separate cards" and "no sort, group, filter, or dedupe here" — this remains literally true (page.tsx still does zero pipeline logic, it only iterates pre-grouped/pre-ranked data), but update the comment to state the *new* contract: sections and per-section ordering arrive fully resolved from `getFrontPage()`, and page.tsx's only job is mapping two nested arrays into headings/cards.
- **No section count/grid/filter/"show more"** per D-16 — do not add a `<span>{group.articles.length}</span>` count badge or grid wrapper; that's explicitly Phase 4 scope.

## Shared Patterns

### Pure-function pipeline stage with `../types.ts` import + explicit `.ts` extension
**Source:** `src/lib/pipeline/filterLookback.ts` (whole file), `src/lib/pipeline/sortByRecencyDesc.ts` (whole file)
**Apply to:** `dedupe.ts`, `classify.ts`, `extractCves.ts`, `rank.ts`, `groupBySection.ts`, `canonicalizeUrl.ts`, `normalizeTitleForDedupe.ts`, `decodeHtmlEntities.ts`
```typescript
import type { Article } from "../types.ts";

export function stageFn(articles: Article[] /* , ...params */): Article[] {
  // pure, synchronous, no I/O, returns a new array/value
}
```

### Doc-comment convention: cite the decision ID and any live evidence
**Source:** `src/lib/pipeline/truncateSummary.ts` lines 1-17, `src/lib/config/sources.ts` lines 1-20, `src/components/SourceTierBadge.tsx` lines 4-16
**Apply to:** every new file
Every new module/component/config file opens with a `/** ... */` block that (a) states what the code does, (b) cites the specific decision ID it satisfies (D-01, D-04, D-09, etc.), and (c) references measured/live evidence from RESEARCH.md where it exists (e.g. the future-dated Dark Reading item, the 81-article snapshot counts). This is the single most consistent stylistic convention across the whole codebase — treat it as mandatory, not optional polish.

### Config-table with per-entry rationale comments
**Source:** `src/lib/config/sources.ts` lines 28-34, 41-45, 58-68
**Apply to:** `src/lib/config/sections.ts`, `src/lib/config/ranking.ts`
Any keyword/weight/order value that deviates from an "obvious" default gets an inline comment directly above it explaining why, per D-07's explicit requirement ("every deviation... documented in a code comment").

### Never-throws orchestrator contract
**Source:** `src/lib/pipeline/getFrontPage.ts` lines 18-27
**Apply to:** `getFrontPage.ts` (updated) only — this is the single orchestrator; no other file should reimplement a try/catch-to-discriminated-result pattern. New stages (`dedupe`, `classify`, `rank`, etc.) are plain pure functions that must not throw on well-typed `Article[]` input in the first place, so the single outer `try` in `getFrontPage.ts` remains the only error boundary.

### Server Component, no client directive, plain-JSX-text-only rendering
**Source:** `src/components/ArticleCard.tsx` lines 11-30, `src/components/SourceTierBadge.tsx` (whole file)
**Apply to:** `CveChips.tsx`, `ArticleCard.tsx` (updated), `page.tsx` (updated)
No `"use client"`, no `dangerouslySetInnerHTML`, no hooks. All dynamic text renders as ordinary JSX children (never HTML-injected), preserving threat T-01-07's closed status. `decodeHtmlEntities` decoding a title does not reopen this threat, since the decoded string is still a plain JSX text child (see RESEARCH.md "Don't Hand-Roll" table, row 1).

## No Analog Found

None — every planned Phase 3 file has a clear, direct in-repo analog, since the codebase's existing "one pure function per pipeline stage, one config-data module, small Server Components" architecture already covers dedupe/classify/rank/CVE-extract's exact shape.

## Metadata

**Analog search scope:** `src/lib/pipeline/`, `src/lib/config/`, `src/lib/types.ts`, `src/components/`, `src/app/page.tsx` (entire non-test source tree — the project is small enough for exhaustive review rather than sampling)
**Files scanned:** 15 (all non-test `.ts`/`.tsx` files under `src/`)
**Pattern extraction date:** 2026-09-23
