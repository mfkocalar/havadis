---
phase: 04-newspaper-front-page-filtering-mobile-polish
plan: 03
subsystem: ui
status: complete
tags: [playwright-adhoc, viewport-verification, mobile, sticky-bar, real-device, vercel-preview]

requires:
  - phase: 04-newspaper-front-page-filtering-mobile-polish
    provides: "Sticky filter bar, pills, SectionVisibility, expander, LastUpdated, data-* hooks (04-01, 04-02)"
provides:
  - "scripts/verify-viewports.mjs: reproducible Chromium emulation of the production build at 360, 390, 768, 1024, 1280 and 1440px (12 checks per width)"
  - "Fixes found by that run: pill sr-only spans no longer widen the mobile layout viewport; long unbreakable card titles wrap; pills scroll below 1024px and wrap from 1024px"
  - "Real-device sign-off on iOS Safari and Android Chrome (light and dark), plus the ring, 3-column and 768px-bar decisions"
affects: []

actuals:
  tokens: 4700
  tasks: 3
  commits: 3
plan_head_before: d3ce25ac2c558d2e9923f1c02fb805c63fad2428

tech-stack:
  added: []
  patterns:
    - "Ad hoc Playwright (npm install --no-save) in a scripts/ file outside the test glob, never a dependency"
    - "Mobile-emulation overflow check compares against the DEVICE width, because the layout viewport itself widens when content overflows"
    - "Absolutely positioned sr-only children need a positioned ancestor inside any overflow scroller"

key-files:
  created:
    - scripts/verify-viewports.mjs
  modified:
    - src/components/SectionFilterBar.tsx
    - src/components/ArticleCard.tsx

key-decisions:
  - "Task 1 answer, verbatim: \"Approved\" (ad hoc npm install --no-save playwright@1.63.0; publisher Microsoft, github.com/microsoft/playwright, not deprecated, no postinstall script)"
  - "Real-device check: \"All passed\" (iOS Safari and Android Chrome, light and dark, steps 1-6). Device model and OS strings were not provided"
  - "768 bar: A. The wrap switch moves from md to lg; this amends the UI-SPEC statement that pills wrap from 768px"
  - "ring: approve. Unpressed pills and the expander keep the ring-zinc-500 outline"
  - "3-col: keep. D-02's lg:grid-cols-3 is retained; the lg:grid-cols-2 xl:grid-cols-3 fallback is not applied"

requirements-completed: [UI-05, FILTER-01]

coverage:
  - id: D1
    description: "No sideways scroll and a layout viewport equal to the device width at 360, 390, 768, 1024, 1280 and 1440px"
    requirement: UI-05
    verification:
      - kind: e2e
        ref: "scripts/verify-viewports.mjs#no-horizontal-overflow (6 of 6 widths)"
        status: pass
      - kind: manual
        ref: "Task 3 step 1 on real iOS Safari and Android Chrome, light and dark"
        status: pass
    human_judgment: true
  - id: D2
    description: "Grid columns 1 / 2 / 3, pill scroller below 1024px and wrap from 1024px, tap targets, bar at most 96px, sticky, focus not under the bar"
    requirement: UI-05
    verification:
      - kind: e2e
        ref: "scripts/verify-viewports.mjs#grid-columns,pill-row,tap-targets,bar-height,sticky,focus-not-obscured"
        status: pass
    human_judgment: false
  - id: D3
    description: "Filtering and expanding issue zero network requests; visible sections follow the D-09 rule"
    requirement: FILTER-01
    verification:
      - kind: e2e
        ref: "scripts/verify-viewports.mjs#filter-zero-network,expander-zero-network (expander exercised on this build)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Updated text is relative after hydration; no console errors or hydration warnings at any width"
    requirement: UI-05
    verification:
      - kind: e2e
        ref: "scripts/verify-viewports.mjs#hydrated-updated,console-clean"
        status: pass
    human_judgment: false
  - id: D5
    description: "Real-device usability on iOS Safari and Android Chrome in both themes (UI-05, ROADMAP Success Criterion 3)"
    requirement: UI-05
    verification:
      - kind: manual
        ref: "Task 3 steps 1-6; user answer \"All passed\""
        status: pass
    human_judgment: true
---

# Phase 4 Plan 03: Viewport and Real-Device Verification Summary

**Ad hoc Playwright run over six widths against the production build, which found and fixed a mobile layout-widening bug; the user then passed the page on real iOS Safari and Android Chrome and signed off the three UI-SPEC decisions.**

## Outcome

- UI-05 and FILTER-01 are verified: emulation at six widths (reproducible with `npm run build && node scripts/verify-viewports.mjs`) and by the user on real hardware.
- Playwright was used ad hoc only. `git diff --quiet -- package.json package-lock.json` exits 0 (MANIFESTS_UNCHANGED), re-checked after the final run.

## Task records

### Task 1: Playwright legitimacy gate (blocking-human)

User answer, verbatim: **"Approved"**. Verified before approval: `playwright@1.63.0` exists on the registry with no `deprecated` field; repository `git+https://github.com/microsoft/playwright.git`; published by GitHub Actions (CI release); no postinstall script; integrity `sha512-+7ziBLidS4NaNCdt57SUDT+wYmmd5fmiQejUic/kb+YsYSCPyOOE9sebzMjNmQrsnNpDJqd4WHvV/8lfKfUDUg==`. Nothing was installed before the approval. Cached Chromium 1243 was used, so no browser download occurred.

### Task 2: Script, six-width run, preview deploy

Commits: `30e1c6c` (page fixes), `2d26c72` (script), `2c853b2` (wrap breakpoint amendment).

**Final run** (`npm run build && node scripts/verify-viewports.mjs`): `VIEWPORTS_OK`, 72 PASS, 0 FAIL, 0 SKIP.

| Config | PASS | FAIL | SKIP |
| --- | --- | --- | --- |
| mobile-360 (360x800, DPR 3, touch) | 12 | 0 | 0 |
| mobile-390 (390x844, DPR 3, touch) | 12 | 0 | 0 |
| tablet-768 | 12 | 0 | 0 |
| desktop-1024 | 12 | 0 | 0 |
| desktop-1280 | 12 | 0 | 0 |
| desktop-1440 | 12 | 0 | 0 |

Checks per width: no-horizontal-overflow, card-text-contained, grid-columns, pill-row, tap-targets, bar-height, sticky, focus-not-obscured, hydrated-updated, filter-zero-network, expander-zero-network, console-clean.

- `EXPANDER_EXERCISED yes` at all six widths (3 of 7 sections have 9 or more articles on this build). The build was not the empty state, so no check was skipped.
- `TITLE_CLAMP_RATE desktop-1024 16/66` (24%) and `TITLE_CLAMP_RATE desktop-1280 1/66` (1.5%). Counts are over all cards with the overflow regions unhidden.
- Screenshots (light and dark for mobile-360, desktop-1024, desktop-1280): `/var/folders/81/slbflclx3vjcxx7q_8tdqcvm0000gq/T/havadis-viewports-FiHEPc/`.
- `npm test`: 251 tests, 244 pass, 0 fail, 7 skipped. `npm run lint`: clean, including the script.
- `scripts/verify-viewports.mjs` binds 127.0.0.1, is not under `test/`, and prints the `VIEWPORTS_OK` sentinel.

**Preview deployment:** https://security-news-p05vdi1uc-mfkocalars-projects.vercel.app (target preview, status Ready, deployed with `vercel deploy --yes`, never `--prod`). Unauthenticated HTTP status is **302** to `vercel.com/sso-api`: Vercel Deployment Protection is on, and the user signed in on the phones. An authenticated `vercel curl /` returned the page with `data-filter-bar`. This preview was built from commit `30e1c6c`. It does not include `2c853b2` (the wrap breakpoint), which changes layout only between 768px and 1023px; see "Preview coverage" below.

### Task 3: Real-device check (blocking-human)

- **Result: "All passed"** for steps 1-6 on a real iOS phone (Safari) and a real Android phone (Chrome), each in light and dark system theme.
- **Devices:** the user did not provide a model or OS version for either phone, so these are **not provided**. The reported viewport widths are likewise not provided. The phase verifier should carry this gap into the UAT artifact as is.
- Step 7 (3-column backstop), verbatim: **"3-col: keep"**. `lg:grid-cols-3` is retained; the fallback is not applied.
- Step 8 (ring amendment), verbatim: **"ring: approve"**. See 04-01-SUMMARY.md for the measured ratios.
- Extra decision (768px bar), verbatim: **"768 bar: A"**.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pill sr-only spans widened the mobile layout viewport**
- **Found during:** Task 2 first run (mobile-360 and mobile-390 expander taps failed with "pointer events intercepted").
- **Issue:** each pill carries an `sr-only` (position: absolute) span whose containing block was the sticky bar, outside the pill scroller's clip. The spans sat at x of about 1200px and made mobile Chromium widen the layout viewport to 1038px (sideways scroll or zoom-out on a real phone; RESEARCH Pitfall 6). Isolated by bisection: removing the pill group, or `overflow-x: clip` on html and body, or `position: relative` on the group restored 360px.
- **Fix:** `relative` on the pill scroller in `SectionFilterBar.tsx`.
- **Commit:** 30e1c6c

**2. [Rule 1 - Bug in own script] The no-horizontal-overflow check was vacuous**
- **Issue:** it compared `scrollWidth` to `innerWidth`, which widens together with the layout viewport, so it passed on the broken page.
- **Fix:** it now asserts `innerWidth === device width` and `scrollWidth <= device width`. Stricter, not looser.
- **Commit:** 2d26c72

**3. [Rule 1 - Bug] An unbreakable URL in a card title was clipped**
- **Issue:** for example the SANS ISC Stormcast title: a URL token about 378px wide in a card with about 280px of content width, hidden by `line-clamp`'s overflow instead of wrapping.
- **Fix:** `break-words` on the `ArticleCard` title. `ArticleCard` was listed as reused as-is; this is a one-class change. A `card-text-contained` check was added to the script.
- **Commit:** 30e1c6c

**4. [Rule 1 - Bug] Two-row bar was 97px against the 96px scroll-padding**
- **Fix:** `md:py-1.5` on the bar's inner container (93px at two rows). Mobile bar unchanged.
- **Commit:** 30e1c6c

**5. [UI-SPEC amendment, user-approved] Pills wrap from lg instead of md**
- **Issue:** the pills total about 1184px. At 768px the group is 596px wide (the Updated text takes 108px), so they wrapped to 3 rows and the bar was 133px, failing the plan's own "at most 96px" truth. Two plan truths conflicted ("wrap from 768" and "bar at most 96"); the UI-SPEC had assumed at most 2 rows. Not applied silently: raised at the Task 3 checkpoint.
- **Decision:** "768 bar: A" (options were A: wrap from lg; B: raise scroll-padding and accept up to 133px; C: compact pills at 768).
- **Fix:** below 1024px the pills scroll in one row (bar about 57px at 768); from 1024px they wrap to 2 rows (93px). Four class prefixes in `SectionFilterBar.tsx` (`md:` to `lg:` for wrap, overflow and padding reset, and `max-md:scrollbar-none` to `max-lg:`), plus `md:px-1` so the focus outline fits inside the scroller at 768-1023px. The script's `pill-row` threshold moved from 768 to 1024 to match the amended spec; this is recorded here rather than treated as loosening a check.
- **Commit:** 2c853b2

## Preview coverage

Phones (under 768px) were verified on the preview built from `30e1c6c`. Commit `2c853b2` changes only classes with `md:` and `lg:` prefixes plus `max-md:` to `max-lg:` for the scrollbar utility, so the rendered result below 768px is identical. I did not redeploy a preview; the 768-1023px range (tablets) is verified by emulation only (tablet-768 passes all 12 checks) and has not been seen on a real tablet.

## Known Stubs

None.

## Threat Flags

None. The script is local-only, binds 127.0.0.1, and the preview adds no new endpoints (T-04-10 accepted, T-04-12 and T-04-13 mitigated as planned; T-04-SC and T-04-11 satisfied by the two blocking-human gates).

## Self-Check: PASSED

- scripts/verify-viewports.mjs, src/components/SectionFilterBar.tsx, src/components/ArticleCard.tsx exist.
- Commits 30e1c6c, 2d26c72, 2c853b2 exist on gsd/phase-04-newspaper-front-page-filtering-mobile-polish.
- `commits: 3` measured with `git rev-list --count d3ce25a..HEAD` at write time.
