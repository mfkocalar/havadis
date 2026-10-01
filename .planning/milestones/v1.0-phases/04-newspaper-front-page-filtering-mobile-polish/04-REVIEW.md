---
phase: 04-newspaper-front-page-filtering-mobile-polish
reviewed: 2026-10-01T00:00:00Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - scripts/verify-viewports.mjs
  - src/app/globals.css
  - src/app/layout.tsx
  - src/app/page.tsx
  - src/components/ArticleCard.tsx
  - src/components/FrontPageFilter.tsx
  - src/components/LastUpdated.tsx
  - src/components/SectionExpander.tsx
  - src/components/SectionFilterBar.tsx
  - src/lib/config/frontPageLayout.ts
  - src/lib/filterControlStyles.ts
  - src/lib/formatRelativeTime.ts
  - src/lib/formatUtcTime.ts
  - src/lib/pipeline/getFrontPage.ts
  - src/lib/planSectionCap.ts
  - src/lib/sectionFilter.ts
  - src/lib/types.ts
findings:
  critical: 0
  warning: 4
  info: 6
  total: 10
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-10-01
**Depth:** standard
**Files Reviewed:** 17 source files, plus their `*.test.ts` files and `test/productionPage.test.ts`
**Status:** issues_found

## Summary

I reviewed the Phase 4 filter bar, section cap, "Updated" freshness text, card grid and viewport script. I also ran the checks that don't need a build:

- `npx tsc --noEmit` and `npx eslint src scripts test` are both clean.
- The five pure-logic test files pass (43 tests).
- I did not run `test/productionPage.test.ts` or `scripts/verify-viewports.mjs`, because both need a production build and (for the script) Playwright.

I found no critical issues:

- Feed text never crosses into a client component. Only closed-enum section names, emoji, counts and the server-generated ISO timestamp do.
- All feed fields render as JSX text nodes.
- Article links are limited to `http:` and `https:` in `normalize.ts`.
- The route stays static: no request-time APIs, and the production test pins `initialRevalidateSeconds === 900`.
- `useSyncExternalStore` is used correctly for the clock, with a `null` server snapshot, so there is no hydration mismatch.
- The `hidden`-attribute approach keeps every card in the server HTML.

The defects that remain:

- Unlayered rules in `globals.css` silently override Tailwind utilities.
- The viewport script can report success without checking anything.
- Two server-render time-formatting problems in `ArticleCard`.
- A set of smaller robustness and accessibility items.

## Warnings

### WR-01: Unlayered global rules override Tailwind v4 utilities (body colours, heading and paragraph line-height)

**File:** `src/app/globals.css:22-28, 36-44` (interacts with `src/app/layout.tsx:27`, `src/components/ArticleCard.tsx:62,91`)
**Issue:** Tailwind v4 emits utilities inside `@layer`. Unlayered author CSS beats every layered rule regardless of specificity. These unlayered rules therefore win over the utility classes on the same elements:
- `body { background: var(--background); color: var(--foreground) }` defeats `bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50` on `<body>`. The page renders `#ffffff` / `#0a0a0a`, not zinc-50 / zinc-950. The white cards therefore sit on a white page and are separated only by border and shadow.
- `h1,h2,h3 { line-height: 1.25 }` and `p { line-height: 1.6 }` defeat `leading-snug` and `leading-relaxed` in `ArticleCard`. They also defeat the line-height that `text-xl`, `text-sm` and `text-3xl` set on those elements, including the masthead `<p className="text-3xl ...">` in `layout.tsx`.

The rules predate Phase 4 (scaffold and 01-02). Phase 4 now builds on them:
- `filterControlStyles.test.ts` reads page colours from `globals.css`, so it already assumes this override.
- The 96px `scroll-padding-top` budget and the viewport script's 96px bar-height gate depend on line-heights nobody chose deliberately.

The result is dead utility classes and a layout that differs from what the markup says.

**Fix:** Move the global rules into a layer so utilities can override them, or delete the duplicates:
```css
@layer base {
  body { background: var(--background); color: var(--foreground); font-family: var(--font-sans), Arial, Helvetica, sans-serif; }
  h1, h2, h3 { line-height: 1.25; }
  p { line-height: 1.6; }
}
```
If the layered version is adopted, re-run the viewport script and `filterControlStyles.test.ts`, and re-verify the contrast surfaces. The body background will change to zinc-50, which is lighter than the white the test currently assumes.

### WR-02: `verify-viewports.mjs` reports `VIEWPORTS_OK` (exit 0) when it verified nothing

**File:** `scripts/verify-viewports.mjs:161-177, 427-432`
**Issue:** If the build renders the empty state (a feed outage, or a quiet window), every layout check is converted to `SKIP`. `failures` stays 0 and the script prints `VIEWPORTS_OK` and exits 0 for all six widths. The ok-but-empty and error branches of `page.tsx` produce exactly this state, and the script's own header says "a failing check is a defect in the page". An agent or CI step that gates on the exit code gets a false green with no filter bar, grid, sticky or expander check performed.

The same pattern applies to the expander. When no section has 9 or more articles, the script prints `EXPANDER_EXERCISED no` and still exits 0.

**Fix:** Count skipped required checks, or make the empty state a distinct non-zero exit:
```js
let emptyStateConfigs = 0;
// in the sectionCount === 0 branch: emptyStateConfigs += 1;
// at the end:
if (failures === 0 && emptyStateConfigs > 0) {
  console.log(`VIEWPORTS_INCONCLUSIVE ${emptyStateConfigs} config(s) rendered the empty state`);
  exitCode = 3;
}
```
Optionally take an `--require-expander` flag so a quiet day cannot silently skip the expander check.

### WR-03: Hover timestamp in `ArticleCard` uses the server's locale and time zone, with no zone label

**File:** `src/components/ArticleCard.tsx:34, 98`
**Issue:** `new Date(article.publishedAt).toLocaleString()` runs in a Server Component. The result is frozen into the statically prerendered HTML and shown to every visitor as the `title` tooltip. On Vercel that means the server's default locale and zone (en-US, UTC) with no zone indicator. A reader in another zone sees an unlabeled time that looks local but isn't. `LastUpdated` handles the same problem correctly with a labeled UTC string, so the two timestamps on the page are now inconsistent in kind. A `title` attribute is also unreachable on touch devices and by keyboard.

**Fix:** Reuse the deterministic, labeled formatter:
```tsx
import { formatUtcDateTime } from "@/lib/formatUtcTime";
const absoluteTime = formatUtcDateTime(article.publishedAt);
```

### WR-04: Card relative times are frozen at render time and contradict the "Updated" text on a stale page

**File:** `src/components/ArticleCard.tsx:101` (with `src/components/LastUpdated.tsx:52-58`)
**Issue:** `formatRelativeTime(article.publishedAt)` runs on the server at snapshot time and is baked into the cached HTML. Phase 4 deliberately makes the bar report the snapshot's true age ("Updated 72h ago") on an idle cached page, but the cards on that page still say "5m ago" or "2h ago". Under ISR the HTML can be served stale for an arbitrary time on a low-traffic site. The two freshness signals then disagree, and the cards overstate how recent the news is. This is the misleading-freshness problem Pitfall 4 tried to avoid, applied to the cards instead of the bar.

**Fix:** Either render card times as a snapshot-anchored label (for example the UTC `HH:MM` via `formatUtcTime`, or "N h before update"), or make the card `<time>` a tiny client component that reuses the same minute-tick external store as `LastUpdated`. If the current behaviour is accepted, record it as a known limitation in `ArticleCard`'s header comment.

## Info

### IN-01: `startServer` can verify the wrong server and has no early failure path (script and production test)

**File:** `scripts/verify-viewports.mjs:109-132`, `test/productionPage.test.ts:94-111`
**Issue:** If something already listens on port 3200 (script) or 3100 (test), the spawned `next start` dies with `EADDRINUSE`. The readiness poll still succeeds against the foreign process, and the checks run against the wrong server. There is also no `server.on("exit")` / `on("error")` handler. A missing build or a wrong working directory (`ENOENT` for `node_modules/.bin/next` resolved from `process.cwd()`) surfaces as an unhandled `'error'` event, or as a 30s wait.

**Fix:** Attach `server.once("exit", ...)` and `server.once("error", ...)` and reject the readiness promise on either. Optionally probe the port before spawning and bail out if it is taken. Also handle `SIGTERM` alongside `SIGINT` so the child is not orphaned.

### IN-02: Hidden-scrollbar pill scroller has no scroll affordance for mouse users at 768-1023px

**File:** `src/components/SectionFilterBar.tsx:92`
**Issue:** `max-lg:scrollbar-none` removes the only visible cue that the row scrolls. Below `lg`, the later pills are clipped at the right edge. Touch users can discover this by swiping a partly cut-off pill. Mouse and keyboard users at tablet widths or in a narrow desktop window get no cue, and horizontal wheel scrolling is not guaranteed.

**Fix:** Keep the scrollbar visible from `md` (apply `max-md:scrollbar-none` only), or add an edge fade or mask on the scroller.

### IN-03: Expander button changes its label and `aria-expanded` together

**File:** `src/components/SectionExpander.tsx:67, 76`
**Issue:** The disclosure pattern expects either a stable label with `aria-expanded` toggling, or a changing label without it. Doing both makes some screen readers announce "Show fewer, expanded", which reads as contradictory.

**Fix:** Keep the accessible name stable, for example `aria-label={`Show all ${total} articles in ${section}`}`, and let `aria-expanded` carry the state. Keep the visible text change if desired.

### IN-04: `LastUpdated` does not refresh when the tab returns from the background

**File:** `src/components/LastUpdated.tsx:37-40`
**Issue:** The only trigger is a 60s `setInterval`. Browsers throttle timers in background tabs and bfcache-restored pages. After returning to a tab, the "Updated Xm ago" text can be stale until the next tick, up to a minute later (a longer gap in a throttled tab), and reads as more recent than it is.

**Fix:** In `subscribe`, also listen for `visibilitychange` and `pageshow` and call `onTick()` on each, removing the listeners in the cleanup.

### IN-05: Magic numbers duplicated across CSS, script and tests

**File:** `src/app/globals.css:52-54`, `scripts/verify-viewports.mjs:253`, `test/productionPage.test.ts:353, 374-376`, `src/lib/planSectionCap.test.ts`
**Issue:** The 96px bar budget is spelled `6rem` in CSS and `96` in the script. The sticky bar is sized in px-based `min-h-*` plus rem text, so user font scaling or 200% text zoom can push the bar past 6rem and re-obscure focus targets. The cap thresholds (9 and 6) are hard-coded in two test files even though `SECTION_CARD_CAP` and `MIN_HIDDEN_TO_COLLAPSE` are exported. Changing the config would silently desync the tests.

**Fix:** Import `SECTION_CARD_CAP` and `MIN_HIDDEN_TO_COLLAPSE` in the tests and derive the threshold from them. Note the 6rem/96 coupling in a single comment, or expose the bar height as a CSS variable.

### IN-06: Duplicated `<main>` class string and `sr-only` `<h1>` in the two `page.tsx` branches

**File:** `src/app/page.tsx:51-53, 71-78`
**Issue:** The empty-state and ok branches repeat the same long `main` class string and the same `<h1 className="sr-only">Latest</h1>`. A later tweak to one container is easy to miss in the other.

**Fix:** Extract `const MAIN_CLASSES = "mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12";`, alongside `CARD_GRID_CLASSES`.

---

_Reviewed: 2026-10-01_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
