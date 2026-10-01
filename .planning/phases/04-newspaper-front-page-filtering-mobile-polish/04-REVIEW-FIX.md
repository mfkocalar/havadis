---
phase: 04-newspaper-front-page-filtering-mobile-polish
fixed_at: 2026-10-01T00:00:00Z
review_path: .planning/phases/04-newspaper-front-page-filtering-mobile-polish/04-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 4: Code Review Fix Report

**Fixed at:** 2026-10-01
**Source review:** .planning/phases/04-newspaper-front-page-filtering-mobile-polish/04-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (0 Critical, 4 Warning; Info excluded by scope)
- Fixed: 4
- Skipped: 0

Edits were made in the main checkout (`workflow.use_worktrees` is `false`), on branch `gsd/phase-04-newspaper-front-page-filtering-mobile-polish`. Verification ran in the main checkout, so the numbers are reproducible from the tree.

## Fixed Issues

### WR-03: Hover timestamp in `ArticleCard` uses the server's locale and time zone, with no zone label

**Files modified:** `src/components/ArticleCard.tsx`
**Commit:** 5c83aec
**Applied fix:** Replaced `new Date(...).toLocaleString()` with `formatUtcDateTime(article.publishedAt)` (deterministic `YYYY-MM-DD HH:MM UTC`). Note that WR-04 (below) then removed the `title` attribute altogether, so the final state of the card has no hover tooltip. The formatter now supplies the visible text.

### WR-04: Card relative times are frozen at render time and contradict the "Updated" text on a stale page

**Files modified:** `src/components/ArticleCard.tsx`
**Commit:** b88880e
**Applied fix:** The card `<time>` now renders the absolute, zone-labelled UTC date and time (`formatUtcDateTime`) instead of `formatRelativeTime`. The `title` tooltip is removed because it is now redundant (and was unreachable on touch and keyboard). The header comment records the reason.

**Why this option (explicit choice):**
- Of the options the reviewer offered, an absolute time is the least invasive. It stays a Server Component with zero new client JavaScript.
- Reusing the clock store in a client `<time>` would mean about 64 client islands, each subscribing to the clock. That is a bigger client surface than "keep client surface minimal" allows.
- An absolute UTC time is true at any age of the cached HTML, so it cannot contradict the bar's live "Updated Xh ago" text. The page stays statically prerendered at 900 s (production test still passes the `initialRevalidateSeconds === 900` assertion).
- Trade-off: cards lose the "5m ago" vocabulary. The full date is shown rather than `HH:MM UTC` alone, so the 24h window cannot make the time ambiguous. `formatRelativeTime` is still used by `LastUpdated`.

### WR-02: `verify-viewports.mjs` reports `VIEWPORTS_OK` (exit 0) when it verified nothing

**Files modified:** `scripts/verify-viewports.mjs`
**Commit:** 1a91a90
**Applied fix:**
- An empty-state render now records a real `FAIL <config> page-has-sections` for each of the six widths, so the script exits 1 and prints `VIEWPORTS_FAILED <count>` instead of `VIEWPORTS_OK`.
- Added an `expanderExercised` counter. If no config exercised the expander, the script fails with `expander-exercised` and exit 1. A new `--allow-no-expander` flag downgrades this to an explicit `EXPANDER_NEVER_EXERCISED allowed by --allow-no-expander` line, for quiet days. The per-config `SKIP`/`EXPANDER_EXERCISED no` output is kept.
- Header docs updated.

**Verification:**
- Normal run: `VIEWPORTS_OK`, exit 0.
- Failure path: a temporary copy of the script with a nonexistent section selector, which simulates the empty state, printed `VIEWPORTS_FAILED 13` (6 x `page-has-sections`, 6 x `empty-state-no-bar`, 1 x `expander-exercised`). The temp copy was deleted.

### WR-01: Unlayered global rules override Tailwind v4 utilities (body colours, heading and paragraph line-height)

**Files modified:** `src/app/globals.css`, `src/lib/filterControlStyles.test.ts`
**Commit:** 548e08e
**Applied fix:**
- Moved the `body`, `h1,h2,h3` and `p` rules into `@layer base`, with a comment explaining why. The `html { scroll-padding-top }` rule is left unlayered (no utility conflicts).
- The body now resolves to the intended `bg-zinc-50` / `dark:bg-zinc-950` from `layout.tsx`. Line-heights on headings and paragraphs now follow `leading-*` and `text-*` utilities.
- Updated the contrast gate's page surfaces in `filterControlStyles.test.ts`. The test previously read only the `--background` root values (`#ffffff` / `#0a0a0a`), which are no longer the actual page background. It now measures zinc-50 / zinc-950 and keeps the root values as extra worst-case surfaces. This adds surfaces; no threshold or assertion was loosened, and all contrast tests pass.

**Verification (the check the task made conditional):** After this change I ran `npm run build && node scripts/verify-viewports.mjs`. The result was 72 PASS, 0 FAIL, 0 SKIP and `VIEWPORTS_OK`. The sticky-bar height gate (at most 96px) and focus-not-obscured held at all six widths. No revert was needed.

## Skipped Issues

None.

## Final verification

Run in the main checkout, after all four fixes:
- `npm test`: 251 tests, 244 pass, 0 fail, 7 skipped (the skips were already there and none were added).
- `npm run lint`: clean.
- `npx tsc --noEmit`: clean.
- `npm run build && node scripts/verify-viewports.mjs`: `VIEWPORTS_OK` (exit 0).
- Playwright was already present in `node_modules`, so no install was needed. `package.json` and `package-lock.json` are unchanged.
- `.planning/config.json` and `.planning/ui-reviews/` were not touched.

---

_Fixed: 2026-10-01_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
