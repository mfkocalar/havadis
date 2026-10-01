# Havadis

## What This Is

Havadis is a public, source-independent daily security newspaper for security experts. It aggregates articles from 13 curated cybersecurity RSS feeds, normalizes and deduplicates them, sorts them into 7 newspaper-style sections, and serves them as a fast, mobile-friendly, server-rendered front page. There are no user accounts — anyone can visit and read.

## Core Value

Security experts get a fast, reliable, always-current front page of what's happening across the industry — without visiting a dozen sites, and without the app doing redundant work (fetching all 13 sources) on every single page load.

## Requirements

### Validated

- ✓ Articles are aggregated from 13 fixed RSS sources, normalized to a common shape — Phase 2 (fetched in parallel; one failing source never blocks the rest)
- ✓ Front page is served from a short-lived cache — sources are not refetched on every request, only on a ~15 min revalidation window — Phase 1 (verified on a real Vercel preview)
- ✓ Each article shows source name, source tier badge, title, summary, relative published time, and links out to the original article — Phase 1, text bounds amended Phase 2 (D-08)
- ✓ Site is fully public with no authentication — Phase 1
- ✓ Articles are deduplicated (same story from multiple sources shown once) — Phase 3 (widened per D-01: canonical-URL-or-normalized-title match, earliest-published copy survives)
- ✓ Articles are classified into sections via keyword rules (ported from reference repo taxonomy, tuned per D-07) — Phase 3
- ✓ Sections are rendered in SOC/CISO triage-urgency order (Vulnerabilities, Advisories, Ransomware, Breaches, Threat Intelligence, Tools/Techniques, Industry/Policy — per Phase 3 D-12 and REQUIREMENTS.md CLASSIFY-03), not alphabetical or config-declaration order — Phase 3
- ✓ Articles are ranked within each section (recency + source weight) — Phase 3
- ✓ Visible CVE-ID chip on any article card whose title/summary matches the CVE pattern, linking out to NVD — Phase 3 (UI-03)
- ✓ User can view a responsive, newspaper-style front page of current security news, grouped into 7 sections — v1.0 (1/2/3-column card grid in a `max-w-7xl` shell; sections of 9+ articles cap at 6 behind a client-side "Show all N")
- ✓ The page shows a "last updated" timestamp and an article count per section — v1.0 (sticky bar: exact UTC "Updated" in cached HTML, relative after hydration; counts on each section pill; cards show absolute UTC times)
- ✓ User can filter the front page by section (client-side, over the already-cached snapshot) — v1.0 (multi-select pills toggle `hidden` on server-rendered sections; zero network requests, verified in a real browser)
- ✓ Site works well on mobile (narrow viewport) and desktop, verified on both — v1.0 (Playwright emulation at 360/390/768/1024/1280/1440px plus a real iOS Safari and Android Chrome pass; device models/OS versions not recorded)

### Active

(None — v1 scope shipped. Next-milestone requirements are defined by `/gsd-new-milestone`.)

### Out of Scope

- User accounts, login, bookmarks, personalization — v1 is public and stateless; no reason to hold user state — deferred indefinitely, revisit only if there's a clear driver
- Dark mode toggle — ship one visual theme (or system-preference-only) for v1 to keep UI scope small
- Full keyword search across titles/summaries — category filtering covers the 80% case for v1; keyword search is a v2 candidate
- Archive / browsing previous days' front pages — would require persisting historical snapshots, which conflicts with the "essentially stateless" v1 constraint; explicitly deferred to v2
- LLM-based categorization/summarization — v1 uses free, instant, deterministic keyword-rule classification (ported from reference repo); an LLM upgrade path (e.g. via Vercel AI Gateway) is a v2 candidate once the rule-based baseline is proven
- Server-side cron pre-warming of the cache — v1 relies on Next.js `fetch` + `revalidate` (stale-while-revalidate) with no cron job; a Vercel Cron pre-warm is an optional v1.1 latency optimization, not required for MVP

## Context

- Reference implementation: https://github.com/mfksec/SecureNewspaper — a Python/Slack-webhook "security gazette" generator. Havadis ports its **source list** and **section taxonomy** (not its Slack delivery mechanism, which is irrelevant to a public web app).
- 13 sources for v1 (fixed, hardcoded — no source-management UI):

  | Tier | Source | Feed URL |
  |---|---|---|
  | Government | CISA Alerts | https://www.cisa.gov/cybersecurity-advisories/all.xml |
  | Security Research | Krebs on Security | https://krebsonsecurity.com/feed |
  | Security Research | Recorded Future | https://www.recordedfuture.com/feed/ |
  | Security Research | Microsoft Security Blog | https://www.microsoft.com/en-us/security/blog/feed/ |
  | Enterprise Security | SANS ISC | https://isc.sans.edu/dailypodcast.xml |
  | Enterprise Security | Dark Reading | https://www.darkreading.com/rss.xml |
  | Enterprise Security | CrowdStrike Blog | https://www.crowdstrike.com/blog/feed/ |
  | Threat Intelligence | Bleeping Computer | https://www.bleepingcomputer.com/feed/ |
  | Threat Intelligence | The Hacker News | https://feeds.feedburner.com/TheHackersNews |
  | Threat Intelligence | Help Net Security | https://www.helpnetsecurity.com/feed/ |
  | Tech & General | TechCrunch Security | https://techcrunch.com/category/security/feed/ |
  | Tech & General | Ars Technica | https://feeds.arstechnica.com/arstechnica/index |
  | Executive News | CSO Online | https://www.csoonline.com/feed/ |

- 7 sections for classification (ported from reference repo's `config.yaml`, keyword/regex-based, case-insensitive, first-match-wins, default = INDUSTRY_POLICY):
  - ⚠️ THREAT_INTELLIGENCE — APT, threat actor, TA\d+, state-sponsored, campaign, malicious, threat
  - 🐛 VULNERABILITIES — CVE-, vulnerability, 0-day, zero-day, exploit, patch, flaw
  - 🚨 BREACHES — breach, data leak, leaked, compromise, unauthorized access, incident
  - 💀 RANSOMWARE — ransomware, malware, worm, trojan, encrypted, attack
  - 🏛️ INDUSTRY_POLICY — regulation, policy, compliance, GDPR, HIPAA, law, government (also the default bucket)
  - 🔧 TOOLS_TECHNIQUES — tool, technique, framework, methodology, defense, detection
  - 📢 ADVISORIES — advisory, alert, warning, notice, recommend, security bulletin
- The tuned, word-bounded keyword lists actually used live in src/lib/config/sections.ts (Phase 3 D-07; every deviation from the list above is documented there). Industry/Policy is the default-only bucket, not an active rule (D-05).
- Lookback window: 24 hours per source per refresh (articles older than 24h are dropped from consideration).
- Cache/revalidation window: ~15 minutes. Implemented via Next.js `fetch(url, { next: { revalidate: 900 } })` per source — Vercel's Data Cache serves the derived front page to all visitors and only re-runs ingestion in the background after the window expires (stale-while-revalidate). No cron, no KV, no DB for v1.
- Deduplication approach (Phase 3 D-01, widened from the reference repo's normalized (title, url) pair): two articles are the same story if either their canonical URLs or their normalized titles match; the earliest-published copy survives (D-02), and the collapse is silent (D-03).
- Must run entirely within Vercel's free tier — this rules out always-on infrastructure, paid KV/DB add-ons, and anything that scales cost with traffic in a way that could exceed free-tier limits.

## Constraints

- **Tech stack**: Next.js (App Router, TypeScript) + Tailwind CSS, deployed on Vercel — decided with the user before project init, not open for re-litigation without a clear reason.
- **Cost**: Must run on Vercel's free tier — no paid database, no paid KV, no paid cron beyond free-tier allowances.
- **Statelessness**: No database. The only "state" is Next.js's own derived-data cache (a disposable, regenerable artifact), not source-of-truth state. Any feature that needs true persistence (archive, accounts) is explicitly out of scope for this reason.
- **Sources**: Fixed list of 13 RSS/Atom feeds (see Context). No source-management UI in v1; adding/removing a source is a code change.
- **Public**: No authentication anywhere in v1.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Next.js + Tailwind on Vercel, no DB | Simplest architecture that is fast, serverless, mobile-friendly, and free-tier friendly; Next's fetch-cache gives "don't refetch every load" for free | ✓ Good — Phase 1 |
| Cache via `fetch` + `revalidate`, not cron+KV/Blob | Avoids all persistent infra; matches "essentially stateless" requirement; optional cron pre-warm can be added later without architecture change | ✓ Good — Phase 1 (verified on a real Vercel preview: HIT/STALE transitions and single-flight revalidation behave as expected) |
| Port sources + section taxonomy from mfksec/SecureNewspaper | Reference repo already has a vetted 13-source list and a working keyword-classification scheme — no need to redesign either from scratch for v1 | ✓ Good — Phase 2 (all 13 wired; sans-isc, recorded-future, crowdstrike use corrected canonical URLs); Phase 3 (taxonomy tuned, word-bounded, plural-tolerant, D-07 deviations documented) |
| Replaced Threatpost with The Hacker News | Research found Threatpost has been dead (no new posts) since Sept 2022; The Hacker News verified live (HTTP 200) and covers the same Threat Intelligence tier | ✓ Good |
| Rule-based (regex/keyword) categorization, not LLM | Free, instant, deterministic; matches free-tier constraint; LLM categorization deferred to v2 as a quality upgrade | ✓ Good — Phase 3 |
| Widened dedupe to canonical-URL-OR-normalized-title match, earliest-published copy survives (D-01/D-02) | An exact (title, url) pair almost never matches across independently-worded outlets covering the same story; widening the match and picking the earliest copy actually collapses cross-outlet duplicates | ✓ Good — Phase 3, verified against live multi-source data (66/66 unique post-dedupe) |
| `rankScore = TIER_WEIGHT[tier] * recencyDecay(age)`, 6-hour half-life, future-dates clamped | A Government/Security-Research item should outrank a same-age Tech item; a live Dark Reading item dated 71 days in the future would otherwise dominate every section without a clamp | ✓ Good — Phase 3, human-verified "feel" on live headlines |
| CVE chip `href` built only from a re-validated, anchored ID match (`^CVE-\d{4}-\d{4,7}$`), never from feed-supplied URLs; 3-visible-chip + "+N" overflow cap (D-13/D-14) | Feed-controlled text must never reach an outbound `href` unvalidated (open-redirect/`javascript:` risk); a hard visual cap keeps a Patch-Tuesday multi-CVE title from dominating a card | ✓ Good — Phase 3, defense-in-depth confirmed in security review (T-03-11) |
| 24h lookback, 15min cache revalidation | User-confirmed values; balances "daily paper" feel with freshness | ✓ Good — Phase 1 |
| No archive, no accounts, no dark-mode toggle in v1 | User-confirmed scope cuts to keep v1 small, stateless, and shippable fast | ✓ Good — Phase 1 (no auth surface confirmed on deployed page) |
| Category filter (client-side) included in v1 | User-confirmed; cheap to add since it filters the already-cached snapshot, no new server work | ✓ Good — Phase 4 (no new server fetch, verified in a real browser) |
| Composed caller `AbortSignal` into the per-hop redirect guard via `AbortSignal.any` | 01-03's timeout coverage only spanned header arrival, not the body-read phase — a headers-then-stalled-body origin was never aborted (found by phase verification, closed by Phase 1's 01-04 gap-closure plan) | ✓ Good — Phase 1 |
| Source content-type gate accepts `html` alongside `xml` | Krebs on Security's live `/feed` serves genuinely valid RSS under a `text/html` content-type; a strict xml-only check silently emptied the one proven source. `rss-parser`'s own parse step remains the real authority on feed validity | ✓ Good — Phase 1, but flagged (code review WR-01) to scope the exception per-source rather than globally once Phase 2 widens to 13 sources — a misbehaving non-Krebs source could otherwise burn full body-download+parse cost before failing fast. Resolved Phase 2 (`02-02`): HTML acceptance is now a per-source `allowHtmlContentType` opt-in; only `krebs` opts in (added in `da6dbba`, 2026-09-27, after Krebs was found silently dropped by the gate) |
| Fan out with `Promise.allSettled`, not `Promise.all` | Even if `fetchSource`'s never-throws contract regresses, one rejected source can never collapse the whole page into the error state; a stalled source's timeout budget runs concurrently, not added to the others' | ✓ Good — Phase 2 (`02-01`, proven against real sockets in `02-03`) |
| Article card title and summary bounded by a CSS clamp, plus a 400-code-point data-layer cap on the summary | UAT G-02-5 measured a ~94x summary-length spread across 13 sources (80 to 7,541 median characters, 26,744 worst case) making card heights wildly inconsistent, and shipping up to ~26KB of publisher body per article in the RSC payload; supersedes Phase 1's single-source no-clamp mandate (D-08) | ✓ Good — Phase 2 gap closure, plan `02-04` |
| Unpressed pill / expander outline uses `ring-zinc-500`, not the UI-SPEC's zinc-400 (light) / zinc-600 (dark) | The spec values measured 2.63:1 and 2.29:1 against the 3:1 non-text contrast target; zinc-500 measures 4.83:1 / 3.67:1. A contrast test gates it | ✓ Good — user-approved, Phase 4 |
| Filter pills scroll horizontally below 1024px and wrap from 1024px (UI-SPEC said 768px) | At 768px the 7 pills wrapped to 3 rows and the sticky bar reached 133px against the 96px scroll-padding budget | ✓ Good — user-approved, Phase 4 |
| Cards show absolute UTC publish times; only the sticky bar's "Updated" text is relative and live | Card relative times freeze at render in a cached page and could contradict the live clock; a live clock per card would need ~64 client components | ✓ Good — Phase 4 review fix (WR-04) |
| Keep `lg:grid-cols-3` although ~25% of titles hit the 3-line clamp at 1024px | Backstop measurement was 17/68 at 1024px and 1/68 at 1280px; user chose to keep D-02 as locked | — Revisit if reader feedback complains about truncated titles |

## Current State

Shipped **v1.0 MVP** on 2026-10-01: 4 phases, 14 plans, ~5.7K lines of TypeScript in `src/`. All 17 v1 requirements are complete. The site is a static, ISR-style Next.js 16 page (900s revalidate) aggregating 13 feeds, deduplicated, classified into 7 urgency-ordered sections, with a client-side section filter and verified mobile layout.

Known follow-ups carried out of v1.0 (none block use):
- Phases 1, 3 and 4 were closed with stale verification reports (an override closeout); no milestone audit was run.
- 768–1023px layouts are emulation-verified only; real-device models/OS versions were not recorded.
- The Vercel preview predates the final pill-wrap commit.
- `scripts/verify-viewports.mjs` needs Playwright installed ad hoc (`npm install --no-save playwright@1.63.0`); it is deliberately not a dependency.

## Next Milestone Goals

Not yet defined. Candidates from Out of Scope and earlier notes: keyword search, an optional daily cron pre-warm, LLM categorization/summarization, and archive of past front pages (requires persistence). Run `/gsd-new-milestone` to choose.

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-10-01 after v1.0 milestone*
