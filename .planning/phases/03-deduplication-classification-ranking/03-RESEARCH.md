# Phase 3: Deduplication, Classification & Ranking - Research

**Researched:** 2026-09-23
**Domain:** Server-side data pipeline (pure functions) — dedup, keyword classification, weighted ranking, CVE extraction — plus a minimal sectioned SSR render, all within the existing Next.js App Router / no-DB architecture.
**Confidence:** HIGH (all core findings verified by reading the actual source in this repo and its installed dependencies, and by running the real pipeline against all 13 live feeds this session)

## Summary

This phase adds no new runtime infrastructure, no new external dependency (recommended), and no new Next.js concept — it is entirely new **pure-function pipeline stages** inserted between the existing `filterLookback` step and `page.tsx`'s render, plus one small additive change to `normalize.ts` and one new presentational component. Every decision in `03-CONTEXT.md` was validated this session against a **live snapshot of all 13 configured feeds** (fetched via the real `fetchSource()`/`filterLookback()` code, 81 articles survived the 24h window from 10 of 13 sources), which surfaced three concrete, previously-undiscovered facts that materially affect how this phase should be planned:

1. **A live data-quality bug in the ranking domain.** Dark Reading's feed includes a `[Virtual Event] Cybersecurity Outlook 2027` item with `publishedAt: 2026-12-03T16:00:00.000Z` — **71 days in the future** relative to the snapshot instant — which currently sails through `filterLookback` (which only enforces a lower bound). An unclamped `recencyDecay(age)` as literally specified by D-09 ("`score = tierWeight × recencyDecay(age)`") would compute `age` as a large negative number here, producing a score around **6.35 × 10⁸⁵** — not a crash, but a silent, permanent #1 ranking for a non-news item. This must be handled by clamping age to `≥ 0` in the ranking stage; `formatRelativeTime.ts` (Phase 1/2) already does the equivalent clamp for display, so this is precedent, not new territory.
2. **The exact root cause of the CrowdStrike `&trade;` blocker** (STATE.md). `rss-parser@3.13.0`'s `getSnippet()` (source read this session, `node_modules/rss-parser/lib/utils.js:11-13`) explicitly runs `entities.decodeHTML(stripHtml(str))` to build `contentSnippet` — but this call is never made for `item.title`. `entities@2.2.0` is already installed as `rss-parser`'s own declared dependency (`node_modules/rss-parser/package.json:27`), so decoding titles the same way `contentSnippet` is already decoded is a same-behavior, well-precedented fix.
3. **A live false-positive in the reference taxonomy and a live cross-source classification split**, both from the actual snapshot data — see Common Pitfalls. These directly validate D-07's instruction to prune over-broad terms and confirm the D-05 evaluation-order design is working as intended elsewhere (CISA's CVE-laden ICS advisories correctly land in Vulnerabilities, not Advisories, because Vulnerabilities is evaluated first).

**Primary recommendation:** Implement dedupe/classify/rank/CVE-extract as four new pure `src/lib/pipeline/*.ts` modules plus two small config data files (`src/lib/config/sections.ts`, `src/lib/config/ranking.ts`), composed into `getFrontPage.ts` in that order, with `now` threaded through as a parameter per D-09. Use a hand-rolled HTML-entity decoder (no new dependency) reusable by both `normalize.ts` (display) and the new title-dedupe-key function. Extend `FrontPageResult`'s ok variant with a pre-grouped, pre-ordered `sections: SectionGroup[]` field so `page.tsx` stays a pure renderer with zero pipeline logic, matching its existing "no sort/group/filter/dedupe here" contract.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Deduplication (NORM-02) | API/Backend | — | Runs inside `getFrontPage()`'s server-only pipeline, before any HTML exists; no client involvement, no new I/O |
| Classification (CLASSIFY-01) | API/Backend | — | Pure keyword-rule function over already-normalized text; must complete before the page is rendered/cached |
| Ranking (CLASSIFY-02) | API/Backend | — | Recency+tier-weight arithmetic; no UI dependency, needs a deterministic `now` input for testability |
| Section display order (CLASSIFY-03) | API/Backend | Frontend Server (SSR) | The *order* is an owned data constant (`SECTION_DISPLAY_ORDER`); *rendering* that order into headings is `page.tsx`'s SSR job — data owns truth, SSR owns presentation |
| CVE detection (UI-03 — detection half) | API/Backend | — | Regex extraction over already-capped `title`/`summary`, a pure data-derivation step, same tier as classification |
| CVE chip rendering (UI-03 — display half) | Frontend Server (SSR) | — | New `CveChips` component needs no client interactivity (plain `<a>` links) — stays a Server Component like `ArticleCard`/`SourceTierBadge` |
| URL/title canonicalization for dedupe | API/Backend | — | Internal comparison-key builder for the dedupe stage only; never exposed to the client, never replaces the displayed `article.url` |

## User Constraints (from CONTEXT.md)

<user_constraints>
### Locked Decisions

**Deduplication (NORM-02)**
- **D-01:** Two articles are the same story if **either** their canonical URLs match **or** their normalized titles match. URL canonicalization: lowercase scheme and host, drop the fragment, strip tracking query params (`utm_*` and similar), strip the trailing slash, and treat `http`/`https` as equal for matching. Title normalization: decode HTML entities, Unicode-normalize, lowercase, collapse punctuation and whitespace. No fuzzy or similarity matching.
- **D-02:** Which copy survives a collapse: the **earliest `publishedAt`**. Ties are broken by source weight (D-10), then by stable source-iteration order. The result is deterministic.
- **D-03:** Duplicates are collapsed **silently**. No "also reported by" note, no new fields on `Article` for it.
- **D-04:** HTML entities in titles are decoded **once, in `normalize.ts`**. The decoded string is both the dedupe input and what readers see. Not an editorial rewrite; UI-02's verbatim guarantee still holds.

**Classification (CLASSIFY-01)**
- **D-05:** First-match-wins runs in **specificity order, which is separate from display order**. Intended order: Vulnerabilities → Ransomware → Breaches → Advisories → Threat Intelligence → Tools/Techniques, with Industry/Policy as the default. Evaluation order and display order (D-12) must stay two separate constants.
- **D-06:** Matching tries **every rule against the title first**. Only if no title match is found are the rules tried against the (400-code-point capped) summary. If neither matches, the article goes to Industry/Policy.
- **D-07:** Keyword lists are **ported from the reference taxonomy (PROJECT.md), then tuned**. Case-insensitive with word boundaries. Over-broad terms (`threat`, `attack`, `incident`, `encrypted`, `government`, `malicious`, `recommend`, etc.) are narrowed or pruned; missing terms added. Tuning validated against a live multi-source snapshot, locked in with fixture tests. Every deviation documented in a code comment.
- **D-08:** **No per-source classification overrides.** Every source, CISA included, goes through the same keyword path.

**Ranking (CLASSIFY-02)**
- **D-09:** Within a section, `score = tierWeight × recencyDecay(age)` over the 24h window, sorted descending. Decay curve/constant is Claude's discretion. Ranking takes `now` as an input for fixed-timestamp tests.
- **D-10:** Weights are **per `SourceTier`**, stored in config next to `SOURCES`. Rough ordering: Government highest; Security Research and Threat Intelligence high; Enterprise Security and Executive News mid; Tech & General lowest. Exact numbers are Claude's discretion. Weight is a ranking input only — tier badges stay visually equal.
- **D-11:** Only recency + tier weight count. No multi-outlet boost, no source-diversity penalty in v1.

**Section Order (CLASSIFY-03)**
- **D-12:** Display order is exactly: **Vulnerabilities → Advisories → Ransomware → Breaches → Threat Intelligence → Tools/Techniques → Industry/Policy**. PROJECT.md's "Active" line lists a different order and is wrong — correct it during this phase's doc updates.

**CVE Chips (UI-03)**
- **D-13:** CVE IDs detected with `CVE-\d{4}-\d{4,7}` (case-insensitive, rendered uppercase) in title and capped summary. Deduplicated, first-appearance order (title first). At most 3 chips, then a "+N" chip.
- **D-14:** Each chip links to `https://nvd.nist.gov/vuln/detail/<ID>` in a new tab, `rel="noopener noreferrer"`. URL built only from the regex-matched ID, never feed-supplied URL text.
- **D-15:** Chips sit in the card's meta row, next to the tier badge. Same pill shape/size as `SourceTierBadge`, **red** tone (reserved by Phase 2 D-02), monospace ID, wraps on narrow viewports. Must meet WCAG AA contrast.

**Interim Section Rendering**
- **D-16:** `page.tsx` swaps the single "Latest" list for **plain stacked sections**: one heading per non-empty section (emoji + name, D-12 order), each followed by ranked cards in the existing single column. No count, grid, filter, or "show more." Quiet empty state still applies overall. Every article renders (no per-section cap).

### Claude's Discretion
- The exact decay function/constant, and exact numeric tier weights (D-09/D-10).
- The exact tuned keyword lists and any adjacent-rule reordering (D-05/D-07), backed by live-data validation and fixture tests.
- Exactly which tracking params get stripped during URL canonicalization (D-01).
- Module layout and how `Article`/`FrontPageResult` get extended with section and CVE data. Keep the pure-function-per-stage pattern and the never-throws `getFrontPage` contract.
- Whether `sortByRecencyDesc.ts` is removed or kept.
- The entity decoder (hand-rolled map vs. tiny dependency), given STACK.md's few-dependencies bias.

### Deferred Ideas (OUT OF SCOPE)
- Pagination / page length (→ Phase 4): no page-2 pagination; each section eventually gets a client-side "Show all N" expander over the already-rendered snapshot. Phase 3 renders everything.
- Fuzzy / similarity dedupe: rejected for v1 (D-01). Revisit only if exact-normalized matching visibly misses duplicates in production.
- Multi-outlet coverage boost / "also reported by" note: rejected for v1 (D-03, D-11).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NORM-02 | Duplicate articles (same normalized title/url pair, widened to either-match per D-01) shown once | `dedupe.ts` design (union-find over URL-key/title-key equivalence), `canonicalizeUrl.ts`, `normalizeTitleForDedupe.ts` — see Architecture Patterns and Code Examples |
| CLASSIFY-01 | Each article classified into exactly 1 of 7 sections via keyword rules, first-match-wins, default Industry/Policy | `classify.ts` + `config/sections.ts`'s `SECTION_KEYWORDS`/`CLASSIFICATION_ORDER`, tuned and distribution-tested against the live 81-article snapshot (see Standard Stack → Live Taxonomy Validation) |
| CLASSIFY-02 | Within-section ranking by recency + source weight | `rank.ts` + `config/ranking.ts`'s `TIER_WEIGHT`/`recencyDecay()`, with the mandatory future-date clamp (Common Pitfalls #1) |
| CLASSIFY-03 | Sections render in operational-urgency order | `SECTION_DISPLAY_ORDER` constant, `groupBySection.ts`, `page.tsx` D-16 rendering |
| UI-03 | CVE-ID chip on any article with a CVE pattern in title/summary | `extractCves.ts` (regex, dedup, order) + `CveChips.tsx` component (chip cap, NVD link, red tone matching `SourceTierBadge`) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Tech stack is locked: Next.js (App Router, TypeScript) + Tailwind CSS on Vercel — this phase introduces no new stack element, only pure functions and one new component, consistent with this constraint.
- Free-tier / stateless constraints (no DB, no paid KV) are unaffected — dedup/classify/rank/CVE-extract are pure in-memory transforms over the already-fetched, already-cached article list; no new I/O, no new cache entries.
- `rss-parser@3.13.0`, `clsx@2.1.1` are the only currently-declared runtime dependencies (verified: `package.json`) — this phase's primary recommendation adds **zero** new dependencies.
- STACK.md's dependency-minimalism bias (documented for the date-formatting decision, same reasoning applies here) directly informs the recommendation to hand-roll HTML-entity decoding rather than add a package.
- AGENTS.md's "this Next.js version differs from training data, check `node_modules/next/dist/docs/`" instruction was considered: this phase touches no caching/fetch/routing config (unlike Phases 1-2) — it only adds pure functions and extends an existing Server Component's render output with more `<h2>`/`<div>` groups, which is unchanged App Router Server Component usage. No new Next.js-specific behavior needs verification against the bundled docs for this phase.

## Standard Stack

### Core

No new runtime dependency is recommended for this phase. All new logic composes with what's already installed:

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none new) | — | — | Dedup/classify/rank/CVE-extract are all plain TypeScript over arrays and strings — exactly the domain the codebase's existing "pure function per pipeline stage" pattern (`filterLookback.ts`, `truncateSummary.ts`) already covers with zero dependencies |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `entities` | `2.2.0` (already resolved transitively) | HTML/XML entity decode/encode | **Not recommended as a new direct dependency** — see "Don't Hand-Roll" and Package Legitimacy Audit below for the full analysis. Documented here because it is the exact library `rss-parser` itself already uses for `contentSnippet` decoding (`[VERIFIED: node_modules/rss-parser/lib/utils.js:11-13, node_modules/rss-parser/package.json:27]`), so it is the natural "prior art" reference for the hand-rolled decoder's entity table, not a package to install. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled `decodeHtmlEntities.ts` (recommended) | Add `entities` as a direct dependency, pinned to `^2.2.0` (matching the already-vetted, already-resolved transitive copy) | Slightly more entity coverage (full HTML5 named-entity table) for near-zero extra code, at the cost of: (a) a second copy of `entities` in the dependency tree if a future `rss-parser` upgrade resolves a different semver range, (b) the package's *latest* npm tag (`8.1.0`, published 16 days before this research) is a major-version jump that would almost certainly require different import syntax (ESM-only) — see Package Legitimacy Audit. Only worth it if the hand-rolled map's ~15-entry table is later found to miss entities that actually appear across the 13 live sources; nothing in this session's 81-article snapshot needed more than the standard 5 XML entities plus numeric entities (no other named HTML entity, including `&trade;`, appeared in this snapshot's live titles — see Common Pitfalls #3 for why that specific bug is real but not currently reproducible in-session). |
| Union-find (disjoint-set) dedupe grouping | Two independent `Map`s (one keyed by URL, one by title), checked sequentially | Two independent maps can miss a **transitive** duplicate chain — e.g., article A shares a canonical URL with B, and article C shares a normalized title with B but not directly with A. D-01's "either...or" wording is a graph-equivalence relation, not two independent equality checks. Sequential maps are simpler to write but silently under-dedupe in that specific (rare, but real once ≥3 outlets cover one story) case; union-find handles it correctly at the same O(n) cost. |
| `Array.prototype.sort` half-life decay (recommended) | A linear decay (`score = tierWeight × max(0, 1 - age/24)`) | Both satisfy D-09's literal requirement. Half-life decay was chosen because it more naturally matches "recent items dominate, old items fade smoothly" without an article scoring exactly zero at the 24h boundary (a linear model's score hits 0 right when `filterLookback` would have dropped the article anyway, which is a coincidence worth avoiding since the two cutoffs are conceptually unrelated). Either is defensible — this is explicitly Claude's discretion per D-09. |

**Installation:** None required for the recommended path.

**Version verification:** N/A — no new package. If the planner instead selects the `entities` alternative, verified current state: `npm view entities version` → `8.1.0` (published 2026-09-07) `[VERIFIED: npm registry, checked this session]`; the already-installed, `rss-parser`-pinned copy is `2.2.0` `[VERIFIED: node_modules/entities/package.json]`. Pin to `^2.2.0` explicitly, never install bare `latest`, for the same reason STACK.md already documents for `typescript` (a bare `latest` install can silently grab an unvetted major line).

## Package Legitimacy Audit

No new package is required for this phase's primary (hand-rolled) recommendation. The audit below covers the one package discussed as an alternative, for completeness, since CONTEXT.md D-04/discretion explicitly leaves "hand-rolled map vs. a tiny dependency" open.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `entities` | npm | latest tag (`8.1.0`) published 2026-09-07, ~2.5 weeks before this research; package itself is long-established (already a transitive dependency of the installed `rss-parser@3.13.0`) | 217,752,953/week `[VERIFIED: gsd-tools package-legitimacy check, this session]` | `github.com/fb55/entities` | `SUS` (reason: `too-new`, referring only to the `8.1.0` tag) | **Not installed.** The `too-new` signal is a false-positive-prone heuristic here: 217M weekly downloads and an existing, already-trusted transitive presence in this exact dependency tree (via `rss-parser`) make this package legitimate; the flag only reflects that its *latest major* shipped recently. If ever adopted, pin `^2.2.0` (the version already resolved and implicitly trusted), not `latest`. |

**Packages removed due to `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** `entities` (not installed under the primary recommendation; see disposition above — if the planner overrides the hand-roll recommendation, add a `checkpoint:human-verify` task before pinning it).

## Architecture Patterns

### System Architecture Diagram

```
Server Component render (page.tsx), Vercel Function, same request path as Phase 1/2
│
▼
getFrontPage(now = Date.now())                         ◄── unchanged entrypoint, now threads `now`
│
▼
fanOut(SOURCES)  ──▶  [Article] × ~13 sources           ◄── UNCHANGED (Phase 2)
│
▼
filterLookback(articles)                                ◄── UNCHANGED (Phase 1) — NOTE: only enforces
│                                                            a lower bound; a future-dated item still
│                                                            survives this stage (see Pitfall #1)
▼
dedupe(articles)                        ◄── NEW (NORM-02)
    │  canonicalizeUrl() + normalizeTitleForDedupe()
    │  union-find groups articles that match on EITHER key
    │  winner = earliest publishedAt → tier weight → stable order
▼
classify(article) → Section             ◄── NEW (CLASSIFY-01), applied per surviving article
    │  title-first, all rules, in CLASSIFICATION_ORDER (D-05)
    │  fallback: summary-first, all rules
    │  fallback: "Industry/Policy" (default)
▼
extractCves(article) → string[]         ◄── NEW (UI-03), applied per surviving article
    │  regex over title + capped summary, dedup, uppercase, first-appearance order
▼
groupBySection(classified articles, now)  ◄── NEW (CLASSIFY-02 + CLASSIFY-03 combined)
    │  bucket by .section
    │  within each bucket: rankWithinSection() — score = TIER_WEIGHT[tier] × recencyDecay(clamp(now - publishedAt))
    │  order buckets per SECTION_DISPLAY_ORDER (D-12)
    │  drop empty buckets
▼
FrontPageResult { status: "ok", articles: flat[], sections: SectionGroup[] }
│
▼
page.tsx  ──▶  for each group in result.sections: render <h2>{emoji} {section}</h2>, then <ArticleCard> per article (with <CveChips> in the meta row)
```

### Recommended Project Structure

```
src/
├── lib/
│   ├── config/
│   │   ├── sources.ts                 # UNCHANGED
│   │   ├── sections.ts                # NEW: SECTION_DISPLAY_ORDER, CLASSIFICATION_ORDER, SECTION_EMOJI, SECTION_KEYWORDS
│   │   └── ranking.ts                 # NEW: TIER_WEIGHT, RANK_HALF_LIFE_HOURS, recencyDecay()
│   ├── pipeline/
│   │   ├── decodeHtmlEntities.ts      # NEW (+ .test.ts) — used by normalize.ts AND normalizeTitleForDedupe.ts
│   │   ├── canonicalizeUrl.ts         # NEW (+ .test.ts) — dedupe comparison key only, never replaces article.url
│   │   ├── normalizeTitleForDedupe.ts # NEW (+ .test.ts) — operates on the already-decoded Article.title
│   │   ├── dedupe.ts                  # NEW (+ .test.ts)
│   │   ├── classify.ts                # NEW (+ .test.ts)
│   │   ├── extractCves.ts             # NEW (+ .test.ts)
│   │   ├── rank.ts                    # NEW (+ .test.ts) — rankWithinSection()
│   │   ├── groupBySection.ts          # NEW (+ .test.ts)
│   │   ├── normalize.ts               # UPDATED: title now passes through decodeHtmlEntities()
│   │   ├── getFrontPage.ts            # UPDATED: new stage order, now param, sections field
│   │   ├── sortByRecencyDesc.ts       # RECOMMEND REMOVING (+ its .test.ts) — superseded by rank.ts
│   │   └── frontpage.e2e.test.ts      # MUST UPDATE — see "Existing Tests Requiring Updates"
│   └── types.ts                       # UPDATED: Section, SectionGroup, Article.section/.cves, FrontPageResult.sections
├── components/
│   ├── CveChips.tsx                   # NEW
│   ├── ArticleCard.tsx                # UPDATED: renders <CveChips> in the meta row
│   └── SourceTierBadge.tsx            # UNCHANGED
└── app/
    └── page.tsx                       # UPDATED: renders result.sections instead of a flat list (D-16)
```

### Pattern 1: Union-find dedupe over an "either key matches" relation (NORM-02, D-01)

**What:** Build two `Map<key, articleIndex>` (one for the canonical URL key, one for the normalized title key). When either map already has an entry for the current article's key, `union()` the current index with the existing one in a disjoint-set structure, rather than deciding a winner immediately. After one pass, every connected component of the "shares a URL or a title" graph is a single group, and exactly one winner is picked per group.

**When to use:** Always for this stage — the "either...or" semantics in D-01 is a graph-equivalence relation, and article ordering out of `fanOut`/`filterLookback` gives no guarantee that a chain's members appear adjacently.

**Example:**
```typescript
// src/lib/pipeline/dedupe.ts
import type { Article } from "../types.ts";
import { canonicalizeUrl } from "./canonicalizeUrl.ts";
import { normalizeTitleForDedupe } from "./normalizeTitleForDedupe.ts";
import { TIER_WEIGHT } from "../config/ranking.ts";

export function dedupe(articles: Article[]): Article[] {
  const parent = articles.map((_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function union(a: number, b: number): void {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }

  const byUrlKey = new Map<string, number>();
  const byTitleKey = new Map<string, number>();
  articles.forEach((article, i) => {
    const urlKey = canonicalizeUrl(article.url);
    const titleKey = normalizeTitleForDedupe(article.title);
    const urlMatch = byUrlKey.get(urlKey);
    if (urlMatch !== undefined) union(i, urlMatch); else byUrlKey.set(urlKey, i);
    const titleMatch = byTitleKey.get(titleKey);
    if (titleMatch !== undefined) union(i, titleMatch); else byTitleKey.set(titleKey, i);
  });

  const groups = new Map<number, number[]>();
  articles.forEach((_, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  });

  const winnerIndices: number[] = [];
  for (const indices of groups.values()) {
    winnerIndices.push(indices.reduce((bestIdx, idx) => pickEarlier(bestIdx, idx, articles)));
  }
  // Preserve the surviving winners' original relative order (fanOut/filterLookback order).
  return winnerIndices.sort((a, b) => a - b).map((i) => articles[i]);
}

/** D-02: earliest publishedAt wins; ties by tier weight (D-10), then stable index order. */
function pickEarlier(idxA: number, idxB: number, articles: Article[]): number {
  const a = articles[idxA], b = articles[idxB];
  const ta = new Date(a.publishedAt).getTime();
  const tb = new Date(b.publishedAt).getTime();
  if (ta !== tb) return ta < tb ? idxA : idxB;
  const wa = TIER_WEIGHT[a.sourceTier], wb = TIER_WEIGHT[b.sourceTier];
  if (wa !== wb) return wa > wb ? idxA : idxB;
  return idxA < idxB ? idxA : idxB;
}
```

### Pattern 2: Title-first, then-summary, first-match-wins classification (CLASSIFY-01, D-05/D-06)

**Example:**
```typescript
// src/lib/pipeline/classify.ts
import type { Article, Section } from "../types.ts";
import { CLASSIFICATION_ORDER, SECTION_KEYWORDS } from "../config/sections.ts";

function matchesKeyword(keyword: string, text: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // A keyword ending in a non-word character (e.g. "CVE-") already forms a
  // natural boundary against the digit that follows in real text ("CVE-2026-..."),
  // so \b after it is unnecessary and would behave inconsistently — verified live
  // against "CVE-2026-87902"-style titles this session.
  const pattern = /[a-zA-Z0-9]$/.test(keyword) ? `\\b${escaped}\\b` : escaped;
  return new RegExp(pattern, "i").test(text);
}

export function classify(article: Pick<Article, "title" | "summary">): Section {
  for (const section of CLASSIFICATION_ORDER) {
    if (SECTION_KEYWORDS[section].some((kw) => matchesKeyword(kw, article.title))) return section;
  }
  for (const section of CLASSIFICATION_ORDER) {
    if (SECTION_KEYWORDS[section].some((kw) => matchesKeyword(kw, article.summary))) return section;
  }
  return "Industry/Policy";
}
```

### Pattern 3: Clamped half-life ranking within a section (CLASSIFY-02, D-09/D-10)

**Example:**
```typescript
// src/lib/config/ranking.ts
import type { SourceTier } from "../types.ts";

/** D-10: rough ordering Government > {Security Research, Threat Intelligence} > {Enterprise Security, Executive News} > Tech & General. */
export const TIER_WEIGHT: Record<SourceTier, number> = {
  Government: 1.5,
  "Security Research": 1.3,
  "Threat Intelligence": 1.3,
  "Enterprise Security": 1.15,
  "Executive News": 1.15,
  "Tech & General": 1.0,
};

/** Half-life decay: a fresh article's score halves every 6h of age. */
export const RANK_HALF_LIFE_HOURS = 6;

/**
 * `ageMs` MUST be clamped to >= 0 before this call. A future `publishedAt`
 * (verified live this session — see RESEARCH.md Pitfall #1) would otherwise
 * produce a negative exponent and an astronomically large, permanently
 * top-ranked score for a non-news item.
 */
export function recencyDecay(ageMs: number): number {
  const clampedAgeHours = Math.max(0, ageMs) / 3_600_000;
  return Math.pow(0.5, clampedAgeHours / RANK_HALF_LIFE_HOURS);
}
```

```typescript
// src/lib/pipeline/rank.ts
import type { Article } from "../types.ts";
import { TIER_WEIGHT, recencyDecay } from "../config/ranking.ts";

export function rankWithinSection(articles: Article[], now: number): Article[] {
  return articles
    .map((article, index) => ({
      article,
      index, // stable tie-break — never reorder equal scores
      score: TIER_WEIGHT[article.sourceTier] * recencyDecay(now - new Date(article.publishedAt).getTime()),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.article);
}
```

**Worked example (grounded in this session's live snapshot, `now` = 2026-09-23T09:48:17Z):**

| Article | Tier | Age | Unclamped decay | Score |
|---|---|---|---|---|
| CISA ICS advisory | Government (1.5) | 21.8h | 0.5^(21.8/6) = 0.0645 | **0.097** |
| Help Net Security item | Threat Intelligence (1.3) | 0.77h | 0.5^(0.128) = 0.916 | **1.19** |
| Ars Technica item | Tech & General (1.0) | 12.1h | 0.5^(2.017) = 0.246 | **0.246** |
| Dark Reading "[Virtual Event]" item, **without** the clamp | Enterprise Security (1.15) | −1710.2h | 0.5^(−285.03) ≈ 6.35 × 10⁸⁵ | **≈ 7.3 × 10⁸⁵** ← bug |
| Same item, **with** `Math.max(0, ageMs)` clamp | Enterprise Security (1.15) | clamped to 0h | 0.5^0 = 1 | **1.15** (ties with a genuinely brand-new item, never dominates) |

This demonstrates D-09's requirement directly: the fresher, lower-tier Help Net Security item (1.19) outranks the older, highest-tier CISA item (0.097) — "a high-weight article a few hours old can outrank a low-weight one from minutes ago" only holds in the *few-hours* range, and *very* old items (even Government-tier) correctly sink — while the clamp keeps a data-quality anomaly from ever producing a runaway score.

### Pattern 4: Grouping + display ordering as the final pipeline stage (CLASSIFY-03, D-12)

```typescript
// src/lib/pipeline/groupBySection.ts
import type { Article, Section, SectionGroup } from "../types.ts";
import { SECTION_DISPLAY_ORDER } from "../config/sections.ts";
import { rankWithinSection } from "./rank.ts";

export function groupBySection(articles: Article[], now: number): SectionGroup[] {
  const bySection = new Map<Section, Article[]>();
  for (const article of articles) {
    if (!bySection.has(article.section)) bySection.set(article.section, []);
    bySection.get(article.section)!.push(article);
  }
  return SECTION_DISPLAY_ORDER
    .map((section) => ({ section, articles: rankWithinSection(bySection.get(section) ?? [], now) }))
    .filter((group) => group.articles.length > 0); // D-16: empty sections are skipped
}
```

### Pattern 5: CVE extraction — title-then-summary order falls out of string concatenation (UI-03, D-13)

```typescript
// src/lib/pipeline/extractCves.ts
import type { Article } from "../types.ts";

const CVE_PATTERN = /CVE-\d{4}-\d{4,7}/gi;

export function extractCves(article: Pick<Article, "title" | "summary">): string[] {
  // Concatenation order (title, then summary) is what gives "title first,
  // first-appearance order" for free — match() scans left to right.
  const combined = `${article.title} ${article.summary}`;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of combined.match(CVE_PATTERN) ?? []) {
    const id = raw.toUpperCase();
    if (!seen.has(id)) { seen.add(id); result.push(id); }
  }
  return result;
}
```

**Live-verified with this session's snapshot:** 13 of 81 articles contained at least one CVE match; one (`help-net-security`, "WordPress 7.1.2 fixes critical unauthenticated path traversal vulnerability (CVE-2026-87902)") contains the **same** CVE ID twice (once bare in the title's parenthetical, once again structurally) — confirming the dedup-and-uppercase step is exercised by real data, not just a hypothetical edge case. Two articles (CISA's "CISA Adds Four Known Exploited Vulnerabilities to Catalog" and Hacker News's CLEANGULP-malware story) contain 3 distinct CVEs each — right at the D-13 chip cap, so no live example of a genuine "+N" overflow chip exists in this snapshot; a synthetic 4-CVE fixture will be needed for that test case.

### Pattern 6: CVE chip rendering matching `SourceTierBadge`'s pill construction (UI-03, D-14/D-15)

```typescript
// src/components/CveChips.tsx
const MAX_VISIBLE_CVE_CHIPS = 3;

const CHIP_CLASSES =
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap " +
  "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200 font-mono";

export function CveChips({ cves }: { cves: string[] }) {
  if (cves.length === 0) return null;
  const visible = cves.slice(0, MAX_VISIBLE_CVE_CHIPS);
  const overflow = cves.length - visible.length;

  return (
    <>
      {visible.map((id) => (
        <a
          key={id}
          href={`https://nvd.nist.gov/vuln/detail/${id}`}
          target="_blank"
          rel="noopener noreferrer"
          className={CHIP_CLASSES}
        >
          {id}
        </a>
      ))}
      {overflow > 0 ? <span className={CHIP_CLASSES}>+{overflow}</span> : null}
    </>
  );
}
```

Placed inside `ArticleCard.tsx`'s existing meta-row `<div className="flex flex-wrap items-center gap-2">`, immediately after `<SourceTierBadge>`, so it inherits the row's existing `flex-wrap` (D-15's "wrap on narrow viewports" is already satisfied by the existing container, no new CSS needed).

**Color/contrast note `[ASSUMED — inferred by analogy]`:** 02-UI-SPEC.md states the `{hue}-50/{hue}-700/{hue}-200` construction "clears WCAG AA (4.5:1) text contrast by the same margin already confirmed for indigo, since Tailwind's 50/700 pairs are constructed with equivalent luminance deltas across its hue palette," and red/orange were explicitly reserved (Phase 2 D-02) *for this exact use*. This session did not re-run a contrast checker against `red-50`/`red-700` specifically — recommend a quick automated contrast check during this phase's UI verification pass rather than treating it as pre-confirmed.

### Anti-Patterns to Avoid

- **Recomputing dedupe/classify/rank per request without memoizing beyond what's already cached:** Not a risk here — these are pure, cheap array operations over at most a few hundred items (Pitfall 10 in PITFALLS.md already covers the cost model; this phase adds negligible CPU relative to the 13 network fetches it follows).
- **Letting `page.tsx` do any grouping/sorting/filtering itself:** `page.tsx`'s own doc comment already states "no sort, group, filter, or dedupe here" — this phase's `sections: SectionGroup[]` field is designed specifically so that contract can be kept unbroken; page.tsx should only map over already-ordered, already-grouped data.
- **Treating the reference taxonomy's Industry/Policy keyword list (regulation, policy, compliance, GDPR, HIPAA, law, government) as an active rule set:** D-05 defines Industry/Policy as *purely* the default bucket — those seven words are not evaluated at all in `CLASSIFICATION_ORDER`. Wiring them in as an eighth active rule would contradict D-05 and this session's validated distribution.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| General HTML sanitization / arbitrary rich-text rendering | A general HTML-to-safe-HTML sanitizer | Nothing — `ArticleCard.tsx` renders title/summary as plain JSX text children, never `dangerouslySetInnerHTML` (T-01-07, closed). Decoding entities does **not** reintroduce this risk: a decoded `&lt;script&gt;` becomes the literal text `<script>`, which React still renders as visible text, not as an executed tag, because it is still a plain string child. | Sanitization is for when untrusted content is interpreted as markup; this app only ever interprets it as text, so a sanitizer would be solving a problem that doesn't exist here. |
| Full HTML5 named-entity decoding (hundreds of entities, all diacritics/symbols) | A hand-rolled 200+ entry entity table, or bytes-perfect HTML5 spec compliance | A small (~15-entry) named-entity map covering what's actually plausible in RSS/Atom titles (`amp`, `lt`, `gt`, `quot`, `apos`, `nbsp`, `trade`, `mdash`, `ndash`, `hellip`, `copy`, `reg`, curly quotes) plus a general numeric-entity (`&#NNN;` / `&#xHEX;`) handler via `String.fromCodePoint` | The numeric-entity branch already covers the long tail (any entity a publisher expresses numerically, which is common), so the named-entity map only needs to cover the handful of *named* entities publishers actually use. No entity beyond the 5 XML defaults appeared in this session's 81-article live snapshot, so over-building this table now is speculative work; if `entities`-equivalent full coverage is ever needed, that's the point to reconsider the `entities` package (see Alternatives Considered). |
| Fuzzy/near-duplicate story matching | Levenshtein distance, cosine similarity, embeddings for title comparison | Nothing — explicitly out of scope for v1 (D-01, PITFALLS.md Pitfall 7). This session's live snapshot found a **real** same-story-different-wording cluster (the ShinyHunters/FBI breach story, reported with three entirely different headlines by `bleepingcomputer`, `hacker-news`, and `techcrunch-security`) that exact-match dedupe will **not** catch — confirming Pitfall 7's "accept some visible duplication" tradeoff is a live, not hypothetical, cost of the v1 design. | Building fuzzy matching now is exactly the premature complexity PITFALLS.md and D-01 already warned against; the correct response to this live finding is to document it as a known, accepted limitation with a test fixture, not to solve it. |
| A general graph/BFS library for dedupe grouping | Installing a graph library for the union-find step | ~15 lines of hand-rolled path-compressed union-find (Pattern 1 above) | The problem is small (at most a few hundred nodes, two edge types) and a textbook 15-line implementation is both simpler and faster than a dependency for this scale. |

**Key insight:** Every "don't hand-roll" temptation in this phase (sanitization, full entity tables, fuzzy matching, graph libraries) is a case of over-engineering for a scale and threat model this app doesn't have — the actual engineering-effort trap here is the opposite of most projects' "don't reinvent the wheel" lesson: at 13 sources and ~100 articles per cycle, reaching for a dependency is *more* code and *more* risk than the hand-rolled 10-20 line function it would replace.

## Common Pitfalls

### Pitfall 1: Unclamped recency decay lets a future-dated feed item permanently dominate a section

**What goes wrong:** `recencyDecay(age)` computed as literally `now - publishedAt` without a lower bound. When `publishedAt` is in the future (verified live this session — see below), `age` is negative, and `0.5^(negative/halfLife)` explodes exponentially (computed: ≈ 6.35 × 10⁸⁵ for the specific case found). This item then out-scores every genuinely recent article, forever, in whichever section it lands.

**Why it happens:** `filterLookback(articles, hours = 24)` (Phase 1, unchanged) only enforces `publishedAt >= cutoff` — it has no upper bound (`publishedAt <= now`) — so a future-dated item was never filtered out by any existing stage, and nothing before Phase 3 needed one, since nothing before Phase 3 did arithmetic on the *sign* of the age.

**Live evidence `[VERIFIED: live fetchSource() snapshot, this session, 2026-09-23T09:48:17Z]`:** Dark Reading's feed contains `"[Virtual Event] Cybersecurity Outlook 2027"` with `publishedAt: "2026-12-03T16:00:00.000Z"` — a legitimate upcoming-webinar listing, not a malformed timestamp, but 71 days ahead of the fetch instant.

**How to avoid:** Clamp in `recencyDecay()` itself: `Math.max(0, ageMs)`. `formatRelativeTime.ts` already does the display-layer equivalent (`if (diffMs <= 0) return "just now"`) — this is precedent for the same defensive posture in the new ranking code, not a novel pattern.

**Warning signs / required fixture:** A `rank.test.ts` case with a fixed `now` and an article whose `publishedAt` is *after* `now` must assert the resulting score equals (or is bounded by) the score of an article published exactly at `now` — never larger.

---

### Pitfall 2: `rss-parser` decodes entities in `contentSnippet` but never in `item.title` — root cause confirmed

**What goes wrong:** A title containing a doubly-escaped or otherwise-undecoded named entity (STATE.md's CrowdStrike `&trade;` example) reaches `Article.title` as literal `&trade;` text instead of `™`.

**Why it happens `[VERIFIED: node_modules/rss-parser/lib/utils.js:11-13, node_modules/rss-parser/lib/parser.js:149,218]`:** `rss-parser`'s `utils.getSnippet(str)` is `entities.decodeHTML(utils.stripHtml(str)).trim()` and is called specifically to build `item.contentSnippet` from `item.content`. No equivalent call exists anywhere for `item.title` — the title field only receives whatever `xml2js`'s own single-pass SAX entity decoding already resolved during XML parsing, which handles simple entities but not entities that were double-encoded in the source feed (i.e. a literal `&amp;trade;` in the raw XML decodes once, via `xml2js`, to the *text* `&trade;`, and nothing decodes it a second time for titles).

**How to avoid:** D-04's fix — decode entities in `normalize.ts` for `title` the same way `rss-parser` already decodes them for `contentSnippet`, using the same conceptual approach `entities.decodeHTML` takes (named + numeric entity resolution).

**Warning signs:** This specific bug is **not reproducible against the live feeds in this exact session** — CrowdStrike contributed 0 articles in this snapshot (a known quiet source, per `sources.ts`'s own comment), so no live `&trade;` example was observed this run. Treat the decoder as needing a synthetic fixture test (`&amp;trade;`-style double-encoded input) rather than relying on a live source to exercise it during this phase's own verification.

---

### Pitfall 3: A bare, single-word keyword (`worm`) produces a real false-positive classification on non-security content

**What goes wrong:** The reference taxonomy's RANSOMWARE keyword list includes bare `worm` (as in "computer worm"). Live evidence `[VERIFIED: live snapshot, this session]`: Ars Technica's `"Woman's brain worm infection confirmed after eggs grow tails in lab test"` — a biology/health story — matches `\bworm\b` and would classify as Ransomware.

**How to avoid:** Replace the bare term with the two-word phrase `"computer worm"` in `SECTION_KEYWORDS["Ransomware"]`. Re-running the full 81-article snapshot with this single change removed the false positive with zero loss of true positives (no article in this snapshot needed the bare form to be correctly classified as Ransomware).

**Warning signs / required fixture:** A `classify.test.ts` case using this exact title (or an equivalent non-security "worm" sentence) asserting the result is **not** `"Ransomware"`.

---

### Pitfall 4: The same real-world story lands in two different sections depending on which outlet's wording is checked — and dedupe won't merge them

**What goes wrong:** Live evidence `[VERIFIED: live snapshot, this session]` — the ShinyHunters/FBI-breach story, reported independently by three sources:
- `bleeping-computer`: `"Sweden fines Miljödata..."` (different story, not this cluster — see the real cluster below)
- `hacker-news`: `"ShinyHunters Claims FBI Breach, Says It Stole Data on Agents and Job Applicants"` → classifies **Breaches** (title matches `breach`)
- `techcrunch-security`: `"Hacking group ShinyHunters claims it breached the FBI, stole agents' and applicants' data"` → classifies **Breaches** via title `breached`, *but* if `threat` had been left in the THREAT_INTELLIGENCE keyword list (as in the untuned reference taxonomy), the summary's incidental use of "threat" elsewhere would have pulled a differently-worded copy of the same event into Threat Intelligence instead.

This is the pitfall PITFALLS.md documents in the abstract (Pitfall 7 + Pitfall 8 combined) made concrete: because the three outlets used entirely different headlines, D-01's exact-URL-or-exact-normalized-title dedupe **will not merge these into one story** — `normalizeTitleForDedupe` on the two titles above produces different strings (`shinyhunters claims fbi breach says it stole data on agents and job applicants` vs. `hacking group shinyhunters claims it breached the fbi stole agents and applicants data`), so both survive as separate cards, likely both in Breaches, possibly in different sections if keyword tuning had been looser.

**How to avoid:** Nothing to "fix" — this is the accepted v1 tradeoff (D-01, D-11, PITFALLS.md Pitfall 7). The actionable outcome is (a) confirm the *tuned* keyword list (with `threat` pruned to `threat actor`/`threat group`, per D-07) puts both real copies of this story in the *same* section even though dedupe won't merge the cards, and (b) keep this exact live cluster as a documented fixture for classify.test.ts / a manual QA note, since it's a genuine "two cards, same story" case a reader could notice.

---

### Pitfall 5: The existing 400-code-point summary cap (Phase 2 D-08) can silently truncate a CVE out of view — accepted, but must not be "fixed" by accident

**What goes wrong:** Live evidence `[VERIFIED: live snapshot, this session]` — CISA's `"CISA Adds Four Known Exploited Vulnerabilities to Catalog"` genuinely lists 4 CVEs in its full body, but the summary is capped at 400 code points by `truncateSummary.ts` (Phase 2), which cuts the text after the 3rd CVE (`CVE-2026-93952 Arista VeloCloud Orchestrator...`) with a trailing ellipsis, before the 4th CVE ID appears. `extractCves()` correctly finds only 3 CVEs on this capped text — which happens to sit exactly at D-13's 3-chip cap, so this specific article shows exactly 3 chips with **no** "+N" indicator, silently hiding that a 4th CVE exists.

**How to avoid:** Nothing to change in Phase 3 — D-13 explicitly accepts this as "the Phase 2 D-08 consequence" and CVE extraction must run on `Article.summary` as already capped, never on an uncapped raw body. Flag this for the planner only so nobody "fixes" it by trying to extract CVEs from an uncapped field (which would violate the D-08 payload-size contract for an unrelated reason).

---

### Pitfall 6: An existing unit test directly asserts the pre-D-04 (no-decode) behavior and will fail once entity decoding ships

**What goes wrong:** `normalize.test.ts` (lines 51-61, read this session) contains:

```typescript
test("title containing markup and an ampersand entity survives verbatim (escaping is the render layer's job)", () => {
  const article = normalize(
    item({ title: "R&amp;D team ships <patch> for CVE-2026-0001" }),
    source
  );
  assert.equal(
    article?.title,
    "R&amp;D team ships <patch> for CVE-2026-0001",
    "normalize must not strip, unescape, or rewrite feed-supplied markup/entities"
  );
});
```

This test's own docstring — "escaping is the render layer's job" — is the **exact position D-04 overturns**. Once `normalize.ts` decodes title entities, this input's expected output changes to `"R&D team ships <patch> for CVE-2026-0001"` (only `&amp;` decodes; `<patch>` is not an entity and stays literal, still safely rendered as plain text per T-01-07).

**How to avoid:** This is not a regression to prevent — it is a **required, intentional test update**, called out explicitly so it is planned as a task rather than discovered as a surprise test failure mid-phase. See "Existing Tests Requiring Updates" below for the full list.

## Existing Tests Requiring Updates

| File | What must change | Why |
|------|-------------------|-----|
| `src/lib/pipeline/normalize.test.ts:51-61` | The `"title containing markup and an ampersand entity survives verbatim"` test's expected value must change from `"R&amp;D team ships <patch> for CVE-2026-0001"` to `"R&D team ships <patch> for CVE-2026-0001"` (decode `&amp;`, leave `<patch>` — not an entity — untouched). Its docstring's "escaping is the render layer's job" framing should be corrected to reference D-04. | D-04 directly reverses this test's asserted contract (Pitfall 6 above). |
| `src/lib/pipeline/frontpage.e2e.test.ts:73-86` (`"getFrontPage() returns articles sorted non-increasing by publishedAt"`) | Must be **removed or rewritten**. Once dedupe/classify/rank ship, `result.articles` (or `result.sections`) is ordered by section-then-score, not global recency — a live article set will no longer satisfy a global non-increasing-`publishedAt` assertion. Replace with an assertion scoped to `result.sections`: each group's articles are non-increasing by *score*, and groups themselves follow `SECTION_DISPLAY_ORDER`. | This is the one existing e2e assertion that is structurally incompatible with the new pipeline, not just extended by it. |
| `src/lib/pipeline/frontpage.e2e.test.ts:33-71` (the field-shape test) | Should be extended (not replaced) to assert `article.section` is one of the 7 valid `Section` values and `article.cves` is an array of strings matching `/^CVE-\d{4}-\d{4,7}$/`. | New fields need live-data coverage, matching this test's existing "well-formed, current articles from configured sources" spirit. |
| `src/lib/pipeline/sortByRecencyDesc.ts` + `sortByRecencyDesc.test.ts` | Recommend **deleting both files**. `rank.ts`/`groupBySection.ts` fully supersede the top-level flat-sort role this module played in the old `getFrontPage.ts`; CONTEXT.md's own discretion note already flagged it as "explicitly transitional." No other call site exists once `getFrontPage.ts` is updated. | Dead code after this phase's `getFrontPage.ts` rewrite; keeping it around with no caller needs its own justification comment if the planner chooses to keep it instead. |
| `test/productionPage.test.ts` | Likely **unaffected**, but must be re-run to confirm. Its `hasArticleAnchor`/`hasEmptyState` heuristic checks for `target="_blank" rel="noopener noreferrer"` anywhere in the body — still true once articles render inside per-section groups instead of one flat list, since `ArticleCard.tsx`'s anchor markup is unchanged. | Structural DOM nesting changes (headings + groups) don't change the specific attribute string this test greps for, but it is a full production-server e2e test and should be explicitly re-verified, not assumed. |

## Live Taxonomy Validation

This session fetched all 13 configured sources live via the real `fetchSource()`/`filterLookback()` pipeline (`SOURCES` from `src/lib/config/sources.ts`, unmodified). Result: **81 articles** survived the 24h window from **10 of 13 sources** (krebs, recorded-future, and crowdstrike contributed 0 — all three are already-documented, currently-quiet sources per `sources.ts`'s own comments, not a fetch failure — 0 errors were returned by any of the 13 sources this run).

The reference taxonomy (PROJECT.md) was ported and iteratively tuned against this snapshot. Final recommended keyword lists and their live distribution:

| Section | Keywords (word-boundary, case-insensitive) | Live matches (of 81) |
|---|---|---|
| Vulnerabilities | `CVE-`, `vulnerability`, `vulnerabilities`, `zero-day`, `0-day`, `exploit`, `exploited`, `flaw`, `patch`, `patches`, `patched` | 29 |
| Ransomware | `ransomware`, `malware`, `trojan`, `computer worm`, `ransom` | 5 |
| Breaches | `breach`, `breached`, `data leak`, `leaked`, `leak`, `compromise`, `compromised`, `unauthorized access` | 7 |
| Advisories | `advisory`, `advisories`, `security bulletin`, `warns`, `warning` | 0 (this cycle — CISA's advisory-shaped content correctly routes to Vulnerabilities first per D-05's intended specificity ordering; empty is expected some cycles, not a bug) |
| Threat Intelligence | `APT`, `threat actor`, `threat group`, `TA\d+`, `state-sponsored`, `nation-state`, `campaign`, `malicious` | 4 |
| Tools/Techniques | `tool`, `technique`, `framework`, `methodology`, `defense`, `detection` | 1 |
| Industry/Policy (default only — no active keyword list, per D-05) | — | 35 |

**Deviations from the reference taxonomy (PROJECT.md), each validated against the live snapshot:**
- Dropped bare `threat`, `attack`, `incident`, `encrypted`, `recommend`, `notice`, `law` — each is a single generic word that would incidentally match unrelated live articles (e.g., `attack` appears in headline contexts far outside Ransomware; `threat` appears in the ShinyHunters cross-source example above, Pitfall 4).
- Replaced bare `worm` with `computer worm` — see Pitfall 3 (live false positive on a biology article).
- Added `vulnerabilities` (plural), `exploited`, `patches`/`patched`, `breached`, `data leak` (kept from reference), `leak`, `compromised`, `advisories` (plural), `warns`, `threat group`, `nation-state` — all either present verbatim in live titles/summaries this session or trivial morphological variants of a reference term that would otherwise miss real matches (e.g. "Patches" vs "patch").
- Industry/Policy's reference keywords (`regulation`, `policy`, `compliance`, `GDPR`, `HIPAA`, `law`, `government`) are **not** wired into `CLASSIFICATION_ORDER` at all — per D-05, that section is purely the default bucket, not an eighth active rule. This matches the intended design and this session's distribution (35 articles landed there by exhaustion, not by a keyword match, including a visible cluster of general tech/AI news from `ars-technica` that has no security-specific angle — expected, since those 13 sources include general-tech outlets like `Ars Technica`/`TechCrunch Security` whose non-security coverage has nowhere else to go).

**No exact-normalized-title collisions existed in this snapshot** (checked programmatically) — meaning D-01's dedupe stage cannot be positively demonstrated end-to-end against *today's* live data; the ShinyHunters cluster (Pitfall 4) is the closest real near-duplicate, and it is a **negative** test case (confirms dedupe correctly does *not* merge differently-worded stories) rather than a positive one. **No URL carried a tracking query parameter** in this snapshot (`{}` params across all 81 URLs) — the tracking-param-stripping code path is defensive/forward-looking, not exercised by current live data; treat the exact param list as `[ASSUMED]` (see Assumptions Log).

## URL Canonicalization (D-01)

```typescript
// src/lib/pipeline/canonicalizeUrl.ts

/**
 * Standard tracking-parameter denylist [ASSUMED — not observed in this
 * session's live snapshot; all 81 live article URLs carried zero query
 * parameters]. Covers the common cross-platform tracking params publishers
 * intermittently add for social/newsletter syndication.
 */
const TRACKING_PARAM_EXACT = new Set([
  "fbclid", "gclid", "msclkid", "mc_cid", "mc_eid", "igshid",
  "yclid", "spm", "ref", "ref_src", "_hsenc", "_hsmi", "mkt_tok",
]);
const TRACKING_PARAM_PREFIX = /^utm_/i;

/**
 * Builds a comparison KEY for dedupe only — never replaces the displayed
 * `Article.url`, which must stay exactly what normalize.ts already
 * validated (T-01-04's https/http-only guarantee is untouched by this).
 */
export function canonicalizeUrl(rawUrl: string): string {
  const u = new URL(rawUrl);
  const host = u.hostname.toLowerCase();
  const path = u.pathname.replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(u.search);
  for (const key of [...params.keys()]) {
    if (TRACKING_PARAM_PREFIX.test(key) || TRACKING_PARAM_EXACT.has(key.toLowerCase())) {
      params.delete(key);
    }
  }
  params.sort();
  const search = params.toString();
  // Scheme is intentionally omitted from the key: D-01 treats http/https as equal.
  return `${host}${path}${search ? `?${search}` : ""}`;
}
```

## Title Normalization for Dedupe (D-01)

```typescript
// src/lib/pipeline/normalizeTitleForDedupe.ts

/**
 * Operates on `Article.title`, which is ALREADY entity-decoded by
 * normalize.ts (D-04) by the time dedupe runs — this function does not
 * re-decode, only NFKC-normalizes, lowercases, and collapses punctuation.
 */
export function normalizeTitleForDedupe(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
```

## Entity Decoding (D-04)

```typescript
// src/lib/pipeline/decodeHtmlEntities.ts

/**
 * Small named-entity table covering what's plausible in RSS/Atom titles.
 * Root-caused this session: rss-parser's own getSnippet() decodes
 * contentSnippet via the `entities` package but never decodes item.title
 * (node_modules/rss-parser/lib/utils.js:11-13) — this function closes that
 * gap for titles, using the same conceptual approach (named + numeric
 * entity resolution), without adding a dependency (see Don't Hand-Roll).
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  nbsp: " ", trade: "™", mdash: "—", ndash: "–",
  hellip: "…", copy: "©", reg: "®",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === "#") {
      const codePoint = body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
      try { return String.fromCodePoint(codePoint); } catch { return match; }
    }
    return NAMED_ENTITIES[body] ?? match; // unknown named entity: leave untouched, same failure mode as today
  });
}
```

```typescript
// src/lib/pipeline/normalize.ts — the one changed line (D-04)
title: decodeHtmlEntities(item.title).trim(),
```

## Type Extensions

```typescript
// src/lib/types.ts additions

/** The 7 sections, named exactly per REQUIREMENTS.md CLASSIFY-01/03. */
export type Section =
  | "Vulnerabilities"
  | "Advisories"
  | "Ransomware"
  | "Breaches"
  | "Threat Intelligence"
  | "Tools/Techniques"
  | "Industry/Policy";

export type SectionGroup = { section: Section; articles: Article[] };

export type Article = {
  title: string;
  url: string;
  source: string;
  sourceTier: SourceTier;
  publishedAt: string;
  summary: string;
  section: Section;   // NEW
  cves: string[];     // NEW — uppercase, deduped, first-appearance order
};

export type FrontPageResult =
  | { status: "ok"; articles: Article[]; sections: SectionGroup[] } // sections: NEW
  | { status: "error"; reason: string };
```

**Design note (Claude's Discretion, flagged for planner sign-off):** `articles` is kept as a flat array (built as `sections.flatMap((g) => g.articles)` — a single source of truth, never independently computed) so `frontpage.e2e.test.ts`'s existing field-shape assertions keep working with minimal changes, while `sections` is the pre-grouped, pre-ordered view `page.tsx` renders directly with zero pipeline logic of its own. An alternative (dropping flat `articles` entirely, deriving it in tests via `sections.flatMap`) is simpler but touches more existing test call sites — either is defensible; this is presented as the lower-churn option.

## `getFrontPage.ts` — Updated Orchestrator

```typescript
// src/lib/pipeline/getFrontPage.ts
import { SOURCES } from "../config/sources.ts";
import type { FrontPageResult } from "../types.ts";
import { fanOut } from "./fanOut.ts";
import { filterLookback } from "./filterLookback.ts";
import { dedupe } from "./dedupe.ts";
import { classify } from "./classify.ts";
import { extractCves } from "./extractCves.ts";
import { groupBySection } from "./groupBySection.ts";

export async function getFrontPage(now: number = Date.now()): Promise<FrontPageResult> {
  try {
    const fresh = filterLookback(await fanOut(SOURCES));
    const deduped = dedupe(fresh);
    const classified = deduped.map((article) => ({
      ...article,
      section: classify(article),
      cves: extractCves(article),
    }));
    const sections = groupBySection(classified, now);
    return { status: "ok", articles: sections.flatMap((g) => g.articles), sections };
  } catch (err) {
    return { status: "error", reason: err instanceof Error ? err.message : "unknown getFrontPage error" };
  }
}
```

## `page.tsx` — D-16 Sectioned Rendering

```tsx
// src/app/page.tsx (relevant excerpt)
import { SECTION_EMOJI } from "@/lib/config/sections";
// ...

{result.status === "ok" && result.sections.length > 0 ? (
  <div className="flex flex-col gap-10">
    {result.sections.map((group) => (
      <section key={group.section} className="flex flex-col gap-6">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
          {SECTION_EMOJI[group.section]} {group.section}
        </h2>
        <div className="flex flex-col gap-6">
          {group.articles.map((article) => (
            <ArticleCard key={article.url} article={article} />
          ))}
        </div>
      </section>
    ))}
  </div>
) : (
  <p className="text-zinc-500 dark:text-zinc-400">No articles in the last 24 hours.</p>
)}
```

Note: `article.url` remains a safe React `key` — dedupe guarantees uniqueness across the whole result, and `canonicalizeUrl()` (the dedupe comparison key) is never substituted for the displayed `article.url`, so this key's underlying values are identical to what Phase 2 already shipped.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Tracking-param denylist (`utm_*`, `fbclid`, `gclid`, `msclkid`, `mc_cid`, `mc_eid`, `igshid`, `yclid`, `spm`, `ref`, `ref_src`, `_hsenc`, `_hsmi`, `mkt_tok`) is a sufficient stripping list | URL Canonicalization | Zero live URLs in this session carried any query parameter at all, so this list is untested against real feed data. If a source later adds a tracking param outside this list, two otherwise-identical URLs would fail to dedupe-match on the URL key alone (the title key can still catch it) — low severity, not a correctness break. |
| A2 | The ~15-entry named-HTML-entity map (`trade`, `nbsp`, `mdash`, `ndash`, `hellip`, `copy`, `reg`, curly quotes, plus the 5 XML defaults) covers what the 13 sources actually emit | Entity Decoding | An entity outside the map falls through unchanged (same literal-text failure mode as today — not worse, just not improved). The specific STATE.md `&trade;` case could not be re-verified live this session since CrowdStrike contributed 0 articles in this snapshot's 24h window. |
| A3 | Tier weights (Government 1.5, Security Research/Threat Intelligence 1.3, Enterprise Security/Executive News 1.15, Tech & General 1.0) and 6-hour half-life | Pattern 3 (Ranking) | These are explicitly Claude's discretion per D-09/D-10 — no confirmation strictly required, but the specific numbers were not tuned against a human-judged "does this ranking feel right" pass; recommend a quick eyeball check during this phase's own UAT rather than treating the numbers as final. |
| A4 | `red-50`/`red-700`/`red-200` CVE chip tone meets WCAG AA (4.5:1), by analogy to Phase 2's proven `{hue}-50/700/200` construction | Pattern 6 (CVE chip rendering) | Inferred, not independently measured this session for the red hue specifically. If wrong, a contrast-checker pass during UI verification would need to substitute darker/lighter shades — low effort to fix if caught early. |

**If this table is empty:** N/A — see entries above.

## Open Questions

1. **Should `FrontPageResult` expose both a flat `articles` array and a grouped `sections` array, or only `sections`?**
   - What we know: Keeping both minimizes churn to `frontpage.e2e.test.ts`'s existing field-shape assertions; `sections` alone is a smaller, single-source-of-truth surface that Phase 4's per-section counts (UI-04) and filtering (FILTER-01) will need anyway.
   - What's unclear: Whether the redundancy is worth the lower migration cost, or whether it's better to pay that cost now and never carry two derived views.
   - Recommendation: Ship with both (as designed above, `articles` always derived via `flatMap` from `sections`, never independently computed) for this phase; revisit if Phase 4 finds the flat array unused.

2. **Should `sortByRecencyDesc.ts` be deleted in this phase, or kept as unused/dead code?**
   - What we know: No call site remains once `getFrontPage.ts` is rewritten; CONTEXT.md already flagged it as transitional.
   - What's unclear: None, really — recommend deletion; flagging only because CONTEXT.md left it as explicit discretion.
   - Recommendation: Delete `sortByRecencyDesc.ts` and its test file as part of this phase's plan.

3. **Should the "+N" overflow CVE chip use the same red tone as the visible chips, or a muted/neutral variant?**
   - What we know: D-15 describes "chips" collectively using the red tone; it doesn't explicitly distinguish the overflow chip's styling.
   - What's unclear: Whether a visually distinct (e.g., muted zinc) "+N" chip communicates "more exist, click through to see them" better than an identical-styled one.
   - Recommendation: Use the identical red-family style for simplicity in this phase (shown in Pattern 6); a `/gsd-ui-phase` pass, if run later, can refine this without a data-model change.

## Environment Availability

No new external dependency, service, or CLI tool is introduced by this phase. For completeness:

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js native TypeScript execution (`node --test` over `.ts` files) | Running the new pipeline stage tests | ✓ | v26.3.1 `[VERIFIED: node --version, this session]` | — |
| `rss-parser` | Unchanged upstream dependency this phase relies on for the entity-decoding root-cause analysis | ✓ | 3.13.0 `[VERIFIED: package.json]` | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface in this app (UI-06, unchanged) |
| V3 Session Management | no | No sessions |
| V4 Access Control | no | Fully public, no per-user data |
| V5 Input Validation | yes | CVE-chip NVD links are built **only** from the regex-matched ID (`https://nvd.nist.gov/vuln/detail/${id}`, where `id` matched `/CVE-\d{4}-\d{4,7}/i` and was `.toUpperCase()`'d) — never from feed-supplied URL/link text (D-14). The regex's `\d` classes make injection into the URL path structurally impossible (only digits and hyphens can appear in a match). Entity-decoded titles/summaries continue to render as plain JSX text children (T-01-07, unchanged) — decoding does not introduce an HTML-interpretation path. |
| V6 Cryptography | no | Not applicable to this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Building an outbound link from untrusted feed text (e.g., trusting a feed-supplied "CVE reference URL" field instead of constructing it from the validated regex match) | Tampering | D-14 already specifies: build the NVD URL only from the matched `CVE-\d{4}-\d{4,7}` substring; never incorporate any other feed-supplied string into the `href`. Codify this in `extractCves.test.ts` with a fixture where the feed text contains an adjacent malicious-looking URL immediately after a valid CVE ID, asserting the chip's `href` only ever contains the well-formed NVD path. |
| Re-introducing an HTML-interpretation path when adding entity decoding | Tampering (stored/reflected XSS) | Confirmed no new risk: decoded text is still passed as a plain string child to JSX (never `dangerouslySetInnerHTML`), so React's default escaping still applies at render time regardless of what characters the decoded string contains. |

## Sources

### Primary (HIGH confidence)
- This repository's own source, read in full this session: `src/lib/types.ts`, `src/lib/config/sources.ts`, `src/lib/pipeline/{normalize,truncateSummary,getFrontPage,sortByRecencyDesc,fetchSource,filterLookback}.ts` and their `.test.ts` files, `src/app/page.tsx`, `src/components/{ArticleCard,SourceTierBadge}.tsx`, `test/productionPage.test.ts`, `package.json`, `tsconfig.json`.
- `node_modules/rss-parser/lib/{parser,utils}.js`, `node_modules/rss-parser/package.json`, `node_modules/xml2js/lib/defaults.js`, `node_modules/sax/lib/sax.js`, `node_modules/entities/package.json` — read this session to root-cause the title-vs-contentSnippet entity-decoding gap.
- `.planning/CONTEXT.md` (03-CONTEXT.md), `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/PROJECT.md`, `.planning/phases/02-.../02-UI-SPEC.md`, `.planning/research/{ARCHITECTURE,PITFALLS,STACK}.md` — all read this session.
- **Live data:** this session's own fetch of all 13 configured sources via the real `fetchSource()`/`filterLookback()` code (not a mock), yielding 81 post-lookback articles from 10 contributing sources at 2026-09-23T09:4x UTC. Used to validate the taxonomy, discover the future-dated ranking bug, discover the `worm` false positive, and confirm zero live tracking-param/entity-decode instances currently in-window.
- `npm view entities version` / `npm view entities time.modified` — registry check, this session.
- `gsd-tools query package-legitimacy check --ecosystem npm entities` — this session.

### Secondary (MEDIUM confidence)
- None beyond the above — this phase required no external web search; every finding was groundable in this repo's own code, installed dependencies, or a live fetch of the app's actual data sources.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies is a direct, low-risk recommendation; the one alternative considered (`entities`) was fully verified (version, transitive presence, legitimacy signals) rather than assumed.
- Architecture: HIGH — every new module's shape follows the existing, already-shipped `filterLookback.ts`/`truncateSummary.ts` pure-function-with-colocated-test pattern; the orchestrator change is a minimal, additive rewrite of `getFrontPage.ts`.
- Taxonomy/keyword tuning: HIGH for the specific deviations documented (each is grounded in a live match or live false positive from this session's snapshot) — MEDIUM for the tier-weight/decay numeric constants, which are Claude's discretion and not independently human-validated for "feel."
- Pitfalls: HIGH — all 6 documented pitfalls are either directly observed in this session's live snapshot or directly read from this repo's/its dependencies' source code, not inferred from general domain knowledge.

**Research date:** 2026-09-23
**Valid until:** The live-data findings (taxonomy distribution, the specific future-dated Dark Reading item, the specific ShinyHunters cluster) are point-in-time and will look different on any other day — treat the *keyword lists and code patterns* as durable, but re-validate distribution numbers if classification quality is questioned later. General code/architecture findings: 30 days (stable, matches project convention).
