# Project Research Summary

**Project:** Havadis — security-news aggregation "front page"
**Domain:** Stateless, serverless RSS/Atom aggregation web app (Next.js on Vercel free tier)
**Researched:** 2026-09-14
**Confidence:** HIGH

## Executive Summary

Havadis is a stateless, server-rendered "front page" aggregator that pulls 13 fixed RSS/Atom security-news feeds, classifies them into 7 operationally-ordered sections, and serves the result to a public, unauthenticated audience of SOC analysts, security engineers, and CISOs. The right way to build this — confirmed against current Next.js 16 and Vercel docs — is to lean entirely on Next.js's per-fetch Data Cache (`fetch(url, { next: { revalidate: 900 } })`) as the *only* persistence layer, with no database, no cron (Hobby cron is daily-only), and no Route Handler indirection: a Server Component calls one orchestrator function (`getFrontPage()`) that fans out 13 parallel fetches, normalizes/dedupes/classifies/ranks them into a view model, and renders it, with a client-only category filter on top.

The key risk in this architecture is not the framework — it's the 13 untrusted, unreliable third-party feeds. Every pitfall of consequence traces back to that: one bad/slow/blocked source must never crash or stall the whole page (`Promise.allSettled`, per-source timeouts, typed error results, not `Promise.all`), several sources sit behind anti-bot protection and need realistic browser headers, feed redirects must be validated to avoid SSRF, and XML must be parsed leniently since real-world feeds are rarely perfectly well-formed. A second, lower-severity risk is free-tier budget discipline: exactly one fetch signature, one pinned Vercel region, and no duplicate/uncached code paths keep the app inside Hobby's invocation/CPU-hour ceiling as the only thing standing between "just works" and a paused app.

Feature-wise, most of what makes this trustworthy to a security-expert audience (source tier badges, verbatim headlines, direct links, no login wall, client-side filter) is already locked into PROJECT.md and reinforced by this research. The single highest-leverage, zero-cost addition surfaced by research is ordering the 7 sections by operational urgency (Vulnerabilities/Advisories → Ransomware/Breaches → Threat Intel → Tools/Techniques → Industry/Policy last) to match how this audience actually triages a digest — this should be written into v1 requirements even though it's just a render-order decision. Everything else differentiator-level (CVE-ID chips, RSS/Atom output of the digest itself, feed-health transparency, "last updated" + counts) piggybacks on the same computed snapshot with zero new infrastructure and is well-suited to v1.1, not v1.

## Key Findings

### Recommended Stack

Next.js 16.3.5 (App Router, Cache Components **off**) + React 19.3.0 + TypeScript pinned to `^5.7` (not the new `7.x` line) + Tailwind CSS 4.x (CSS-first config) on Vercel Hobby. `rss-parser@3.13.0` parses raw XML text (fetched via native `fetch`, not its own HTTP client) into a normalized RSS/Atom item shape — this is the seam that preserves Next.js's Data Cache behavior. `fast-xml-parser` is a fallback only for feeds `rss-parser` can't cleanly handle. No date-formatting library is needed given the 24h lookback window (hand-roll ~15 lines instead). Vercel Cron cannot replicate a 15-min pre-warm on Hobby (daily-only) — v1 relies purely on visitor-triggered revalidation.

**Core technologies:**
- Next.js 16 (App Router, default caching model) — official per-fetch Data Cache gives exactly the "15-min stale-while-revalidate, no DB/cron" behavior needed, confirmed still first-class in Next 16
- `rss-parser` — normalizes both RSS 2.0 and Atom into one item shape across 13 mixed-format sources
- Tailwind CSS 4 + `clsx` — styling and conditional classes, no paid UI kit needed
- Vercel Hobby (Data Cache + Functions) — only persistence layer; 2MB/item cache cap, ~10s default function duration (configurable), single region should be pinned

### Expected Features

Security-expert readers triage digests in a specific order (exploitable vulns/advisories first, ransomware/breaches next, threat intel, tools, policy last) — this should directly drive section ordering, a zero-cost render decision not yet explicit in PROJECT.md.

**Must have (table stakes):**
- Verbatim (non-editorialized) headlines, direct links to original sources, visible source-tier badges
- Relative timestamps (+ absolute on hover), fast/mobile-friendly server rendering, no login wall
- Client-side category filter over the already-rendered snapshot (no refetch)

**Should have (competitive):**
- Explicit section ordering by operational urgency (P1, zero cost — pull into v1)
- CVE-ID chip/token extraction on cards, "last updated" + per-section counts, feed-health transparency, public RSS/Atom output of the classified digest, copy-link affordance (all P2, cheap v1.1 candidates — piggyback on the existing snapshot, no new infra)

**Defer (v2+):**
- Full-text search, archive/browse-past-days (both conflict with the stateless/no-DB constraint)
- LLM-based categorization/summarization, user accounts/personalization/notifications
- Anti-features to actively avoid: infinite scroll, autoplay/ads/paywall, editorialized headlines, algorithmic "for you" ranking, comments

### Architecture Approach

A Server Component (`page.tsx`) calls exactly one orchestrator, `lib/pipeline/getFrontPage()`, directly — no internal Route Handler in the loop. The orchestrator fans out 13 parallel `fetch()` calls (each independently cached, `Promise.allSettled`, per-source try/catch, 8-10s timeout), then runs a pure pipeline: normalize → trim to 24h → dedupe (exact `title+url`) → classify (first-match keyword rules, 7 sections) → rank (recency + tier weight) → view model. A `<CategoryFilter>` Client Component filters the already-rendered snapshot client-side with zero server round-trip.

**Major components:**
1. Fetchers (`lib/sources/*`) — one `fetch()` per source, own cache entry, never throws (returns typed ok/error result)
2. Pipeline stages (normalize/dedupe/classify/rank) — pure `Article[] → Article[]` functions, independently unit-testable
3. `getFrontPage()` orchestrator — the single call site `page.tsx` depends on; composes stage order
4. Server-rendered newspaper layout + `<CategoryFilter>` Client Component — presentational, no re-fetch/re-derive on filter interaction

Suggested build order: static shell → one real source end-to-end → fan-out with failure isolation (12/13 must survive one dead source) → dedupe → classify → rank → client filter → polish (mobile, badges, empty/error states).

### Critical Pitfalls

1. **One misbehaving feed takes down the whole page** — use `Promise.allSettled` + per-source try/catch + typed result + timeout, never bare `Promise.all`. Foundational, not a hardening afterthought.
2. **Anti-bot blocking (CISA, Krebs, others) invisible in local dev** — set realistic browser `User-Agent`/`Accept` headers on every fetch; detect "got HTML not XML" as a distinct failure mode, don't try to defeat JS challenges.
3. **SSRF via unvalidated feed redirects** — validate resolved redirect host/IP against private/reserved ranges before following; cap redirect depth. Build-time hardening, not a later security pass.
4. **Malformed/non-well-formed XML crashes the parser** — use a lenient/tolerant parser, catch parse errors at the same boundary as fetch errors, test against a deliberately malformed fixture.
5. **Cold cache after deploy triggers a 13-way synchronous latency spike** — parallelize with firm timeouts; accept as a documented v1 tradeoff, optionally mitigate with a one-shot post-deploy pre-warm curl (not a recurring cron).

Also material: per-region cache inconsistency (pin a single Vercel region), naive exact-match dedup missing near-duplicate stories (accept for v1, add normalization if it proves visible), first-match-wins classification false positives into the default bucket (mitigate via deliberate section-check ordering, not scoring), structurally-dead sources silently degrading content (one-time build-time liveness check), free-tier budget creep from duplicate fetch paths or multi-region, and mobile layout collapsing into an unreadable long scroll if not designed alongside desktop.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Static Shell & Project Setup
**Rationale:** Proves the newspaper visual structure and toolchain before any network/pipeline complexity; nothing later blocks on this, but everything depends on it.
**Delivers:** Next.js 16 + Tailwind 4 + TypeScript 5.x scaffold, root layout, `SectionGroup`/`ArticleCard` components rendering hardcoded fixture articles.
**Addresses:** Fast/mobile-friendly rendering foundation (table stakes).
**Avoids:** N/A (pre-pipeline); establishes the mobile-first layout discipline needed to avoid Pitfall 11 later.

### Phase 2: Single-Source Ingestion (End-to-End Proof)
**Rationale:** Smallest slice that proves `fetch()` + `revalidate: 900` actually caches and that a real feed's quirks (encoding, anti-bot, malformed XML) are handled, before multiplying by 13.
**Delivers:** One real fetcher (e.g., CISA) → normalize → 24h lookback trim → real titles/dates/links rendered, single undifferentiated section.
**Uses:** `rss-parser`, native `fetch` + `next.revalidate`, browser-like User-Agent/Accept headers.
**Implements:** Fetcher pattern (never-throws, typed result), normalize pipeline stage.

### Phase 3: Feed Ingestion & Normalization (All 13 Sources, Failure-Isolated)
**Rationale:** This is where the highest-severity pitfalls live (crash isolation, anti-bot, SSRF, malformed XML, dead sources) — must be solid before dedup/classify/rank have realistic multi-source data to operate on.
**Delivers:** All 13 `SourceConfig` entries wired with `Promise.allSettled`, per-source timeout/try-catch, redirect validation, lenient XML parsing; deliberately-broken source proves page still renders 12/13.
**Addresses:** Source-tier badges/attribution foundation (table stakes).
**Avoids:** Pitfalls 1-4, 9 (whole-page crash, anti-bot blocking, SSRF, malformed XML, structurally-dead source).

### Phase 4: Dedup, Classification & Ranking
**Rationale:** Only meaningful once ≥2 real sources can report overlapping stories; depends entirely on Phase 3's fan-out being solid.
**Delivers:** Exact-match `(title,url)` dedup, 7-section first-match-wins classifier (deliberately ordered: specific/high-signal sections before generic default), recency+tier ranking.
**Addresses:** 7-section classification, section ordering by operational urgency (P1 differentiator from FEATURES.md).
**Avoids:** Pitfalls 7-8 (dedup misses, misclassification into default bucket) via documented section-order and normalization decisions.

### Phase 5: Newspaper Layout, Client Filter & Caching Discipline
**Rationale:** Final assembly of the view model into the actual UI, plus the platform-level guardrails (region pinning, single fetch signature) that keep the app inside free-tier limits.
**Delivers:** Grouped newspaper layout by section, `<CategoryFilter>` Client Component (zero server round-trip), pinned single Vercel region, `maxDuration` set explicitly, relative+absolute timestamps, mobile-first responsive design verified at real breakpoints.
**Uses:** Tailwind CSS 4 fluid grid/flexbox, `clsx`.
**Avoids:** Pitfalls 5-6, 10-11 (cold-start latency, per-region inconsistency, free-tier budget creep, mobile layout unreadability).

### Phase Ordering Rationale

- Static shell before any pipeline work isolates visual/layout risk from data risk (Pitfall 11 is cheapest to avoid if mobile is designed from Phase 1, not retrofitted).
- Single-source proof-of-pipeline before full 13-source fan-out follows the architecture research's explicit build-order guidance: dedup/classify/rank are untestable with realistic data until multiple real sources flow through, but failure-isolation guardrails must not be deferred past the fan-out phase.
- Dedup/classify/rank grouped together because they're the same category of pure-function pipeline stage research recommends they be built/tested together once multi-source data exists.
- Caching/layout polish last because it depends on the full view model existing and is where the free-tier budget and cold-start pitfalls become observable/testable.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Feed Ingestion, all 13 sources):** Per-source anti-bot behavior for the *specific* 13 feeds is inferred, not freshly re-verified per feed (MEDIUM confidence in PITFALLS.md) — plan should include a build-time verification pass confirming which sources actually need special headers/handling in production.
- **Phase 5 (Caching/Layout):** Exact current Vercel Hobby Function duration defaults/ceilings vary slightly by source (MEDIUM confidence) — verify actual current numbers against `vercel.com/docs/functions/limitations` at implementation time before finalizing `maxDuration`.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Static Shell):** Standard Next.js/Tailwind scaffolding, HIGH confidence, no novel patterns.
- **Phase 2 (Single-Source Proof):** Well-documented `fetch`+`rss-parser` integration, HIGH confidence.
- **Phase 4 (Dedup/Classify/Rank):** Pure-function patterns with explicit, already-researched tradeoff decisions (exact-match dedup, first-match-wins classification) — HIGH confidence, decisions already made in PITFALLS.md.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified directly against npm registry and current Next.js/Vercel official docs (dated 2026-08+) |
| Features | MEDIUM-HIGH | Table-stakes/anti-features well-grounded; triage-ordering claims are synthesized from well-corroborated SOC/analyst practice, not a single benchmarked source |
| Architecture | HIGH (Next.js patterns) / MEDIUM (exact Vercel plan limits) | Core App Router/caching patterns are official-docs-verified; specific Hobby duration/limit figures vary slightly by source and should be reconfirmed at build time |
| Pitfalls | HIGH (caching/limits) / MEDIUM (per-feed anti-bot specifics) | Vercel caching/limits behavior confirmed against current docs; feed-reliability patterns are well-established but per-source specifics inferred from a reference repo, not freshly tested against each of the 13 live feeds |

**Overall confidence:** HIGH

### Gaps to Address

- **Per-feed anti-bot/liveness specifics:** Which of the 13 sources actually need special User-Agent handling, and whether all 13 are still actively publishing, is only confirmable by a manual build-time check (flagged explicitly in PITFALLS.md as a Phase 3 checklist item) — not resolvable through research alone.
- **Exact current Vercel Hobby Function duration/limit figures:** Cross-checked across multiple sources but noted to shift between plan-version rollouts; reconfirm against official docs when configuring `maxDuration` in Phase 5.
- **Section-ordering and first-match classification-order specifics:** Research gives a directional recommendation (urgency-first ordering, specific-before-generic keyword checks) but the exact keyword rule set is inherited from a reference repo and should be spot-checked against real classified output during Phase 4, not assumed correct on paper.

## Sources

### Primary (HIGH confidence)
- nextjs.org/docs/app/api-reference/functions/fetch — `next.revalidate` semantics
- vercel.com/docs/caching/runtime-cache/data-cache — Data Cache behavior, limits, per-region model
- vercel.com/docs/functions/limitations, vercel.com/docs/limits — Hobby-tier limits
- github.com/rbren/rss-parser — parser API and normalized item shape
- Direct npm registry queries for all pinned package versions

### Secondary (MEDIUM confidence)
- WebSearch cross-checks on Vercel Hobby cron/limits figures, Tailwind v4 install steps, date-fns caveats
- SANS NewsBites, Risky Business News, BleepingComputer — competitor feature/cadence patterns
- General security-community knowledge of SOC/CISO triage ordering (synthesized, not benchmarked)

### Tertiary (LOW confidence)
- Public reporting on Threatpost's 2022 publishing cessation — illustrative only, needs a fresh build-time check regardless

---
*Research completed: 2026-09-14*
*Ready for roadmap: yes*
