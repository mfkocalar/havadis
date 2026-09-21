# Roadmap: Havadis

## Overview

Havadis ships as a vertical MVP: each phase delivers a working, deployable slice of the real product rather than a horizontal layer. Phase 1 proves the entire architecture end-to-end with one real source (fetch → normalize → cache/revalidate → render, publicly, with no auth). Phase 2 widens that proven pipeline to all 13 configured sources with failure isolation, so one dead feed never takes down the page. Phase 3 makes the now-multi-source data trustworthy — deduplicated, classified into 7 sections, urgency-ordered, ranked, and CVE-annotated. Phase 4 assembles the final newspaper front page (full section layout, last-updated/count metadata, mobile polish) and adds the client-side category filter, completing the v1 scope entirely within Vercel's free tier.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Single-Source Pipeline (Vertical Slice)** - One real source flows fetch → normalize → cache/revalidate → render, end to end, publicly and mobile-safely (completed 2026-09-21)
- [ ] **Phase 2: Full Ingestion & Failure Isolation** - All 13 sources fetch in parallel each cycle; one dead/broken source never breaks the page
- [ ] **Phase 3: Deduplication, Classification & Ranking** - Multi-source articles are deduped, sorted into 7 urgency-ordered sections, ranked, and CVE-annotated
- [ ] **Phase 4: Newspaper Front Page, Filtering & Mobile Polish** - Full section layout, last-updated/count metadata, client-side filter, and verified mobile/desktop readability

## Phase Details

### Phase 1: Single-Source Pipeline (Vertical Slice)

**Goal**: A single real source flows through the entire architecture — fetch, normalize, cache/revalidate, render — proving the pipeline shape end to end on a publicly accessible, unauthenticated page.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: INGEST-03, INGEST-04, INGEST-05, NORM-01, UI-02, UI-06
**Success Criteria** (what must be TRUE):

  1. Visiting the public site (no login anywhere) shows real, current articles from one live security source, rendered as newspaper-style article cards.
  2. Each article card shows the source name, a source-tier badge, the verbatim (non-editorialized) title, a summary, a relative published time with the absolute time available on hover, and a working link to the original article at the source's own URL.
  3. Only articles published within the last 24 hours appear; older items from that source are excluded.
  4. Revisiting the page within ~15 minutes serves the identical cached snapshot (no new network fetch to the source); once the window elapses, the next visit triggers a background refetch.
  5. A deliberately slow or redirecting test fetch is aborted by the per-source timeout (~8s), and any redirect target is validated (HTTPS, same host) before being followed — it never hangs the page or blindly follows to an arbitrary host.

**Plans**: 4/4 plans executed

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Tracer: scaffold Next.js 16 in place, then wire the live Krebs feed through validated fetch → cache → normalize → 24h filter → render on a public page

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Complete the UI-02 article card, source-tier pill, masthead, and the quiet D-03 empty state in the Modern editorial direction

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md — Prove the reject/timeout branches with a hermetic fixture, pin the transform edges, and assert the no-auth + caching contract against a production build

**Wave 4** *(gap closure — blocked on Wave 3 completion)*

- [x] 01-04-PLAN.md — Close the Success Criterion 5 timeout gap: one continuous per-source budget spanning connect, headers and body, proven against a headers-then-stalled-body origin

**UI hint**: yes

### Phase 2: Full Ingestion & Failure Isolation

**Goal**: All 13 configured sources are fetched in parallel on every cache revalidation cycle, and a failure in any one of them never prevents the page from rendering the rest.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: INGEST-01, INGEST-02
**Success Criteria** (what must be TRUE):

  1. On a cache revalidation cycle, all 13 configured sources are fetched in parallel (observable as concurrent, not sequential, requests).
  2. When one configured source is deliberately broken (timeout, malformed XML, HTTP error, or dead endpoint), the front page still renders successfully using the remaining sources' articles rather than failing or hanging.
  3. Articles from all currently-healthy sources appear together through the same normalize/render path proven in Phase 1, confirming the fan-out feeds one unified pipeline.

**Plans**: TBD

### Phase 3: Deduplication, Classification & Ranking

**Goal**: With real multi-source data flowing, the same story reported by multiple outlets is shown once, every article is sorted into exactly one of 7 sections in operational-urgency order, articles are ranked within each section, and CVE identifiers are surfaced.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: NORM-02, CLASSIFY-01, CLASSIFY-02, CLASSIFY-03, UI-03
**Success Criteria** (what must be TRUE):

  1. When the same story is reported by more than one source, it appears on the front page only once.
  2. Every article is classified into exactly one of the 7 sections (Threat Intelligence, Vulnerabilities, Breaches, Ransomware, Industry/Policy, Tools/Techniques, Advisories) via keyword rules, defaulting to Industry/Policy when nothing matches.
  3. Sections render in operational-urgency order — Vulnerabilities/Advisories first, Ransomware/Breaches next, Threat Intelligence next, Tools/Techniques next, Industry/Policy last — not alphabetical or config-declaration order.
  4. Within each section, articles are ordered by a combination of recency and source weight, not raw feed order.
  5. Any article whose title or summary contains a CVE identifier (pattern `CVE-\d{4}-\d{4,7}`) displays a visible CVE-ID chip.

**Plans**: TBD
**UI hint**: yes

### Phase 4: Newspaper Front Page, Filtering & Mobile Polish

**Goal**: The complete newspaper front page is assembled — full section layout, freshness/coverage metadata, and a zero-server-round-trip category filter — and reads well on both mobile and desktop.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: UI-01, UI-04, UI-05, FILTER-01
**Success Criteria** (what must be TRUE):

  1. The front page displays all articles grouped under their 7 sections, in urgency order, in a responsive newspaper-style layout.
  2. The page shows a "last updated" timestamp for the current cached snapshot and an article count per section.
  3. The layout is readable and fully usable on narrow mobile viewports (~360–390px) as well as desktop, verified at real device widths, not just a resized desktop browser window.
  4. A user can filter the visible front page down to one or more sections entirely client-side — over the already-rendered snapshot, with no full page reload and no new server fetch.

**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Single-Source Pipeline (Vertical Slice) | 4/4 | Complete    | 2026-09-21 |
| 2. Full Ingestion & Failure Isolation | 0/TBD | Not started | - |
| 3. Deduplication, Classification & Ranking | 0/TBD | Not started | - |
| 4. Newspaper Front Page, Filtering & Mobile Polish | 0/TBD | Not started | - |
