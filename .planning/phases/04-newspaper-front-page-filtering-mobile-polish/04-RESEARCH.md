# Phase 4: Newspaper Front Page, Filtering & Mobile Polish - Research

**Researched:** 2026-09-30
**Domain:** Next.js 16 App Router (Cache Components OFF) Server/Client composition, Tailwind v4 responsive grid + sticky bar, hydration-safe client state, real-device mobile verification
**Confidence:** HIGH (stack is already installed; every risky claim below was probed in this session against the real installed packages)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Section Layout (UI-01)
- **D-01:** Each section's articles render as a **multi-column card grid**, not the single column from Phase 3 D-16. Section headings and urgency order (Phase 3 D-12) are unchanged; empty sections are still skipped.
- **D-02:** Breakpoints are **1 column on mobile, 2 on tablet, 3 on desktop** (Tailwind `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`). Cards keep the existing `ArticleCard` design, including the D-08 (Phase 2) three-line title and summary clamps.
- **D-03:** The page shell **widens from `max-w-4xl` to `max-w-6xl` or `max-w-7xl`** so three columns have comfortable card width. The masthead in `layout.tsx` widens to the same value so header and content stay aligned. The exact value is Claude's discretion.
- **D-04:** Sections with only 1-2 articles **leave the empty grid cells as they are**. No stretch-to-fill logic. — **Reversibility:** reversible — a grid-class change.

#### Section Length / "Show all N"
- **D-05:** Each section shows its **top 6 ranked cards** (two full desktop rows, three tablet rows, no ragged last row at 2 or 3 columns), followed by a client-side **"Show all N" expander** for the rest. This adopts the direction Phase 3 recorded under Deferred Ideas. There is no server round-trip and no pagination.
- **D-06:** **Tiny-overflow rule:** if hiding would save fewer than about 3 cards (e.g. a section of 7 or 8 with a cap of 6), render them all and show no expander. Claude picks the exact threshold.
- **D-07:** **All cards are in the initial server-rendered HTML.** The expander only toggles visibility through client state. This satisfies FILTER-01's "no new server fetch" and keeps content accessible and crawlable. The larger payload is accepted. The Phase 3 ranking order is preserved; the cap always shows the highest-ranked N.

#### Filter (FILTER-01)
- **D-08:** The control is a **row of toggle pills**, one per section (emoji + section name), each an on/off button with `aria-pressed`. Multi-select. Always visible, single-tap on mobile. Pills reuse the existing pill visual language (shape, size, focus ring) and must meet WCAG AA contrast in both states.
- **D-09:** **No pills selected = no filter: all sections show.** Selecting pills narrows the page to those sections; deselecting the last pill returns to everything. There is no "nothing selected" empty state to design.
- **D-10:** **No persistence.** Filter state is in-memory client state only. No URL query sync, no localStorage. Reload resets to all sections. This keeps the page fully cacheable and stateless. — **Reversibility:** reversible — URL sync can be added later without touching the pipeline.
- **D-11:** The pill bar is a **sticky bar below the masthead**, pinned while scrolling so users can re-filter anywhere on a long page. On narrow viewports the pills are a single horizontally scrollable row rather than wrapping to several lines, to save vertical space.

#### Freshness & Counts (UI-04)
- **D-12:** The **"last updated" timestamp lives in the sticky filter bar**, as small muted text at its trailing edge. On mobile it may drop below the pills or be compacted; Claude decides the exact responsive treatment.
- **D-13:** The timestamp is shown as **relative text ("Updated 4 min ago") with the absolute time on hover** (`title` attribute and a `<time dateTime>`), reusing `formatRelativeTime` and matching the article-card convention. **Caveat for research/planning:** the page is server-rendered and cached for about 15 minutes, so the relative string is computed at snapshot build time and does not track the viewer's clock. The planner must decide how to keep it honest (e.g. rendering it from a snapshot timestamp on the client, or accepting the snapshot-time value) and must thread a snapshot timestamp (`generatedAt`) through `getFrontPage()`'s result.
- **D-14:** Each section heading shows its **total article count as a muted number beside the heading** (e.g. "VULNERABILITIES 12"). The count is the section's full total, not the capped 6, and is unaffected by the expander. The same count also appears on each filter pill so users see volume before filtering.

### Claude's Discretion
- The exact container width (`max-w-6xl` vs `max-w-7xl`) and exact tiny-overflow threshold (D-03, D-06).
- Client/server component split. `page.tsx` and `ArticleCard` are Server Components; the filter and the expanders need a client boundary. Keep cards server-rendered where possible (pass them as children into the client wrapper) and keep the never-throws contract of `getFrontPage`.
- How the filter and the per-section expanders interact (e.g. whether the expander state survives a pill toggle).
- The sticky bar's exact offset, background and shadow, and how the `last updated` text compacts on mobile (D-11, D-12).
- How UI-05 is verified at real device widths. The criterion says "not just a resized desktop browser window", so the plan must include a concrete mobile verification step (real viewport emulation at 360-390px plus a human check) rather than relying on responsive classes alone.
- Accessibility details for the pills and expanders (keyboard operation, focus order, `aria-expanded`/`aria-controls`).

### Deferred Ideas (OUT OF SCOPE)
- **URL-synced filter state (shareable filtered views):** considered and declined for v1 (D-10). Revisit only with a clear driver; it must stay client-only to preserve caching.
- **Featured "lead story" card per section:** offered as a hybrid layout and not chosen (D-01). Could be revisited as polish after v1.
- **Stretch-to-fill cards for sparse sections:** considered and declined (D-04).
- **Per-article share/copy-link, own RSS feed, source health signal, keyword search, archive:** already tracked as v2 requirements in REQUIREMENTS.md (SHARE-01, FEED-01, HEALTH-01, SEARCH-01, ARCHIVE-01).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UI-01 | Responsive, newspaper-style front page, articles grouped under 7 sections in urgency order | Grid classes and `max-w-7xl` shell verified to compile in Tailwind 4.3.3; server-rendered `sections` already arrive in `SECTION_DISPLAY_ORDER`; cap/expander split via pure `planSectionCap` (Patterns 1, 3; Code Examples) |
| UI-04 | "Last updated" timestamp for the cached snapshot + article count per section | `generatedAt` threading through `composeFrontPage` (route is static/ISR, so render time == snapshot time); hydration-safe `useSyncExternalStore` clock (Pattern 4); counts derived server-side (Pitfall 9) |
| UI-05 | Readable/usable at ~360-390px and desktop, verified, not just a resized window | Three-tier verification; Playwright 1.63.0 + Chromium 1243 already cached on this machine; empirical 360px overflow probe already run (Pitfall 6, Environment Availability) |
| FILTER-01 | Client-side multi-section filter over the already-rendered snapshot, no reload, no server fetch | DOM-less context provider + `hidden` wrapper pattern; no `useSearchParams`/`cookies()`/`headers()` (Pattern 2, Pitfalls 1, 2, 10) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Extracted from `./CLAUDE.md` -> `@AGENTS.md`, and `./.claude/CLAUDE.md`. The planner must verify compliance; none of these are re-opened by this research.

- **AGENTS.md:** "This is NOT the Next.js you know" — read the relevant guide in `node_modules/next/dist/docs/` before writing code. Done for this phase: `01-app/01-getting-started/05-server-and-client-components.md` (see Sources). Do not commit-strip the AGENTS.md block that `next dev` regenerates.
- **Stack is decided:** Next.js 16.3.5 App Router + TypeScript 5.x (NOT 7.x) + Tailwind 4.x, Vercel Hobby. **Cache Components stays OFF** (`cacheComponents: true` / `'use cache'` forbidden). Plain `fetch` + `next.revalidate`.
- **Statelessness / cost:** no database, no paid services, nothing persisted (reinforces D-10: no localStorage/URL/cookie state).
- **Dependency minimalism ("What NOT to Use"):** no date library (`date-fns` etc.), no `tailwind-merge`, no `@tailwindcss/typography`, no UI kit / shadcn for v1. `clsx` 2.1.1 is already installed and is allowed.
- **Vercel Cron is not usable below daily on Hobby** — no pre-warm cron in this phase.
- **Public, no auth anywhere** (UI-06 remains true; `test/productionPage.test.ts` asserts no `set-cookie`).
- **Project rules inherited from Phase 3 audit (from 04-UI-SPEC.md):** only Tailwind scale values (no arbitrary values, no hardcoded colours), a `dark:` variant on every surface, all feed text as plain JSX text nodes (no `dangerouslySetInnerHTML`, threat T-01-07).
- **GSD workflow:** file edits happen only through a GSD command (`/gsd-execute-phase` for this phase's plans).

## Summary

Phase 4 needs **no new runtime dependency**. Everything is built from what is installed and verified in this session: `next@16.3.5`, `react@19.2.8`, `tailwindcss@4.3.3`, `clsx@2.1.1`. The architecture in 04-UI-SPEC.md is sound: a DOM-less client context provider, a sticky client filter bar, a per-section client visibility wrapper that renders `<div hidden>`, and a per-section client expander — all receiving Server-Component output (`ArticleCard`s, the `<section>`) as `children`, so the cards stay server-rendered and out of the client bundle (confirmed in the bundled Next.js 16 docs). The production route `/` is **static with `initialRevalidateSeconds: 900`** in the existing build's prerender manifest, so `generatedAt = new Date(now).toISOString()` sampled once in `getFrontPage` is exactly the ISR snapshot time.

Six concrete corrections/clarifications to the approved UI-SPEC came out of probing the real toolchain, and the planner should bake them in: (1) the spec's "render UTC first, switch to relative after mount, via effect" pattern **fails the project's own ESLint config** (`react-hooks/set-state-in-effect`, and `Date.now()` in render fails `react-hooks/purity`) — use `useSyncExternalStore` with a `null` server snapshot instead, and give `formatRelativeTime` an optional `now` parameter; (2) `scrollbar-none` **already exists in Tailwind 4.3.3** (and `max-md:scrollbar-none` compiles) so no `@utility` block is needed in `globals.css`; (3) React 19.2.8 **cannot render `hidden="until-found"`** (it emits plain `hidden=""`; `@types/react` 19.3.0 types `hidden` as `boolean` only; Safari support is partial) — this resolves the spec's first "unresolved" item: use plain `hidden`, and Ctrl+F on collapsed cards is an accepted v1 limitation; (4) Tailwind's preflight makes `[hidden]` win over any display utility (`display: none !important`), so the spec's "no display utility on the region" caution is harmless but unnecessary; (5) the unpressed pill/expander **ring colours (`zinc-400` light, `zinc-600` dark) are 2.56:1 and 2.29-2.57:1, below the 3:1 non-text-contrast bar** even though all *text* pairs pass — step the ring up to `zinc-500`; (6) SSR text-node splitting (`<!-- -->`) will break naive HTML assertions unless strings are built as single template-literal text nodes.

**Primary recommendation:** Implement exactly the UI-SPEC architecture with the six corrections above; keep all cap/threshold/time-format logic in pure `.ts` libs with colocated `node --test` tests (client `.tsx` cannot be unit-tested under this repo's `node --test` setup), extend `test/productionPage.test.ts` with invariant-based (not live-data-dependent) HTML assertions, and execute the three-tier UI-05 verification with the already-cached Playwright 1.63.0 / Chromium 1243 (not added to `package.json`) plus a real-phone check.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Grouping, ranking, urgency order, section counts | API / Backend (server pipeline) | — | Already done by `getFrontPage` -> `groupBySection`; counts are `group.articles.length`, computed on the server so they match the HTML |
| Cap-to-6 split (`planSectionCap`) and overflow partition | Frontend Server (SSR in `page.tsx`) | — | Pure function of a server-known total; all cards must be in initial HTML (D-07) |
| Snapshot timestamp (`generatedAt`) | API / Backend (pipeline, `getFrontPage`) | — | Sampled once from the same `now` (Phase 3 D-09); never a second clock read |
| Card rendering (`ArticleCard`, `<section>`, headings) | Frontend Server (RSC) | — | Reused unchanged; passed as `children` into client wrappers so they stay out of the client bundle |
| Filter state (selected set), pill toggling | Browser / Client | — | Must be zero-server-round-trip (FILTER-01); in-memory React state only (D-10) |
| Section show/hide on filter | Browser / Client | Frontend Server (markup already present) | Server emits every section; client only flips the `hidden` attribute |
| Expander open/closed | Browser / Client | Frontend Server (overflow markup already present) | Same: toggle visibility only (D-07) |
| Relative "Updated N m ago" | Browser / Client | Frontend Server (UTC first paint) | Only the client knows the viewer's clock; server HTML carries a deterministic UTC string so cached HTML is never misleading |
| Sticky bar, responsive grid, breakpoints | Browser / Client (CSS) | CDN / Static (cached HTML) | Pure CSS (`sticky`, Tailwind breakpoints); the HTML is cached on Vercel's CDN/ISR |
| Page caching / ISR window | CDN / Static + Frontend Server | — | Route is static, `initialRevalidateSeconds: 900`; nothing in this phase may make it dynamic |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | 16.3.5 | App Router, Server/Client composition, ISR | Already decided; `children`-slot interleaving confirmed in bundled docs [VERIFIED: node_modules/next/package.json + node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md] |
| react / react-dom | 19.2.8 | `useSyncExternalStore`, `useId`, `useState`, `useContext`, `flushSync` | Installed [VERIFIED: package.json:14-16 `"react": "19.2.8"`] |
| tailwindcss + @tailwindcss/postcss | 4.3.3 | Grid, sticky bar, `scrollbar-none`, `wrap-anywhere`, `min-h-11`, `max-md:` | All phase classes compiled in a scratch build this session [VERIFIED: compile probe, see Code Examples "Class verification"] |
| clsx | 2.1.1 | Pill pressed/unpressed class composition | Already installed and used by `SourceTierBadge` [VERIFIED: src/components/SourceTierBadge.tsx:1] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| playwright (ad hoc, NOT added to package.json) | 1.63.0 (cached in `~/.npm/_npx`) | Tier-2 emulated-viewport verification at 360/390/768/1024/1280/1440 | Only during the verification task; Chromium revision 1243 already downloaded [VERIFIED: `~/Library/Caches/ms-playwright/chromium-1243`, `playwright-core/browsers.json` revision "1243"] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `useSyncExternalStore` clock | `useState(false)` + `useEffect(() => setMounted(true))` | Fails `npm run lint` (`react-hooks/set-state-in-effect`) [VERIFIED: eslint run, see Pitfall 3] |
| Plain `hidden` overflow | `hidden="until-found"` + `beforematch` | React 19.2.8 drops the value; Safari partial; needs ref + `setAttribute`, losing SSR fidelity. Rejected for v1 |
| CSS-only filter (`:has()`/radio hacks) | Client context | Pills must be multi-select toggles with `aria-pressed`; a context provider is simpler and standard |
| `shadcn/ui` toggle/collapsible | Hand-rolled `<button aria-pressed>` / `<button aria-expanded>` | Out of budget/scope per STACK.md and CONTEXT; native buttons are fully accessible |

**Installation:** none. No new npm dependency. (Verification tooling below is ad hoc and must not touch `package.json`.)

**Version verification:** versions read from installed `node_modules/*/package.json` this session: next 16.3.5, react 19.2.8, tailwindcss 4.3.3, @types/react 19.3.0, eslint-plugin-react-hooks 7.1.1, Node v26.3.1, npm 11.17.0. [VERIFIED: local node_modules]

## Package Legitimacy Audit

No package is added to the project. One ad hoc verification-only tool was checked:

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| playwright | npm | mature (Microsoft); latest release published 2026-09-04 | ~116.7M/wk | github.com/microsoft/playwright | SUS (`too-new`: the *latest version* was published recently; the package itself is long-established, no postinstall, not deprecated) | Flagged — not installed into the project. Planner: put a `checkpoint:human-verify` before any `npm install`/`npx` of it; prefer the already-cached 1.63.0 at `~/.npm/_npx/3b8e4f9f66f3a791/node_modules/playwright` |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** `playwright` (recency heuristic only) — planner inserts `checkpoint:human-verify` before installing/running it.

Source for verdict: `gsd-tools query package-legitimacy check --ecosystem npm playwright` run this session. Playwright's identity as a Microsoft project is otherwise well known, but its provenance here is the legitimacy check plus on-disk presence, so treat it as flagged per protocol.

## Architecture Patterns

### System Architecture Diagram

```
                      (request, or ISR regeneration every 900s)
                                   |
                                   v
 page.tsx (Server Component, static route, revalidate 900 via fetch)
   |  await getFrontPage()  --> fanOut(13 sources) -> filterLookback -> composeFrontPage(now)
   |                                                         |
   |        SectionedFrontPageResult { status:"ok", articles, sections[], generatedAt }
   |
   |  status "error" or sections.length===0 ---> quiet empty-state <p>  (no bar, no provider)
   |
   v  otherwise, per section (server-side, pure):
   |     total = group.articles.length
   |     {visibleCount, hiddenCount} = planSectionCap(total)       (cap 6, threshold 9)
   |     primary = articles.slice(0, visibleCount)   overflow = articles.slice(visibleCount)
   |
   v  <FrontPageFilter>            client provider, renders NO DOM (Fragment)
        |-- <SectionFilterBar pills=[{section,emoji,count}] generatedAt=...>   client, sticky, OUTSIDE <main>
        |       |-- pills: <button aria-pressed> -> toggle(section)  ---> context state {selected:Set}
        |       |-- role=status live region (visually hidden)
        |       '-- <LastUpdated generatedAt>   useSyncExternalStore: UTC (SSR+hydration) -> relative (after mount, 60s tick)
        |
        '-- <main>
              '-- per section:
                   <SectionVisibility section>            client: reads context -> <div hidden={filtered-out}>
                     <section data-section aria-labelledby>   SERVER-rendered (children slot)
                        <h2> emoji SECTION <count>
                        <div flex-col gap-6>
                           <grid>  primary ArticleCards (server)
                           <SectionExpander total>          client: owns `open` state, button, region id
                              <div hidden data-overflow>   SERVER-rendered overflow grid (children slot)
                           </SectionExpander>
                        </div>
                     </section>
                   </SectionVisibility>

 Toggle pill / click expander  --->  React state only. No fetch, no navigation, no URL, no storage.
```

### Recommended Project Structure
```
src/
├── app/
│   ├── layout.tsx                  # masthead inner container max-w-4xl -> max-w-7xl (only that class)
│   ├── page.tsx                    # grid, counts, cap split, mounts client wrappers
│   └── globals.css                 # add html { scroll-padding-top: 6rem } ONLY (no @utility needed)
├── components/
│   ├── ArticleCard.tsx             # unchanged (Server)
│   ├── FrontPageFilter.tsx         # "use client": context provider, NO DOM
│   ├── SectionFilterBar.tsx        # "use client": sticky bar, pills, live region
│   ├── LastUpdated.tsx             # "use client": useSyncExternalStore clock
│   ├── SectionVisibility.tsx       # "use client": <div hidden> wrapper
│   └── SectionExpander.tsx         # "use client": overflow region + button
└── lib/
    ├── config/frontPageLayout.ts   # SECTION_CARD_CAP = 6, MIN_HIDDEN_TO_COLLAPSE = 3
    ├── planSectionCap.ts (+ .test.ts)   # pure; relative `.ts` imports so node --test can run it
    ├── formatUtcTime.ts (+ .test.ts)    # pure; `HH:MM UTC`, `YYYY-MM-DD HH:MM UTC`
    ├── formatRelativeTime.ts       # add optional `now = Date.now()` 2nd param (back-compatible)
    ├── types.ts                    # SectionedFrontPageResult ok-variant gains generatedAt
    └── pipeline/getFrontPage.ts    # composeFrontPage returns generatedAt
```

### Pattern 1: Server components passed as `children` into client wrappers
**What:** Client components receive already-rendered Server Component output through `children`; they are not pulled into the client module graph.
**When to use:** Every client wrapper in this phase (`SectionVisibility`, `SectionExpander`, `FrontPageFilter`).
**Example:**
```tsx
// Source: node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md
// "It does not apply to Server Components passed as children or other props. Those components are not
//  imported into the Client Component's module graph. They are rendered on the server and passed to the
//  Client Component as rendered output."
```
[VERIFIED: file read this session]

### Pattern 2: DOM-less provider + `hidden` wrapper (filter that never unmounts)
**What:** `FrontPageFilter` returns `<Context.Provider>{children}</Context.Provider>` with no wrapping element, so the sticky bar remains a direct child of `<body>` (keeps `position: sticky` semantics and `main.flex-1` in the `flex flex-col` body from `layout.tsx:27`). `SectionVisibility` reads context and renders `<div hidden={...}>`. Sections are hidden, never unmounted, so expander state survives filtering and all markup stays in the HTML.
**When to use:** The filter. Mirrors the spec's Interaction Contract.
**Note:** Tailwind preflight guarantees `[hidden]` hides regardless of utilities: `[hidden]:where(:not([hidden='until-found'])) { display: none !important; }` [VERIFIED: node_modules/tailwindcss/preflight.css:396-398].

### Pattern 3: Server-side cap partition with a pure function
**What:** `planSectionCap(total)` returns `{ visibleCount, hiddenCount }`; `page.tsx` slices `group.articles` accordingly. Constants live in `src/lib/config/frontPageLayout.ts`.
**When to use:** Every section. Totals 1-8 -> no overflow region and no button rendered at all.

### Pattern 4: Hydration-safe clock with `useSyncExternalStore`
**What:** The server snapshot is `null` (render deterministic UTC text). After hydration React re-renders with the client snapshot (current minute), and a 60 s interval notifies subscribers. No `setState` in an effect, no impure call in render.
**Why it matters:** the approved UI-SPEC pattern (mounted flag via effect) does not pass this repo's lint (Pitfall 3).
**Hydration contract (React docs):** `getServerSnapshot` "runs on the server when generating the HTML" and "on the client during hydration"; "Make sure that `getServerSnapshot` returns the same exact data on the initial client render as it returned on the server." [CITED: https://react.dev/reference/react/useSyncExternalStore]

### Anti-Patterns to Avoid
- **Conditional rendering of filtered-out sections or collapsed overflow cards** (`{open && ...}`, `.filter()` in the client): violates D-07, loses expander state, and removes cards from the crawlable HTML. Use `hidden`.
- **Wrapping the provider in a `<div>`:** changes sticky containing block and can break `main`'s `flex-1`.
- **Importing `@/lib/config/sections` into a client component:** drags `SECTION_KEYWORDS` (all classification regexes) into the client graph. Resolve emoji on the server and pass `{ section, emoji, count }[]` as serializable props.
- **`useSearchParams`, `cookies()`, `headers()`, `localStorage` anywhere in client code:** would make the route dynamic or break D-10/cacheability.
- **Reading `Date.now()` during render in a Client Component:** lint error (`react-hooks/purity`) and a hydration-mismatch risk.
- **Adding `cacheComponents`/`'use cache'`:** forbidden by project constraints.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Hiding scrollbars on the pill scroller | Custom `@utility scrollbar-none` + `::-webkit-scrollbar` CSS | Built-in `scrollbar-none` / `max-md:scrollbar-none` | Tailwind 4.3.3 emits `scrollbar-width: none` itself [VERIFIED: compile probe]. Touch browsers use overlay scrollbars anyway |
| Toggle semantics | ARIA-div buttons, roving tabindex | Native `<button type="button" aria-pressed>` | Enter/Space, focus, and AT state for free |
| Disclosure semantics | Custom focus management | Native `<button aria-expanded aria-controls>` + `hidden` region | No library needed; `useId()` provides the id |
| Class composition | Template-literal class strings | `clsx` (installed) | Already the project convention |
| Relative time | date library | Existing `formatRelativeTime` (+ optional `now` param) | STACK.md "What NOT to Use" |
| Client state sync across many components | External store / Redux / Zustand | One small React context + `useState` | 7 booleans of state |
| Horizontal scroll affordance | JS scroll shadows | The deliberately clipped third pill | Spec decision; CSS only |
| UI-05 verification | New test framework in `package.json` | Ad hoc Playwright run (cached) + human device check | Spec forbids adding a dependency; project test runner is `node --test` |

**Key insight:** this phase is almost entirely layout and a 7-element client state machine. Every hand-rolled solution above adds dependencies or accessibility debt for something native HTML or already-installed code provides.

## Runtime State Inventory

Not applicable. This is a greenfield UI phase (no rename/refactor/migration). Stored data: none (stateless). Live service config: none. OS-registered state: none. Secrets/env vars: none. Build artifacts: the existing `.next/` is git-ignored and must simply be rebuilt (`npm run build`) before `test/productionPage.test.ts`, which spawns `next start`. [VERIFIED: .gitignore `/.next/`, test/productionPage.test.ts:57]

## Common Pitfalls

### Pitfall 1: The provider wraps a DOM element and breaks the sticky bar / layout
**What goes wrong:** A `<div>` inside the provider becomes the flex child of `<body>`; `main`'s `flex-1` and the sticky bar's containing block change, and a stray wrapper may add spacing.
**Why it happens:** Habit of returning a wrapper element from a context provider.
**How to avoid:** `FrontPageFilter` returns only `<FilterContext.Provider value={...}>{children}</FilterContext.Provider>`.
**Warning signs:** Main content no longer fills the viewport height on short pages; bar not pinning.

### Pitfall 2: Re-rendering all 100+ cards on every toggle
**What goes wrong:** Card subtrees re-render on each pill toggle.
**Why it happens:** Cards put inside a client component's own JSX instead of arriving as `children`.
**How to avoid:** Cards are built in `page.tsx` (server) and passed as `children`. React keeps `children` element identity stable across state updates in the wrapper, so only the tiny consumers (`SectionVisibility`, bar) re-render. [ASSUMED — standard React element-identity behavior; confirm with a React DevTools "highlight updates" spot check in the emulated-viewport tier]

### Pitfall 3: Approved UI-SPEC clock pattern fails lint; `Date.now()` in render fails lint
**What goes wrong:** `useEffect(() => setMounted(true), [])` errors with `react-hooks/set-state-in-effect`; `Date.now()` directly in a client render errors with `react-hooks/purity`. `npm run lint` (ESLint 9 + `eslint-config-next` 16.3.5, `eslint-plugin-react-hooks` 7.1.1) would go red.
**Verified:** I linted three probe files against the project config via `eslint --stdin --stdin-filename`. Output, verbatim:
- Effect+setState: `Error: Calling setState synchronously within an effect can trigger cascading renders` (rule `set-state-in-effect`)
- `Date.now()` in render: `Error: Cannot call impure function during render ... react-hooks/purity`
- `useSyncExternalStore(subscribe, getNow, () => null)` with `getNow = Math.floor(Date.now() / 60_000) * 60_000` defined **outside** the component: **no findings**.
**How to avoid:** Use Pattern 4. Give `formatRelativeTime` an optional second arg `now: number = Date.now()` (back-compatible with `formatRelativeTime.test.ts`, which calls it with one arg) and pass the snapshot value from the store.
**Warning signs:** `npm run lint` failing on the new component.

### Pitfall 4: Accepting "Updated 72h ago" / ISR freshness overstatement without deciding
**What goes wrong:** (a) `formatRelativeTime` only has "just now / Nm / Nh" cases (by design for a 24h window); an idle cached page viewed days later would read "Updated 72h ago" (honest but odd). (b) `generatedAt` is the ISR *render* time; the feed bytes may come from the fetch Data Cache and be up to one fetch window (900 s) older than the render.
**Why it happens:** Two independent 900 s caches (page ISR and per-fetch Data Cache) are stacked.
**How to avoid:** Accept (a) as honest v1 behaviour (document it in the component comment) — a stale page is exactly when an honest large number is useful. For (b) treat `generatedAt` as "page snapshot built at" (this is what UI-04 asks: "last updated timestamp for the current cached snapshot"); verify on the Vercel preview by comparing `Updated` with the newest article time (human-verify step). Do not invent a second clock.
**Warning signs:** Preview shows "Updated just now" while the newest article is > 15 min older than expected.
[ASSUMED for (b): exact Next.js behaviour of stale Data Cache entries during an ISR regeneration was not re-verified this session; Phase 1 UAT already confirmed HIT/STALE behaviour on a real preview]

### Pitfall 5: SSR splits adjacent text nodes with `<!-- -->` and breaks HTML assertions
**What goes wrong:** `<p>Updated {time} UTC</p>` renders as `Updated <!-- -->14:32<!-- --> UTC`, so a test regex for `Updated 14:32 UTC` fails.
**Verified:** `renderToString(h("p", null, "Updated ", "14:32", " UTC"))` -> `<p>Updated <!-- -->14:32<!-- --> UTC</p>`; the single template-literal form `Updated ${t} UTC` -> `<p>Updated 14:32 UTC</p>`. [VERIFIED: node probe with react-dom/server 19.2.8]
**How to avoid:** Build every asserted string as **one** template-literal text node: `{`Updated ${formatUtcTime(generatedAt)}`}`. The same applies to pill text and the heading `{emoji} {section}` (existing `page.tsx:51` already has this shape; tests must not assert on it as contiguous text). Prefer `data-` hooks for tests.
**Warning signs:** Production test can't find the string that is visibly on the page.

### Pitfall 6: Long unbreakable tokens blow out the grid (verified NOT a problem with current clamps)
**What goes wrong (potential):** a 90-character unbroken token in a card at 360 px makes `scrollWidth` exceed `innerWidth`.
**Verified:** Playwright/Chromium probe, 360 px viewport, grid `repeat(1, minmax(0, 1fr))`, card padding 24 px. With the title and summary both line-clamped (`overflow: hidden`, as `ArticleCard` does), `scrollWidth === innerWidth === 360` with or without `min-w-0`. An *unclamped* paragraph with the same token overflowed to 1081 px. `ArticleCard`'s title and summary are both `line-clamp-3`, so it is safe unchanged. [VERIFIED: probe run this session]
**How to avoid:** Keep both clamps; do not add new unclamped feed-text elements to the card or bar. `wrap-anywhere` exists in 4.3.3 if a future element needs it.
**Warning signs:** The Tier-2 `scrollWidth <= innerWidth` assertion fails at 360/390.

### Pitfall 7: Unpressed pill/expander ring fails non-text contrast
**What goes wrong:** Text pairs in the spec all pass AA, but the unpressed pill is white-on-white (near-invisible fill) so its `ring-inset` outline is the only boundary. `ring-zinc-400` on white is 2.56:1 and dark `ring-zinc-600` on `zinc-900`/`zinc-950` is 2.29:1 / 2.57:1, under the 3:1 WCAG 2.1 SC 1.4.11 target for UI component boundaries.
**Verified (calc, hex-approximated zinc scale, this session):** label/count/"Updated"/pressed text pairs are all >= 4.83:1 (zinc-700/white 10.44, zinc-300/900 11.99, zinc-600/100 7.03, zinc-400/800 5.81, zinc-600/white 7.73, zinc-400/950 7.76, zinc-50/900 16.97, zinc-300/900 11.99, zinc-600/50 7.41, heading zinc-500/white 4.83). Ring options: `ring-zinc-500` = 4.83 on white, 3.67 on zinc-900, 4.12 on zinc-950.
**How to avoid:** Use `ring-zinc-500` (light and dark) on unpressed pills and the expander button. One class string in one shared constant. Flag to the user as a minor amendment of the approved UI-SPEC colour list (it stays within the neutral zinc system). The executor must still run the spec-mandated contrast check against the **resolved** Tailwind v4 oklch values rather than these hex approximations.
**Warning signs:** Pills look borderless in bright light on a phone.
[SC 1.4.11 threshold: ASSUMED from training knowledge of WCAG 2.1]

### Pitfall 8: Duplicated/garbled accessible names
**What goes wrong:** Spec copy says visible `{emoji} {Section} {count}` plus a visually hidden `{Section} {count} articles` suffix. Read literally the AT name is "Vulnerabilities 12 Vulnerabilities 12 articles".
**How to avoid:** Emoji `aria-hidden`; section name as plain text; visible count `aria-hidden="true"`; one `sr-only` span `, 12 articles` (singular `1 article`). Same for the section-heading count. The accessible name then contains the visible label text (WCAG 2.5.3 Label in Name) without repetition.
**Warning signs:** Screen-reader or a11y-tree snapshot (`page.accessibility`/`ariaSnapshot`) shows the section name twice.

### Pitfall 9: Counts and pills drift from the rendered sections
**What goes wrong:** A pill for an empty section (unreachable filter state) or a count that uses the capped 6.
**How to avoid:** Derive pills from the same `sections` array `page.tsx` renders (already non-empty, already in `SECTION_DISPLAY_ORDER`); count is `group.articles.length`, computed once and used for heading, pill, and the `Show all {N}` label.
**Warning signs:** Test "pill counts equal heading counts" fails.

### Pitfall 10: Making the route dynamic by accident
**What goes wrong:** Any `cookies()`, `headers()`, `useSearchParams()` (without Suspense), or `export const dynamic` flips the route from static/ISR to per-request, destroying the 15-minute cache (core value).
**Verified baseline:** the existing build records `"/"`: `"compute": "static"`, `"initialRevalidateSeconds": 900`, `"htmlSize": 220115`. [VERIFIED: `.next/prerender-manifest.json` read this session; stale relative to Phase 4 code but shows the current architecture]
**How to avoid:** Keep client code free of those APIs; after the build, re-read `.next/prerender-manifest.json` and assert `/` is still `"compute": "static"` with 900 s; keep the existing byte-identical-HTML test.
**Warning signs:** Build output shows `ƒ (Dynamic)` for `/`; the byte-identical test starts flaking.

### Pitfall 11: Scroll adjustments run before the DOM updates
**What goes wrong:** Calling `scrollIntoView` in the click handler scrolls against the pre-toggle layout (collapse target and "first visible section" are both stale).
**How to avoid:** For the expander collapse, wrap the state change in `flushSync` from `react-dom` then call `button.scrollIntoView({ block: "nearest" })`; or do it in an effect keyed on the `open` transition (skip first run). For the filter, run in an effect keyed on the selection (skip initial mount), only when stuck: `bar.getBoundingClientRect().top <= 0` (a `top: 0` sticky bar reports `top === 0` while pinned, `> 0` while still in natural position above the fold). Target the first `div:not([hidden]) > section[data-section]` heading; `scroll-padding-top: 6rem` on `html` offsets it below the bar.
**Warning signs:** After toggling the last-but-one pill the page lands mid-section or the collapse jumps to the wrong place.

### Pitfall 12: Live-data-dependent production assertions are silently vacuous
**What goes wrong:** `test/productionPage.test.ts` runs against live feeds. On a slow news day no section has >= 9 articles, so "exactly 6 outside `data-overflow`" is never exercised, and the test goes green while proving nothing. Conversely a fixed expectation fails on quiet days.
**How to avoid:** Write assertions as invariants over whatever HTML arrives (for each section: `total = <article count>`; if `total >= 9` then primary == 6 and an overflow region exists and primary+overflow == total; else no overflow region and no expander button); prove the threshold logic itself with the `planSectionCap` unit test (totals 0, 1, 6, 7, 8, 9, 10, 26 -> deterministic, hermetic); and make Tier-2 (Playwright) report explicitly whether a >= 9 section was present. Add `data-count` on heading and pill count spans and count `<article` per section chunk by splitting the HTML on `data-section="`; the overflow region is the last article-bearing element in a section chunk, so `chunk.split('data-overflow="')` separates primary from overflow counts.
**Warning signs:** Test passes with zero sections having an overflow region for several days.

### Pitfall 13: Tab-order statement in the spec is slightly inconsistent
**What goes wrong:** The Interaction Contract says the expander button follows the primary grid in tab order, while the Layout Contract (and DOM order) is primary grid -> overflow region -> button. When expanded, tab order reaches the overflow cards before the button.
**How to avoid:** Follow the Layout Contract DOM order (button after the region). It is acceptable and arguably correct (the button toggles the content above it). Note it in the plan so a verifier doesn't fail it.

### Pitfall 14: Invalid/awkward heading ids
**What goes wrong:** Section names like `Tools/Techniques` contain `/` and spaces; using them raw in `id`/`aria-labelledby` is brittle (CSS selectors need escaping).
**How to avoid:** Use a slug (lowercase, non-alphanumerics -> `-`) or the section index: `section-heading-${index}`.

### Pitfall 15: `build` precondition for the production test
**What goes wrong:** `test/productionPage.test.ts` only runs `next start`; it does not build. A stale `.next` from before Phase 4 silently tests old markup.
**How to avoid:** The verification task runs `npm run build` immediately before `npm test`; the plan states this ordering.

## Code Examples

Verified patterns; snippets are skeletons to adapt, not final files.

### Pure cap planner (hermetic, `node --test`-runnable)
```ts
// src/lib/planSectionCap.ts  — relative `.ts` imports so `node --test` resolves them
import { SECTION_CARD_CAP, MIN_HIDDEN_TO_COLLAPSE } from "./config/frontPageLayout.ts";

export function planSectionCap(total: number): { visibleCount: number; hiddenCount: number } {
  const hidden = total - SECTION_CARD_CAP;
  if (hidden >= MIN_HIDDEN_TO_COLLAPSE) {
    return { visibleCount: SECTION_CARD_CAP, hiddenCount: hidden };
  }
  return { visibleCount: total, hiddenCount: 0 };
}
// expected: 0->(0,0) 1->(1,0) 6->(6,0) 7->(7,0) 8->(8,0) 9->(6,3) 10->(6,4) 26->(6,20)
```
Convention evidence: existing tests import with explicit `.ts` and relative paths, e.g. `import { formatRelativeTime } from "./formatRelativeTime.ts";` [VERIFIED: src/lib/formatRelativeTime.test.ts:3]. Client `.tsx` files cannot be imported by `node --test` here (type stripping only handles `.ts`), so all logic worth unit-testing must live in `.ts` modules.

### Deterministic UTC formatting (no locale, no clock)
```ts
// src/lib/formatUtcTime.ts
export function formatUtcTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown time"; // never throw during render
  return `${d.toISOString().slice(11, 16)} UTC`;          // "14:32 UTC"
}
export function formatUtcDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown time";
  const s = d.toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 16)} UTC`;      // "2026-09-30 14:32 UTC"
}
```

### `generatedAt` threading (single clock read)
```ts
// src/lib/types.ts  (current ok variant is at types.ts:100)
export type SectionedFrontPageResult =
  | { status: "ok"; articles: ClassifiedArticle[]; sections: SectionGroup[]; generatedAt: string }
  | { status: "error"; reason: string };

// src/lib/pipeline/getFrontPage.ts  (composeFrontPage, currently returns at getFrontPage.ts:43)
return {
  status: "ok",
  articles: sections.flatMap((g) => g.articles),
  sections,
  generatedAt: new Date(now).toISOString(), // same `now` as ranking; never Date.now() here
};
```
Existing values quoted verbatim for the planner: `SECTION_DISPLAY_ORDER: readonly Section[] = ["Vulnerabilities", "Advisories", "Ransomware", "Breaches", "Threat Intelligence", "Tools/Techniques", "Industry/Policy"]` [VERIFIED: src/lib/config/sections.ts:17-25]; ok-variant today is `{ status: "ok"; articles: ClassifiedArticle[]; sections: SectionGroup[] }` [VERIFIED: src/lib/types.ts:100]; per-fetch cache is `next: { revalidate: 900 }` [VERIFIED: src/lib/pipeline/fetchSource.ts:107]. Add a test in `getFrontPage.test.ts`: `composeFrontPage([], NOW).generatedAt === new Date(NOW).toISOString()`.

### Filter context + visibility wrapper
```tsx
// src/components/FrontPageFilter.tsx
"use client";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type Ctx = { selected: ReadonlySet<string>; toggle: (section: string) => void };
const FilterContext = createContext<Ctx>({ selected: new Set(), toggle: () => {} });
export const useSectionFilter = () => useContext(FilterContext);

export function FrontPageFilter({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback((section: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(section)) next.add(section);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ selected, toggle }), [selected, toggle]);
  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>; // NO DOM
}

// src/components/SectionVisibility.tsx
"use client";
export function SectionVisibility({ section, children }: { section: string; children: ReactNode }) {
  const { selected } = useSectionFilter();
  const hidden = selected.size > 0 && !selected.has(section); // D-09: none selected = all visible
  return <div hidden={hidden}>{children}</div>;               // preflight makes [hidden] win
}
```

### Hydration-safe "Updated" text
```tsx
// src/components/LastUpdated.tsx
"use client";
import { useSyncExternalStore } from "react";
import { formatRelativeTime } from "@/lib/formatRelativeTime";
import { formatUtcTime, formatUtcDateTime } from "@/lib/formatUtcTime";

// module scope: stable references, nothing impure during render
function subscribe(onTick: () => void) {
  const id = setInterval(onTick, 60_000);
  return () => clearInterval(id);
}
const getMinute = () => Math.floor(Date.now() / 60_000) * 60_000; // number => stable between unchanged calls
const getServerMinute = () => null;                                // SSR + hydration

export function LastUpdated({ generatedAt }: { generatedAt: string }) {
  const nowMs = useSyncExternalStore(subscribe, getMinute, getServerMinute);
  const label =
    nowMs === null
      ? `Updated ${formatUtcTime(generatedAt)}`                     // ONE text node (Pitfall 5)
      : `Updated ${formatRelativeTime(generatedAt, nowMs)}`;        // needs optional `now` param
  const title = nowMs === null ? formatUtcDateTime(generatedAt) : new Date(generatedAt).toLocaleString();
  return (
    <time dateTime={generatedAt} title={title} className="text-sm font-medium whitespace-nowrap text-zinc-600 dark:text-zinc-400">
      {label}
    </time>
  );
}
```
`formatRelativeTime` change (back-compatible): `export function formatRelativeTime(isoDate: string, now: number = Date.now()): string` with `const diffMs = now - new Date(isoDate).getTime();`; add one test passing an explicit `now`.

### Expander with stable region id and post-commit scroll
```tsx
// src/components/SectionExpander.tsx
"use client";
import { useId, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

export function SectionExpander({ section, total, children }: { section: string; total: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <div id={regionId} hidden={!open} data-overflow={section}>{children}</div>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => {
          const next = !open;
          flushSync(() => setOpen(next));
          if (!next) buttonRef.current?.scrollIntoView({ block: "nearest" }); // after DOM update
        }}
        /* pill classes per UI-SPEC, ring-zinc-500 (Pitfall 7) */
      >
        {open ? "Show fewer" : `Show all ${total}`}
      </button>
    </>
  );
}
```

### Class verification (Tailwind 4.3.3)
A scratch compile (`@import "tailwindcss" source(none)` + `@source inline(...)`, via `@tailwindcss/postcss`) emitted valid CSS for every class the spec uses, including: `max-md:scrollbar-none` (as `@media (width < 48rem) { .max-md\:scrollbar-none { scrollbar-width: none } }`), `scrollbar-none`, `wrap-anywhere` (`overflow-wrap: anywhere`), `min-h-11` (`calc(var(--spacing) * 11)`), `backdrop-blur`, `bg-white/90`, `focus-visible:outline-2`, `focus-visible:outline-offset-2`, `-mx-4`, `sm:-mx-6`, `md:min-h-8`, `tabular-nums`, `grid-cols-1` (`repeat(1, minmax(0, 1fr))`), `max-w-7xl`, `sr-only`. [VERIFIED: compile probe this session]. Tailwind scans source for **complete class strings**: never build classes by concatenation (`` `md:grid-cols-${n}` ``).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `useEffect` + `setMounted(true)` to avoid hydration mismatch | `useSyncExternalStore` with a server snapshot | React 18 API; enforced by `react-hooks` v7 lint rules here | Required for this repo's lint to pass (Pitfall 3) |
| Custom `@utility scrollbar-none` | Built-in `scrollbar-none` | Present in Tailwind 4.3.3 | Delete the planned `globals.css` utility block |
| `display:none` via class toggles for collapsed content | Native `hidden` attribute (preflight-backed) | — | Simpler, all content stays in HTML |
| `hidden="until-found"` for find-in-page | Not usable via React 19.2.8 props | React renders `hidden=""` | Plain `hidden` for v1 (Ctrl+F limitation accepted) |

**Deprecated/outdated:**
- Approved UI-SPEC clock pattern (mount flag via effect): superseded by Pattern 4 for lint compliance.
- Planned `scrollbar-none` `@utility`: unnecessary.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | React preserves `children` element identity so card subtrees do not re-render on filter/expander state changes | Pitfall 2 | Janky toggles with ~100+ cards; mitigation: Profiler/"highlight updates" check in Tier 2, fallback `React.memo` on a wrapper |
| A2 | When a page ISR regeneration runs, stale Data Cache fetch entries may be served, so feed bytes can be up to ~900 s older than `generatedAt` | Pitfall 4 | "Updated" slightly overstates feed freshness; accepted and checked in the human-verify step |
| A3 | WCAG 2.1 SC 1.4.11 requires 3:1 for UI component boundaries not identifiable by text alone | Pitfall 7 | If the team reads the unpressed pill as text-identified, the ring change is unnecessary (harmless) |
| A4 | `formatRelativeTime` returning "72h ago" for an idle stale page is acceptable UX | Pitfall 4 | Minor copy polish (e.g. "Nd ago") can be a follow-up; user may want it now |
| A5 | Collapsed `hidden` overflow cards not being Ctrl+F-findable is acceptable for v1 | Summary / Open Question 1 | Audience searches CVE IDs on the page; may want expanded-by-default or a later `until-found` with a ref-based implementation once Safari support is full |
| A6 | Ad hoc Playwright 1.63.0 run from the `~/.npm/_npx` cache is repeatable on the executor's machine | Environment Availability | Path is machine-specific; planner should reference a procedure (install to a throwaway dir), not that path |

## Open Questions

1. **Find-in-page for collapsed cards (UI-SPEC "unresolved" item 1)**
   - What we know: React 19.2.8 renders `hidden="until-found"` as plain `hidden=""` [VERIFIED: probe]; `@types/react` 19.3.0 types `hidden?: boolean` [VERIFIED: index.d.ts:2896]; caniuse reports Chrome 102+, Firefox 148+, Safari only partial from 26.2 [CITED: https://caniuse.com/mdn-html_global_attributes_hidden_until-found].
   - What's unclear: whether the audience needs Ctrl+F across collapsed cards enough to justify a ref-based `setAttribute('hidden','until-found')` + `beforematch` listener (SSR would still emit plain `hidden`, so it only upgrades after hydration).
   - Recommendation: plain `hidden` for v1 (matches the spec's stated assumption); list as a post-v1 enhancement.

2. **Ring colour amendment (Pitfall 7)**
   - Recommendation: adopt `ring-zinc-500` for unpressed pills and the expander; surface to the user in the plan as a small, contrast-driven change to the approved UI-SPEC colour list.

3. **Card relative times go stale within the cached page (UI-SPEC "unresolved" item 2)**
   - What we know: `ArticleCard` computes `formatRelativeTime` at render, so card times can lag up to ~15 min (plus idle time). The UI-SPEC assumes accepted and out of scope.
   - Recommendation: keep out of scope; the new "Updated ..." text is the honest freshness signal.

4. **How to make the expander/filter path testable when live data is thin (Pitfall 12)**
   - Recommendation: invariant-based production assertions + `planSectionCap` unit tests + Tier-2 Playwright that reports whether a >= 9 section existed. A fixture-driven page is out of scope (would need a test-only seam in production code).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | `node --test`, `next build/start` | ✓ | v26.3.1 | — |
| npm | scripts | ✓ | 11.17.0 | — |
| Next.js / React / Tailwind (installed) | all | ✓ | 16.3.5 / 19.2.8 / 4.3.3 | — |
| Playwright (ad hoc) | Tier-2 viewport emulation | ✓ (cached, not in project) | 1.63.0 at `~/.npm/_npx/3b8e4f9f66f3a791/node_modules/playwright` | DevTools device toolbar (manual) |
| Chromium for Playwright | Tier-2 | ✓ | chromium-1243 (Chrome 153.0.8010.12) in `~/Library/Caches/ms-playwright` | Installed Google Chrome.app via `channel: "chrome"` |
| Google Chrome / Safari desktop | manual checks | ✓ | `/Applications` | — |
| Real iOS Safari + Android Chrome phones | Tier-3 human check | unknown (human) | — | Vercel preview URL opened on the user's own devices; if unavailable, record as a blocking human step |
| Vercel preview deployment | Tier-3, freshness check | ✓ (Phase 1 used one) | — | `next build && next start` locally (cannot verify Vercel CDN behaviour) |
| Network access to 13 live feeds | `next build` prerender, `next start` | assumed ✓ (existing `.next` build exists) | — | Build tolerates per-source failure (empty state) |

**Missing dependencies with no fallback:** real phones (human-provided) — the plan must schedule this as an explicit human-verify step; it cannot be automated.
**Missing dependencies with fallback:** none blocking.

Implementation note for the Playwright tier: a script importing `playwright` needs module resolution. Do not rely on the `_npx` hash path; in the verification task either (a) `npm install --no-save playwright@1.63.0` temporarily (does not modify `package.json`; still gate behind the SUS `checkpoint:human-verify`), or (b) run the script from a throwaway directory with its own install. I confirmed a script run that way works: launching Chromium 153, `newPage({ viewport: { width: 360, height: 800 } })`, `setContent`, `evaluate(() => document.documentElement.scrollWidth)`. For a faithful mobile emulation use `browser.newContext({ ...playwright.devices["iPhone 13"] })` or explicit `viewport`, `deviceScaleFactor: 3`, `isMobile: true`, `hasTouch: true` (the UI-SPEC's DPR 3 requirement) [ASSUMED: device descriptor names; confirm against the installed Playwright].

## Security Domain

`security_enforcement` is enabled in `.planning/config.json` (`security_asvs_level: 1`, `security_block_on: "high"`). The phase adds no auth, no network input, no persistence, and no new endpoints; the attack surface is rendering untrusted feed text and avoiding accidental data exposure.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | None (public site, UI-06) — nothing added |
| V3 Session Management | no | No cookies/sessions; existing test asserts no `set-cookie` |
| V4 Access Control | no | No protected resources |
| V5 Input Validation / Output Encoding | yes | Feed text rendered only as JSX text nodes; no `dangerouslySetInnerHTML`; client props are constants/numbers/ISO strings derived from the snapshot, never raw feed HTML |
| V6 Cryptography | no | Nothing cryptographic |
| V10/V14 Config & Headers | partial | No new headers; keep route static; no new third-party scripts/CDNs; `target="_blank"` links keep `rel="noopener noreferrer"` (unchanged `ArticleCard`) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Stored/reflected XSS via feed title/summary reaching the DOM | Tampering | React text nodes only; new client code must not introduce `dangerouslySetInnerHTML` or `innerHTML`; grep gate in the plan |
| Serialized props leaking server-only data to the client | Information disclosure | Client props limited to `{ section, emoji, count }[]`, `generatedAt`, `total`; never pass `reason`/error diagnostics (T-01-10 / T-03-04), never pass whole article objects into client components |
| Error detail disclosure in the error/empty state | Information disclosure | Error variant renders the same quiet empty copy; no `reason` in the DOM; provider/bar not mounted in that state |
| Accidental dynamic rendering exposing per-request behaviour / cache bypass | Denial of service (origin fetch amplification) | Forbid `cookies()`/`headers()`/`useSearchParams`; re-assert static + 900 s in the manifest after build |
| Client-side state persistence leaking to storage | Information disclosure | D-10: no `localStorage`/`sessionStorage`/cookies/URL state; grep gate |
| Unvalidated DOM-lookup by feed-derived strings (e.g. `querySelector` with a section name) | Tampering | Section names are a closed enum from `SECTION_DISPLAY_ORDER`, not feed-supplied; use slugs/indices for ids anyway (Pitfall 14) |

## Sources

### Primary (HIGH confidence)
- Local files read this session: `04-CONTEXT.md`, `04-UI-SPEC.md`, `REQUIREMENTS.md`, `STATE.md`, `ROADMAP.md`, `.claude/CLAUDE.md`, `package.json`, `tsconfig.json`, `src/app/{page,layout,globals.css}`, `src/components/{ArticleCard,SourceTierBadge}.tsx`, `src/lib/{types.ts,formatRelativeTime.ts(+test),config/sections.ts,pipeline/getFrontPage.ts(+test),pipeline/groupBySection.ts,pipeline/fetchSource.ts}`, `test/productionPage.test.ts`, `.planning/config.json`, `.next/prerender-manifest.json`, `03-UI-REVIEW.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` — children-slot interleaving, context providers, serializable props
- `node_modules/tailwindcss/preflight.css:393-398` — `[hidden]` rule
- Runtime probes this session (scratchpad, not committed): Tailwind 4.3.3 compile of all spec classes; react-dom/server output for `hidden="until-found"` and adjacent text nodes; ESLint run on three probe components; Playwright/Chromium 360px grid-overflow probe; WCAG contrast calculation
- `gsd-tools query package-legitimacy check` for `playwright`

### Secondary (MEDIUM confidence)
- https://react.dev/reference/react/useSyncExternalStore — `getServerSnapshot` hydration contract (fetched this session)
- https://caniuse.com/mdn-html_global_attributes_hidden_until-found — Chrome 102+, Firefox 148+, Safari partial (via web search summary)

### Tertiary (LOW confidence)
- WCAG 2.1 SC 1.4.11 threshold and Playwright device-descriptor names — training knowledge, tagged `[ASSUMED]` above

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — nothing new; versions read from installed packages
- Architecture: HIGH — spec pattern confirmed against bundled Next 16 docs; clock pattern corrected after lint verification
- Pitfalls: HIGH for the six probed items (3, 5, 6, 7, 10, `hidden`); MEDIUM for A1/A2 (React re-render identity, ISR+Data Cache interaction)

**Research date:** 2026-09-30
**Valid until:** 2026-10-30 (stable stack; revisit if Next.js, React, or Tailwind is bumped, or Safari ships full `hidden=until-found` support)
