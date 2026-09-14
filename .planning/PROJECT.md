# Havadis

## What This Is

Havadis is a public, source-independent daily security newspaper for security experts. It aggregates articles from 13 curated cybersecurity RSS feeds, normalizes and deduplicates them, sorts them into 7 newspaper-style sections, and serves them as a fast, mobile-friendly, server-rendered front page. There are no user accounts — anyone can visit and read.

## Core Value

Security experts get a fast, reliable, always-current front page of what's happening across the industry — without visiting a dozen sites, and without the app doing redundant work (fetching all 13 sources) on every single page load.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] User can view a responsive, newspaper-style front page of current security news, grouped into 7 sections
- [ ] Articles are aggregated from 13 fixed RSS sources, normalized to a common shape
- [ ] Articles are deduplicated (same story from multiple sources shown once)
- [ ] Articles are classified into sections via keyword rules (ported from reference repo taxonomy)
- [ ] Sections are rendered in SOC/CISO triage-urgency order (Vulnerabilities/Threat Intel/Breaches/Ransomware first, Tools/Advisories/Industry-Policy after), not alphabetical or config-declaration order
- [ ] Articles are ranked within each section (recency + source weight)
- [ ] Front page is served from a short-lived cache — sources are not refetched on every request, only on a ~15 min revalidation window
- [ ] Each article shows source name, source tier badge, title, summary, relative published time, and links out to the original article
- [ ] User can filter the front page by section/category (client-side, over the already-cached snapshot)
- [ ] Site is fully public with no authentication
- [ ] Site works well on mobile (narrow viewport) and desktop

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
- Lookback window: 24 hours per source per refresh (articles older than 24h are dropped from consideration).
- Cache/revalidation window: ~15 minutes. Implemented via Next.js `fetch(url, { next: { revalidate: 900 } })` per source — Vercel's Data Cache serves the derived front page to all visitors and only re-runs ingestion in the background after the window expires (stale-while-revalidate). No cron, no KV, no DB for v1.
- Deduplication approach (ported from reference repo): dedupe by normalized (title, url) pair.
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
| Next.js + Tailwind on Vercel, no DB | Simplest architecture that is fast, serverless, mobile-friendly, and free-tier friendly; Next's fetch-cache gives "don't refetch every load" for free | — Pending |
| Cache via `fetch` + `revalidate`, not cron+KV/Blob | Avoids all persistent infra; matches "essentially stateless" requirement; optional cron pre-warm can be added later without architecture change | — Pending |
| Port sources + section taxonomy from mfksec/SecureNewspaper | Reference repo already has a vetted 13-source list and a working keyword-classification scheme — no need to redesign either from scratch for v1 | — Pending |
| Replaced Threatpost with The Hacker News | Research found Threatpost has been dead (no new posts) since Sept 2022; The Hacker News verified live (HTTP 200) and covers the same Threat Intelligence tier | ✓ Good |
| Rule-based (regex/keyword) categorization, not LLM | Free, instant, deterministic; matches free-tier constraint; LLM categorization deferred to v2 as a quality upgrade | — Pending |
| 24h lookback, 15min cache revalidation | User-confirmed values; balances "daily paper" feel with freshness | — Pending |
| No archive, no accounts, no dark-mode toggle in v1 | User-confirmed scope cuts to keep v1 small, stateless, and shippable fast | — Pending |
| Category filter (client-side) included in v1 | User-confirmed; cheap to add since it filters the already-cached snapshot, no new server work | — Pending |

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
*Last updated: 2026-09-14 after initialization*
