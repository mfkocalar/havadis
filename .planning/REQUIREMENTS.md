# Requirements: Havadis

**Defined:** 2026-09-14
**Core Value:** Security experts get a fast, reliable, always-current front page of what's happening across the industry — without visiting a dozen sites, and without the app doing redundant work on every page load.

## v1 Requirements

### Ingestion

- [x] **INGEST-01**: System fetches all 13 configured RSS/Atom sources server-side, in parallel, on each cache revalidation cycle
- [x] **INGEST-02**: A failure in one source (timeout, malformed XML, HTTP error, dead feed) does not prevent the page from rendering with the remaining sources' articles
- [x] **INGEST-03**: Each source fetch enforces a per-source timeout (~8s) and validates any redirect target (HTTPS only, same host) before following it
- [x] **INGEST-04**: Only articles published within the last 24 hours (per source, at fetch time) are considered
- [x] **INGEST-05**: The front page is served from Next.js's per-URL fetch cache with a ~15 minute revalidation window — the 13 sources are not refetched on every visitor request, only in the background once the window expires

### Normalization & Deduplication

- [x] **NORM-01**: Each article, regardless of source feed dialect (RSS 2.0 or Atom), is normalized to a common shape: title, url, source, source tier, published time, summary
- [x] **NORM-02**: Duplicate articles — same normalized (title, url) pair appearing from more than one source — are shown once (widened per decision D-01, 03-CONTEXT.md: two articles are duplicates when either their canonical URLs or their normalized titles match — an exact (title, url) pair almost never matches across outlets)

### Classification & Ranking

- [x] **CLASSIFY-01**: Each article is classified into exactly one of 7 sections (Threat Intelligence, Vulnerabilities, Breaches, Ransomware, Industry/Policy, Tools/Techniques, Advisories) via keyword/regex rules, first-match-wins, defaulting to Industry/Policy when nothing matches
- [x] **CLASSIFY-02**: Within each section, articles are ranked by a combination of recency and source weight
- [x] **CLASSIFY-03**: Sections render in operational-urgency order — Vulnerabilities and Advisories first, Ransomware and Breaches next, Threat Intelligence next, Tools/Techniques next, Industry/Policy last

### Front Page UI

- [ ] **UI-01**: User can view a responsive, newspaper-style front page with articles grouped under their 7 sections, in urgency order
- [x] **UI-02**: Each article card shows the source name, a source-tier badge, the verbatim (non-editorialized) title, a summary, a relative published time with the absolute time available on hover, and a link that opens the original article at the source's own URL. Title and summary are displayed within a fixed visual bound so card heights stay comparable across sources, and the summary is additionally capped in the data layer before render; "verbatim" constrains editorial rewriting (no re-casing, re-wording, or truncation of the underlying string), not display length (amended per gap `G-02-5`, decision `D-08`)
- [ ] **UI-03**: An article card shows a visible CVE-ID chip whenever a CVE identifier (pattern `CVE-\d{4}-\d{4,7}`) is detected in its title or summary
- [ ] **UI-04**: The page shows a "last updated" timestamp for the current cached snapshot and an article count per section
- [ ] **UI-05**: The layout is readable and usable on narrow mobile viewports (~360–390px wide) as well as desktop, verified on both, not just a resized desktop browser
- [x] **UI-06**: The site is fully public — no login, no authentication anywhere

### Filtering

- [ ] **FILTER-01**: User can filter the visible front page down to one or more sections/categories entirely client-side, over the already-rendered snapshot, with no full page reload and no new server fetch

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Sharing

- **SHARE-01**: User can copy a direct link to a single article via a per-article share/copy-link affordance

### Machine-Readable Output

- **FEED-01**: Havadis publishes its own classified, deduplicated, multi-source digest as a public RSS/Atom feed, generated from the same cached snapshot as the HTML page

### Feed Integrity

- **HEALTH-01**: The page surfaces when a configured source has produced zero articles in the current lookback window, so a silent outage doesn't read as "nothing to report"

### Discovery

- **SEARCH-01**: User can perform full keyword search across article titles/summaries (needs a stateless-compatible indexing approach before reconsidering)
- **ARCHIVE-01**: User can browse previous days' front pages (needs a persistence decision — conflicts with v1's stateless constraint)

### Content Quality

- **AI-01**: Articles are categorized and/or summarized using an LLM instead of keyword rules (reconsider only if the rule-based baseline proves to be a real accuracy problem in production)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| User accounts, login, bookmarks, personalization | v1 is public and stateless; no accounts means no reason to hold any user state — revisit only with a clear, validated driver |
| Dark mode toggle | Ship one visual theme (or system-preference-only) for v1 to keep UI scope small |
| Vercel Cron / scheduled pre-warming | Research confirmed Vercel Hobby cron is capped at once/day — incompatible with a 15-minute revalidation goal; v1 relies entirely on `fetch` + `revalidate` stale-while-revalidate, no cron dependency at all |
| Push notifications | Requires subscriber state, conflicts with stateless/no-accounts constraint; FEED-01 (v2) lets users' own tools notify them instead |
| Comments / social features | Moderation burden with zero ops capacity for a free stateless project; off-mission for a digest tool |
| Ads, sponsored content, paywall, metered access | Directly undermines credibility with a technical audience and the "fully public" constraint |
| Infinite scroll, autoplay media, personalized/algorithmic ranking | Actively harmful to the "read the same shared front page once, get back to work" value proposition for this audience |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INGEST-01 | Phase 2 | Complete |
| INGEST-02 | Phase 2 | Complete |
| INGEST-03 | Phase 1 | Complete |
| INGEST-04 | Phase 1 | Complete |
| INGEST-05 | Phase 1 | Complete |
| NORM-01 | Phase 1 | Complete |
| NORM-02 | Phase 3 | Complete |
| CLASSIFY-01 | Phase 3 | Complete |
| CLASSIFY-02 | Phase 3 | Complete |
| CLASSIFY-03 | Phase 3 | Complete |
| UI-01 | Phase 4 | Pending |
| UI-02 | Phase 1 | Complete |
| UI-03 | Phase 3 | Pending |
| UI-04 | Phase 4 | Pending |
| UI-05 | Phase 4 | Pending |
| UI-06 | Phase 1 | Complete |
| FILTER-01 | Phase 4 | Pending |

**Coverage:**

- v1 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0 ✓

---
*Requirements defined: 2026-09-14*
*Last updated: 2026-09-14 after roadmap creation*
