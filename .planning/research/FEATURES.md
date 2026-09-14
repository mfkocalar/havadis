# Feature Research

**Domain:** Security-news aggregation / "day's top security news" digest (public, stateless, serverless web app)
**Researched:** 2026-09-14
**Confidence:** MEDIUM-HIGH (patterns cross-checked across multiple established security digests and aggregators; specific ordering/prominence claims are synthesized from well-known SOC/analyst triage behavior rather than a single authoritative source — flagged per-item below)

## How Security Experts Actually Scan a Digest

This is the crux input for section ordering/prominence, so it's called out before the tables.

Security professionals (SOC analysts, security engineers, CISOs) do not read a digest top-to-bottom like a general news reader. They triage it, and the triage order is remarkably consistent across the community (SANS ISC, SANS NewsBites, Risky Business News, tl;dr sec, CISA's own alert cadence, and how BleepingComputer/The Hacker News structure "breaking" vs. general coverage):

1. **"Is something actively being exploited right now that I need to patch/block today?"** — This maps to *Vulnerabilities* (CVE/0-day/exploit mentions) and *Advisories* (vendor/CISA bulletins), specifically anything with active-exploitation or emergency-patch language. This is scanned first, MEDIUM confidence on exact rank vs. Breaches but HIGH confidence it's top-2.
2. **"Is there an active ransomware/breach campaign hitting my sector right now?"** — *Ransomware* and *Breaches* are scanned second. CISOs in particular jump straight here because it drives board/customer questions.
3. **"What's the broader threat landscape (APT activity, campaigns) I should be aware of but isn't a today-fire-drill?"** — *Threat Intelligence* is read third; informs longer-term detection/hunting work, not immediate action.
4. **"Anything new in tooling/technique I should evaluate?"** — *Tools/Techniques* — read opportunistically, lower urgency.
5. **"Policy/industry/regulatory noise"** — *Industry/Policy* is read last or skipped by SOC/engineer roles; CISOs read it but not urgently (it's "know for the next board meeting," not "act now").

**Implication for Havadis** (beyond what's already decided in PROJECT.md — category filter + tier badges + relative timestamps are already locked in):
- The 7 sections should be **ordered** on the page: Vulnerabilities and Advisories first (or a merged/adjacent placement, since both signal "actionable, time-sensitive"), then Ransomware/Breaches, then Threat Intelligence, then Tools/Techniques, then Industry/Policy last. This is a **zero-cost ordering decision** (just an array order in the render), not a new feature — worth stating explicitly as a requirement since PROJECT.md doesn't currently specify section order, only that there are 7 sections.
- Within a section, articles mentioning a CVE ID, "actively exploited," "zero-day," or "emergency patch" are what experts' eyes catch fastest. Havadis doesn't need NLP for this — the existing keyword-classification pass already has the signal (many of the same keywords: "0-day," "exploit," "CVE-"). A cheap enhancement (see Differentiators below) is surfacing a **CVE ID as a visible token** on article cards when the title/summary contains one, since experts pattern-match on CVE IDs faster than prose.
- This is a presentation/ordering decision, not a scope addition — it doesn't conflict with the "no LLM categorization" or "no full-text search" out-of-scope items.

## Feature Landscape

### Table Stakes (Users Expect These)

Features a security-expert audience assumes exist. Missing these makes the product feel untrustworthy or unfinished — this audience is unusually sensitive to source credibility and unearned editorializing because their job is literally evaluating source trust.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Clear, per-article source attribution (name + tier) | Security pros weight information by source reputation (a CISA alert and a random blog post are not equal); already in scope | LOW | Already decided (source tier badges). Keep badge visually distinct, not just a small gray label — tier is a trust signal, not decoration. |
| Unaltered, non-editorialized headlines | This audience distrusts aggregators that rewrite headlines for engagement/SEO; a rewritten CVE description reads as unreliable | LOW | Render the source's own title verbatim (light normalization like whitespace/casing only). Do not add "BREAKING:" prefixes or engagement framing. |
| Direct outbound link to the original/primary source, not an aggregator rehost | Experts need to reach the vendor advisory, CISA bulletin, or original researcher post — not a paraphrase — to act (patch, cite, escalate) | LOW | Already in scope ("links to originals"). Critical: link must go to the *original publisher's URL* from the RSS `link` field, never a Havadis-hosted copy of the content. |
| Timestamp showing recency, not just "today" | Freshness is operationally meaningful (a 20-hour-old CVE alert vs. a 20-minute-old one changes urgency) | LOW | Already in scope (relative timestamps). Pair with an absolute timestamp on hover/title-attribute for precision — cheap addition, avoids ambiguity around "2 hours ago" as the cache/lookback window shifts. |
| Fast load, no heavy JS blocking first paint | SOC analysts often check this during an incident, on constrained networks/devices, possibly on a SOC floor monitor; slow = abandoned | LOW-MEDIUM | Already aligned with "fast, mobile-friendly, server-rendered" architecture decision. |
| Mobile-usable layout | On-call/CISO audience frequently checks from a phone, not a desk | LOW | Already in scope. |
| No login wall / fully public | Anti-feature-of-omission: any gate would kill the "share a link in Slack during an incident" use case that is core to how this content actually spreads | LOW | Already in scope (no auth). |
| Category filter usable without full reload | Lets an analyst who only cares about Vulnerabilities/Advisories cut noise quickly | LOW | Already in scope (client-side filter over cached snapshot). |
| Distinguishing vendor/government sources from commentary/blogs at a glance | A CISA alert and a TechCrunch security post carry different evidentiary weight; conflating them erodes trust with this audience specifically (vs. a general reader who wouldn't notice/care) | LOW | This *is* the tier-badge feature already in scope — noting it here because it is genuinely differentiating for this audience vs. general tech news aggregators, even though PROJECT.md already locked it in. |

### Differentiators (Competitive Advantage)

Features that set Havadis apart from generic RSS readers/aggregators, specifically valuable to the security-expert audience. None of these require a database, auth, or paid infra — all operate on the same per-request cached snapshot.

| Feature | Value Proposition | Complexity | Notes |
|---------|--------------------|------------|-------|
| Fixed, curated 13-source list spanning government/research/enterprise/threat-intel/general tiers | Most aggregators are either single-source blogs or noisy full-web scrapes; a curated, tiered, cross-source view is the actual value prop for a busy expert who wants breadth without vetting sources themselves | Already decided | This is the core differentiator per PROJECT.md — worth stating explicitly since it's easy to under-sell in a features doc that focuses on UI details. |
| Keyword-rule taxonomy tuned to security workflows (not generic tech-news categories like "Business"/"Apps") | Table-stakes tech aggregators use categories irrelevant to a SOC/CISO triage flow; Havadis's 7 categories map directly to "what do I do about this" | Already decided | Zero marginal cost — already the classification scheme. |
| Section ordering by operational urgency (Vulnerabilities/Advisories → Ransomware/Breaches → Threat Intel → Tools/Techniques → Industry/Policy) | Matches how experts actually triage (see analysis above); a generic aggregator orders by recency or alphabetically | LOW | New requirement to add explicitly — currently PROJECT.md doesn't specify order, just "7 sections." Zero-cost to implement (render order), high value for credibility with target audience. |
| Visible CVE-ID token/chip on article cards when detected in title/summary | Lets an analyst spot "does this affect a CVE I care about" in under a second, without reading the summary | LOW | Regex extraction (`CVE-\d{4}-\d{4,7}`) over already-fetched title/summary text — no new fetch, no LLM, no DB. Purely a rendering enhancement on existing data. Strong v1.1 candidate if not done in v1. |
| Per-source "last fetched" / feed health transparency | If a source's feed is down or stale, an expert audience wants to know that rather than silently seeing zero articles from CISA and assuming "no advisories today" (which could be operationally dangerous — a false negative reads as "nothing to patch") | LOW-MEDIUM | Doesn't require persistence — can be computed at render time from the current snapshot (e.g., "no articles from CISA in the last 24h" is knowable without storing history). Important integrity feature more than a differentiator — consider promoting to table-stakes if a source going silent is plausible with these 13 feeds. |
| Public RSS/Atom feed of the aggregated-and-classified digest itself | Lets other tools (Slack bots, other dashboards, personal readers) consume Havadis's *value-add* (dedup + classification + tiering), not just the raw sources — turns Havadis into infrastructure other security tooling can build on | LOW-MEDIUM | Fully stateless-compatible: generate the XML from the same cached snapshot already computed for the HTML page, same revalidation window, no DB. Strong v1.1/v2 candidate — flagged explicitly per the question. |
| "Last updated" timestamp for the whole page + per-section article count | Builds trust that the page reflects a real refresh cycle (not a stale/broken cache) and gives a fast "how much is happening today" signal per category | LOW | Trivial to compute from the existing cache metadata and section arrays — no new fetch, no storage. Strong, cheap v1 or v1.1 addition. |
| Direct "copy link" / share affordance per article | This content is heavily shared into Slack/Teams during incidents; frictionless copy-link (vs. relying on browser share) reduces friction for the actual dominant distribution channel of this content | LOW | Client-side only, no state. |

### Anti-Features (Commonly Seen in News/Aggregator Products, Actively Harmful Here)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|----------------|------------------|-------------|
| Infinite scroll / endless feed | "More engagement," standard on consumer news/social apps | Turns a daily-digest tool into a doom-scroll; actively counter to the "newspaper front page, read once, get back to work" value prop for a professional audience; also pushes older-than-lookback-window content that Havadis explicitly doesn't retain (conflicts with 24h lookback + stateless design) | Fixed, bounded front page per section (today's articles only), pagination not needed at this volume (13 sources, 24h window) |
| Autoplay video/audio, animated hero banners | Generic news-site engagement pattern | Actively hostile to a SOC-floor/incident-response usage context (sound during an incident call, motion distracting on a monitor wall); adds JS weight that hurts the "fast" requirement | Static, calm layout; no media autoplay of any kind |
| Ads / sponsored content / affiliate links | Common monetization path for a "free public" site | Erodes the exact credibility this audience is buying into ("is this headline real or sponsored"); also a maintenance/legal surface area not worth it for a stateless free-tier hobby-scale project | None needed — project has no monetization requirement in PROJECT.md; if monetization is ever wanted, a clearly-separated "sponsor" block, never inline with editorial content |
| Paywall / metered access | Common in general news products | Directly contradicts "fully public, no authentication" constraint already locked in PROJECT.md; also this content is aggregated from already-free public RSS feeds, so gating it adds no value and undermines trust | Keep fully open, always |
| Push notifications / browser notification prompts | Common re-engagement pattern for news PWAs | Requires state (subscriptions) which conflicts with the stateless/no-DB constraint; also intrusive for a "check once a day" use pattern | None for v1; if ever wanted, an RSS/Atom output feed (already flagged as a differentiator) lets *users'* own tools notify them, without Havadis holding subscriber state |
| Editorialized/clickbait headline rewriting ("You Won't Believe This CVE") | Engagement optimization pattern from consumer content aggregators | Destroys credibility instantly with a technical audience that reads dozens of headlines a day and treats headline manipulation as a red flag for the whole source | Render source headlines verbatim (already a table-stakes item above) |
| Personalized/algorithmic ranking ("For You" feed) | Common differentiator in consumer content apps | Requires user identity/history (conflicts with stateless, no-accounts constraint); also undermines the "shared front page everyone can point to" value — a SOC team wants to look at the *same* page together, not personalized variants | Uniform ranking (recency + source weight, already decided) visible identically to all visitors |
| Comments section / social features | Common on news sites for engagement | Moderation burden with zero budget/ops capacity for a free stateless project; also off-mission — this is a digest, not a discussion forum | None; if community reaction matters, link out to the source's own comments/discussion where it exists |
| Full historical archive / "browse any past day" | Reasonable-sounding "of course a newspaper has back issues" expectation | Already explicitly out of scope in PROJECT.md — requires persisting snapshots, conflicts with stateless v1 constraint | Already correctly deferred to v2; RSS/Atom output (above) gives *external* tools a way to build their own archive without Havadis needing to store one |
| Full-text/keyword search | Reasonable "let me find that Log4j mention" expectation | Already explicitly out of scope in PROJECT.md for v1; needs an index over content Havadis doesn't currently persist beyond the 15-min/24h window | Category filter (already in scope) covers most of the "narrow down" need for a same-day digest; browser's own Ctrl+F covers literal search within the rendered page at zero cost |

## Feature Dependencies

```
Section ordering by urgency
    └──requires──> Existing 7-category classification (already built/planned)
                       (no new dependency — pure render-order change)

CVE-ID chip on article cards
    └──requires──> Title/summary text already fetched per article
                       (no new dependency — regex over existing data)

RSS/Atom output of the digest
    └──requires──> Same normalized/deduplicated/classified article list already computed for the HTML page
                       (shares the exact same cache/revalidate window — no new fetch, no new data model)

"Last updated" + per-section counts
    └──requires──> Cache metadata (fetch timestamp) + section arrays
                       (already available once classification/sectioning exists — no new dependency)

Feed-health transparency ("no CISA articles in last 24h")
    └──requires──> Per-source article counts within the current snapshot
                       (computed at render time, no persistence needed)

Archive / browse-past-days ──conflicts──> Stateless, no-DB constraint
    (out of scope; would need snapshot persistence — correctly deferred)

Full-text search ──conflicts──> No persisted index, no DB
    (out of scope; category filter is the stateless-compatible substitute)

Personalized ranking ──conflicts──> No accounts, no user state
    (correctly out of scope)
```

### Dependency Notes

- **Section ordering by urgency requires nothing new** — it's a render-order decision over sections that are already being computed. This should be added to PROJECT.md's Active requirements explicitly (currently "grouped into 7 sections" doesn't specify order), since it's the single highest-leverage, zero-cost change suggested by this research.
- **CVE-ID chip enhances the existing article card** without touching the classification pipeline — it's presentation-layer only, making it a very low-risk v1.1 add if descoped from v1.
- **RSS/Atom output and "last updated"/counts all piggyback on the same already-computed snapshot** — none require a new fetch cadence, new storage, or new infrastructure. They are the most "free" of the differentiator items and are good v1.1 candidates precisely because they add zero architectural risk to the stateless v1 design.
- **Archive, full-text search, and personalization all conflict with the stateless/no-DB constraint** — correctly already deferred in PROJECT.md. This research reinforces those decisions rather than challenging them.

## MVP Definition

### Launch With (v1)

Already decided in PROJECT.md and reaffirmed as correct by this research:
- [ ] Source tier badges, verbatim headlines, direct links to originals — non-negotiable for credibility with this audience
- [ ] Relative timestamps (add absolute-time on hover as a near-zero-cost precision improvement)
- [ ] Client-side category filter over cached snapshot
- [ ] 7-section classification

New, low-cost addition this research surfaces as worth pulling into v1 (not currently explicit in PROJECT.md):
- [ ] **Explicit section ordering by operational urgency**: Vulnerabilities + Advisories first, Ransomware + Breaches next, Threat Intelligence next, Tools/Techniques next, Industry/Policy last — zero implementation cost (array order), directly serves how the target audience triages, should be written into requirements rather than left as an accident of taxonomy order.

### Add After Validation (v1.x)

- [ ] CVE-ID chip/token extraction on article cards — trigger: once the base card layout is proven, add regex-based CVE detection as a cheap scan-ability boost
- [ ] "Last updated" timestamp + per-section article counts — trigger: nearly free, can be added the moment the snapshot/cache metadata is accessible to the render layer
- [ ] Public RSS/Atom output of the aggregated digest — trigger: once the HTML front page is stable, expose the same computed snapshot as XML; validates whether other tools/users actually want to consume Havadis as infrastructure
- [ ] Per-source feed-health indicator (e.g., "no new items from CISA in 24h") — trigger: if/when a source outage is observed in practice, to avoid a silent false-negative reading of "nothing to patch today"
- [ ] Copy-link/share affordance per article — trigger: cheap client-side add, no urgency but low cost

### Future Consideration (v2+)

Already correctly deferred in PROJECT.md; this research does not change that assessment:
- [ ] Full keyword/text search — needs a stateless-compatible indexing approach (e.g., precomputed static index in the same cache) before reconsidering
- [ ] Archive/browse past days — needs a persistence decision (conflicts with "essentially stateless" v1 constraint) before reconsidering
- [ ] LLM-based categorization/summarization — reconsider once the rule-based baseline's classification accuracy is observed to be a real pain point in production
- [ ] User accounts/personalization/notifications — only reconsider if there's a clear, validated driver; adding any of these reopens the stateless architecture decision

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Verbatim headlines, direct source links, tier badges | HIGH | LOW (already planned) | P1 |
| Relative + absolute timestamp | MEDIUM | LOW | P1 |
| Section ordering by urgency | HIGH | LOW | P1 |
| Category filter | MEDIUM | LOW (already planned) | P1 |
| "Last updated" + per-section counts | MEDIUM | LOW | P2 |
| CVE-ID chip on cards | MEDIUM-HIGH | LOW | P2 |
| Copy-link/share per article | LOW-MEDIUM | LOW | P2 |
| Public RSS/Atom digest output | MEDIUM | LOW-MEDIUM | P2 |
| Feed-health transparency indicator | MEDIUM | LOW-MEDIUM | P3 |
| Full-text search | MEDIUM | HIGH (needs stateless index design) | P3 (v2) |
| Archive of past days | MEDIUM | HIGH (needs persistence) | P3 (v2) |
| LLM categorization | LOW-MEDIUM (unproven need) | HIGH | P3 (v2) |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible (cheap, no architecture risk)
- P3: Nice to have, future consideration (needs a design/infra decision first)

## Competitor Feature Analysis

| Feature | SANS NewsBites / ISC | Risky Business News / tl;dr sec | The Hacker News / BleepingComputer | Havadis's Approach |
|---------|------------------------|----------------------------------|--------------------------------------|---------------------|
| Curation | Human expert-curated + annotated (editorial commentary per item) | Human-curated, single strong editorial voice, opinionated | Editorial newsroom, original reporting + wire coverage | Rule-based, source-tiered aggregation across 13 feeds — no human-in-the-loop commentary, but broader source spread than a single-voice newsletter |
| Delivery cadence | Email, semiweekly/daily | Email newsletter, 3x/week or weekly | Continuous website posting | Continuously refreshed web page (15-min revalidation), read-anytime "front page" model — closer to a living newspaper than an email digest |
| Categorization | Freeform/topical grouping, editorial judgment | Freeform categorized links (blog posts, tools, talks) | Tag/category taxonomy (ransomware, data breach, vulnerability, etc.) but not urgency-ordered | 7 fixed keyword-classified sections, explicitly ordered by operational urgency (this research's key recommendation) |
| Source transparency | Implicit (SANS is the trusted brand itself) | Implicit (named human editor's reputation is the trust signal) | Byline + source, but aggregator-vs-original-reporting distinction not always visually prominent | Explicit per-article tier badge (government/research/enterprise/threat-intel/general) — more structured trust signal than either model |
| Machine-consumable output | None public (email-based) | RSS exists for some (e.g., Risky Business podcast/blog) but not a structured multi-source digest feed | Standard site RSS per publication (single-source, not aggregated/classified) | Proposed: RSS/Atom of the *classified, deduplicated, multi-source* digest — a genuine gap in the competitive set, since no reviewed competitor publishes a cross-source, pre-classified feed |

## Sources

- [SANS NewsBites](https://www.sans.org/newsletters/newsbites) — format/cadence, MEDIUM confidence (vendor page, cross-checked against general knowledge of the newsletter's long-running structure)
- [Risky Business News "About"](https://riskybiznews.substack.com/about) — cadence/editorial voice, MEDIUM confidence
- [BleepingComputer (Wikipedia)](https://en.wikipedia.org/wiki/Bleeping_Computer) — content categorization history, MEDIUM confidence
- [BleepingComputer Security category page](https://www.bleepingcomputer.com/news/security/) — current category structure, MEDIUM confidence
- General domain knowledge of SOC/CISO/security-engineer daily triage behavior (CVE/exploit/advisory-first scanning, ransomware/breach urgency, policy-last reading pattern) — synthesized from well-established, widely-corroborated security-community practice (SANS ISC diary triage norms, CISA KEV-driven patch prioritization culture, common SOC playbook structure); treat ordering recommendations as MEDIUM confidence directional guidance, not a benchmarked A/B result.
- `/Users/mkh/CyberSecurity/SecurityNews/.planning/PROJECT.md` — project scope, constraints, and already-decided requirements (source of truth for what's already in/out of scope, cross-referenced throughout this document)

---
*Feature research for: security-news aggregation / daily digest for security experts*
*Researched: 2026-09-14*
