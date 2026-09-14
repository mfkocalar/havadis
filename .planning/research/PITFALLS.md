# Pitfalls Research

**Domain:** Serverless RSS/Atom news aggregation (no DB, framework-level cache only) — Havadis
**Researched:** 2026-09-14
**Confidence:** HIGH (Vercel caching/limits behavior verified against current docs; feed-reliability and dedup/classification pitfalls are well-established patterns in this domain — MEDIUM-HIGH; per-source anti-bot behavior for the specific 13 feeds is inferred from the reference repo's documented workarounds plus general knowledge of these publishers, not freshly re-verified per feed — MEDIUM)

## Critical Pitfalls

### Pitfall 1: One misbehaving feed takes down the whole front page

**What goes wrong:**
A single `fetch()` call to one of the 13 sources throws (network error, TLS error, non-2xx status, timeout) or the resulting XML fails to parse, and that unhandled error propagates up through the aggregation logic and crashes the entire server render — visitors see a 500 page instead of 12/13 sections working fine.

**Why it happens:** Naive implementations write `const feeds = await Promise.all(sources.map(fetchFeed))` — `Promise.all` rejects as soon as any one promise rejects, discarding the results of the ones that succeeded. It's the path of least resistance when you're focused on the happy path first.

**How to avoid:**
- Use `Promise.allSettled`, not `Promise.all`, for the 13 parallel fetches.
- Wrap every per-source fetch+parse in its own try/catch that returns a typed result (`{ status: 'ok', articles }` or `{ status: 'error', source, reason }`) — never let a per-source failure become an uncaught exception.
- Render sections from whatever sources succeeded; show a small "N/13 sources unavailable" indicator (or just silently degrade) rather than failing the page.
- Give every per-source fetch an explicit timeout (e.g. `AbortController` at 8-10s) so one slow/hanging origin can't stall the whole aggregation past Vercel's function duration budget.

**Warning signs:** During manual testing, temporarily point one source URL at a 404 or an unreachable host and confirm the page still renders the other 12 sections. If it doesn't, this pitfall is live.

**Phase to address:** Feed ingestion/normalization phase (the phase that writes the per-source fetch layer) — this is a foundational contract, not a later hardening pass.

---

### Pitfall 2: Default/naive `fetch` gets blocked by anti-bot protection on several sources

**What goes wrong:**
Several sources in the fixed 13-feed list sit behind Cloudflare or other bot-mitigation (the reference repo specifically called out needing a browser-like `User-Agent` for feeds such as CISA and Krebs on Security). Vercel serverless functions using Node's default fetch UA (or an empty/generic one) get 403s, CAPTCHA/JS-challenge HTML instead of XML, or silently truncated responses from these sources — and because this is anti-bot behavior rather than a hard outage, it can pass casual local testing (different IP reputation) and only manifest in production on Vercel's IP ranges.

**Why it happens:** Anti-bot systems fingerprint on User-Agent, TLS/HTTP fingerprint, and IP reputation. Vercel's shared serverless IP ranges are more likely to be rate-limited or challenged than a residential/dev IP. Developers test locally, it works, and the failure only appears after deploy.

**How to avoid:**
- Set an explicit, realistic browser-like `User-Agent` header (and `Accept: application/rss+xml, application/xml, text/xml, */*`) on every outbound feed fetch — port this directly from the reference repo's approach rather than re-deriving it.
- Detect "got HTML instead of XML" (e.g. response starts with `<!DOCTYPE html` or content-type is `text/html`) as a distinct per-source failure mode, not a generic parse error — log/flag it differently so it's diagnosable ("blocked" vs "malformed").
- Treat this as a per-source failure (Pitfall 1's contract), not a fatal error — the section simply renders with fewer/no items from that source until the next revalidation.
- Do not try to defeat CAPTCHA/JS challenges (headless browser rendering) — that's disproportionate complexity for a free-tier serverless function with a 10s duration budget. If a source is persistently and fully blocked, treat it as an operational decision to drop/replace that source, not an engineering problem to solve harder.

**Warning signs:** Fetch responses from CISA, Krebs, or similar sources return HTTP 200 but the body isn't valid XML, or returns 403/503 specifically from Vercel-deployed environments while working from a local machine. Sudden, source-specific "0 articles" gaps that correlate with a specific publisher rather than a general outage.

**Phase to address:** Feed ingestion/normalization phase — the fetch layer must set correct headers from day one; add source-specific diagnostics logging early so blocked-vs-broken is distinguishable without re-architecting later.

---

### Pitfall 3: Trusting redirects blindly (SSRF exposure via feed URLs)

**What goes wrong:**
Some feeds 301/302 redirect (CDN migrations, `www` canonicalization, tracking redirects). If the fetch layer follows redirects without validating the target, a compromised or misconfigured upstream (or a MITM/DNS-rebinding scenario) could redirect the server-side fetch to an internal/private address (e.g. `169.254.169.254` cloud metadata, `localhost`, RFC1918 ranges) — turning your feed fetcher into an SSRF vector that leaks Vercel's internal metadata or hits internal services. This is exactly why the reference implementation explicitly validates redirect targets rather than following them unconditionally.

**Why it happens:** HTTP clients follow redirects by default and most "just get the RSS feed" code doesn't think about the fetch as an attacker-adjacent surface, because the URLs are hardcoded/trusted at write time — the risk is that trust at write time doesn't guarantee trust at request time (feed hosting can change, DNS can be repointed, CDNs can be compromised).

**How to avoid:**
- Since the source list is fixed and hardcoded (no user-supplied URLs), the SSRF surface is much smaller than a general-purpose fetcher — but redirects are still resolved at request time, not write time, so validate anyway.
- When following a redirect, check the resolved target's hostname/IP against a denylist of private/reserved ranges (RFC1918, loopback, link-local incl. `169.254.169.254`, and `.internal`/metadata hosts) before following it; refuse and treat as a per-source failure if the target is disallowed.
- Cap redirect depth (e.g. max 3-5 hops) to avoid redirect loops burning function time.
- Prefer allowlisting the expected final host per source (since there are only 13, you know what a legitimate redirect target looks like — e.g. feed migrating within the same domain/CDN) over a purely reactive denylist.

**Warning signs:** Fetch layer follows redirects with no logging of the final resolved URL; no test exists that asserts a redirect to a private IP is rejected. Any code review that shows `fetch(url, { redirect: 'follow' })` (or the equivalent library default) with zero validation of where it landed.

**Phase to address:** Feed ingestion/normalization phase, as a specific security-hardening task within it (not deferred to a later "security phase" — this is core to the fetch contract). Verify with a unit test that simulates a redirect to a private-range host and asserts rejection.

---

### Pitfall 4: Malformed/non-well-formed XML crashes the parser instead of degrading gracefully

**What goes wrong:**
Real-world RSS/Atom feeds are frequently not strictly well-formed XML — unescaped ampersands in titles, invalid UTF-8 byte sequences, missing closing tags, mixed encodings, or namespace quirks. A strict XML parser throws on the first well-formedness violation; if that throw isn't caught per-source, it becomes an unhandled rejection that either kills that source's data or (per Pitfall 1) the whole page.

**Why it happens:** Feed producers use a mix of CMS plugins and hand-rolled generators of varying quality; "valid enough for browsers/feed readers to render" is not the same as "strictly well-formed." Developers often test against 2-3 well-behaved feeds during development and never hit the edge case until a specific source's CMS emits something odd in production.

**How to avoid:**
- Use a forgiving/lenient parser (equivalent to Python `feedparser`'s "bozo" tolerance) rather than a strict XML parser — a JS library with similar tolerant behavior (e.g. one built on `sax`-style recovery, or one that exposes a "partial success with warnings" result) should be selected specifically for this tolerance, not just for RSS/Atom format support.
- Treat parse errors as a per-source failure (same contract as Pitfall 1), and additionally try to salvage partial results — many lenient parsers can still return items already parsed before the point of failure.
- Sanitize/re-encode aggressively before parsing: strip invalid control characters, normalize encoding to UTF-8, and don't assume the declared `<?xml encoding="...">` matches reality.
- Explicitly log which source + which error each time this happens, so recurring "always bozo" sources become visible over time rather than silently degrading.

**Warning signs:** Any parse call not wrapped in try/catch; a "days later" bug report of "section X always looks empty" that traces back to a parser exception rather than genuinely no content. Testing only against a handful of feeds and skipping the ones known for CMS quirks (government sites, older blogging platforms) during development.

**Phase to address:** Feed ingestion/normalization phase. Include at least one deliberately-malformed fixture (unescaped ampersand, invalid byte sequence) in tests for this phase, not just happy-path fixtures.

---

### Pitfall 5: First request after deploy/idle (cold cache) does 13 synchronous fetches and produces a multi-second latency spike

**What goes wrong:**
Next.js's `fetch` + `revalidate` Data Cache has nothing to serve until the first request populates it. That first visitor (after every deploy, and after any period where the cache entry has fully expired with no traffic to trigger stale-while-revalidate) triggers all 13 origin fetches synchronously (or in parallel, still bounded by the slowest one) before the page can render — turning what should be a fast cached read into a "wait for the slowest of 13 external sites" experience. If any one source is slow (Pitfall 1/2 scenarios) or the aggregate work approaches Vercel's function duration limit, that first request can time out or feel broken.

**Why it happens:** This is inherent to relying purely on lazy, request-triggered revalidation with no pre-warming — it's the direct tradeoff of the "no cron, no KV/DB" architecture decision. It's easy to test this only in a warm dev server where the cache is already populated and never notice the cold-start cost until production.

**How to avoid:**
- Fetch all 13 sources in parallel (not sequentially) so cold-start latency is bounded by the slowest single source + parsing overhead, not the sum of all 13.
- Set a firm per-source timeout (Pitfall 1) so one slow source can't single-handedly blow the cold-start budget or the function's hard duration ceiling.
- Treat this as an accepted, documented v1 tradeoff (per PROJECT.md, a Vercel Cron pre-warm is explicitly deferred as an optional v1.1 optimization) — but make sure the loading state / response time for that unlucky first visitor after each deploy is not a blank error page. A lightweight loading UI or a fast-timeout-then-partial-render is preferable to a long hang.
- Consider triggering one self-fetch of the front page immediately after deploy (a simple post-deploy `curl` in CI, not a persistent cron) to pre-warm the cache without adding always-on infrastructure — cheap mitigation that stays within "no cron/KV/DB" if done as a one-shot deploy hook rather than a recurring job.

**Warning signs:** Time-to-first-byte / page load measured immediately after a fresh deploy is dramatically higher than a page load 20 minutes later. Vercel function duration logs show occasional near-timeout invocations correlated with deploy times.

**Phase to address:** Caching/rendering phase — document the tradeoff explicitly in that phase's plan, and decide there whether a post-deploy pre-warm curl is in scope for v1 or explicitly deferred.

---

### Pitfall 6: Assuming the cache is single, global, and consistent — it's actually per-region and independently stale

**What goes wrong:**
Next.js's time-based (`revalidate: 900`) Data Cache entries are maintained independently per compute region (each region caches close to where its function executes). This differs from *on-demand* revalidation (`revalidateTag`/`revalidatePath`), which does propagate a stale-marker to all regions quickly — but Havadis uses only time-based revalidation, not on-demand tags. That means: two visitors hitting different Vercel regions (if the deployment isn't pinned to a single region) can see different cache ages/snapshots at the same wall-clock moment, and each region independently re-runs all 13 fetches on its own 15-minute clock rather than sharing one global "last refreshed" state.

**Why it happens:** Developers often assume "the cache" is one global thing (mental model carried over from a CDN edge cache or a shared Redis/KV), when in fact Vercel's per-function-region Data Cache is deliberately regional for latency reasons. This is invisible in local dev (single process, no regions) and easy to miss without reading the specific caching docs for time-based vs tag-based revalidation.

**How to avoid:**
- Pin the deployment to a single Vercel function region (Project Settings → Function Region) unless there's a specific reason to run multi-region — for a free-tier, single-audience news aggregator, one region removes this inconsistency entirely and is the simplest correct choice.
- If multi-region is ever needed, document that "front page as of X minutes ago" may differ slightly by region, and avoid building any feature that assumes a single canonical "last updated" timestamp shared across all visitors.
- Don't build logic that depends on cross-region consistency (e.g. don't assume a revalidation triggered by one visitor is instantly visible to a visitor in a different region) — since v1 has no on-demand revalidation trigger anyway, this mostly matters for understanding *why* two users might see slightly different content, not for correctness bugs.

**Warning signs:** "Last updated X min ago" (if such a UI element exists) appears to disagree between two simultaneous visitors from different geographies; investigation reveals multi-region function deployment settings.

**Phase to address:** Caching/rendering phase — pin function region as part of the initial Vercel project configuration task, not as a later fix.

---

### Pitfall 7: Naive exact-match `(title, url)` dedup misses same-story-different-wording duplicates — but full fuzzy dedup is premature for v1

**What goes wrong:**
Multiple sources often cover the same underlying story with different headlines ("Microsoft Patches Critical RCE in Exchange" vs "Critical Exchange Vulnerability Fixed by Microsoft") and different canonical URLs. Exact-match `(title, url)` dedup (as ported from the reference repo) will not catch these — the same story will appear twice (or more) on the front page, taking up two slots in a section and looking redundant/unpolished, especially for high-profile CVEs or breaches that get same-day coverage from 3-4 of the 13 sources.

**Why it happens:** Exact-match dedup is cheap, deterministic, and requires no NLP/similarity infrastructure — it's the correct default starting point. The gap only becomes visible/costly once real traffic sees the same story duplicated, which is hard to fully predict at build time.

**How to avoid (and where the line is):**
- **Accept exact-match `(title, url)` dedup as the correct v1 tradeoff.** It is cheap, predictable, has zero false-positive risk (never incorrectly merges two different stories), and matches the reference repo's proven baseline. For a 13-source, keyword-classified aggregator, some visible duplication across sections is a cosmetic issue, not a functional break.
- **The cheap next-step mitigation, if duplication turns out to be visibly bad in practice, is normalization before exact-match — not fuzzy matching:** lowercase, strip punctuation/whitespace differences, strip common boilerplate suffixes (" | TechCrunch", " - Krebs on Security"), and compare that normalized title alongside a normalized URL (strip query params/tracking params, trailing slashes). This catches "same title, different tracking URL" duplicates cheaply and deterministically — a good v1.1 candidate if the exact-match baseline proves too loose after real usage.
- **True fuzzy/near-duplicate matching (Levenshtein/cosine-similarity on titles, or embedding-based similarity) is premature complexity for this MVP.** It introduces tunable thresholds, false-positive risk (wrongly merging two distinct stories that happen to share a common CVE ID or company name), and computational cost inside a free-tier serverless function on every cache refresh. Defer it explicitly to a v2 "quality" pass, and only if user feedback or manual QA shows exact-match duplication is a real, frequent, visible problem — not preemptively.
- Decide and document this threshold explicitly in the plan so "should we add fuzzy dedup" isn't re-litigated mid-build.

**Warning signs:** During manual QA of the rendered front page around a major security event (widely-covered CVE, breach), the same story visibly appears 2-3 times across or within sections.

**Phase to address:** Dedup/classification phase for the v1 exact-match baseline (with URL normalization as a cheap same-phase addition); explicitly flag true fuzzy dedup as an out-of-scope/v2 backlog item in that same phase's plan, not something to build "if there's time."

---

### Pitfall 8: First-match-wins fixed-order keyword classification silently misfiles articles (and this is intentionally acceptable for v1)

**What goes wrong:**
An article that legitimately belongs in, say, VULNERABILITIES (mentions "CVE-2026-XXXX", "0-day") but also happens to mention "GDPR" or "compliance" in a closing paragraph gets misfiled into INDUSTRY_POLICY if that section's keywords are checked first in the fixed match order (per the ported taxonomy, INDUSTRY_POLICY is also the default bucket, making it a magnet for false positives). Similarly, an article about a ransomware attack that also uses the word "advisory" once could be pulled into ADVISORIES over RANSOMWARE, depending on section check order. Regex/keyword matching has no concept of "which topic is the article actually about" — it only detects "does this substring/pattern appear anywhere in the text."

**Why it happens:** Keyword/regex classification is a bag-of-words heuristic with no semantic understanding, and first-match-wins is a cheap, deterministic tie-breaking rule that avoids building a scoring system. This is a known, accepted limitation of rule-based categorization (the project has explicitly deferred LLM-based categorization to v2 for exactly this reason) — the mistake would be *pretending* this heuristic is more accurate than it is, or spending v1 budget trying to perfect it.

**How to avoid / cheapest mitigation:**
- **Accept first-match-wins with a fixed, deliberately-ordered section sequence as the correct v1 heuristic** — this matches the reference repo's proven approach and keeps classification free, instant, and deterministic (a hard project constraint).
- **The cheapest real mitigation is section ordering, not smarter matching:** order the fixed match sequence so the most specific/high-signal sections are checked before the most generic ones, and check the default/catch-all bucket (INDUSTRY_POLICY) last, not first or early. E.g., check VULNERABILITIES and BREACHES and RANSOMWARE (specific, high-signal keyword sets: CVE patterns, "ransomware", "breach") before ADVISORIES and INDUSTRY_POLICY (generic, common words like "alert", "regulation", "compliance" that can appear as incidental mentions in almost any security article). This single ordering decision meaningfully reduces false positives into the catch-all bucket at zero added complexity.
- A second cheap mitigation (optional, still v1-appropriate): weight keyword matches found in the *title* higher than matches only found in the body/summary — a title match is a much stronger signal of "this is what the article is about" than an incidental body mention. This can be as simple as checking the title against each section's patterns first, falling back to the full text only if no section matches on the title alone.
- **Do not build a scoring/multi-label classifier, per-keyword weighting tables, or ML-based classification for v1** — that's the LLM-based categorization upgrade explicitly deferred to v2. Spending v1 time hand-tuning keyword weights chases diminishing returns on a heuristic that's fundamentally accepted as approximate.

**Warning signs:** Manual spot-check of the classified front page during QA shows articles landing in INDUSTRY_POLICY (the default bucket) that are clearly, obviously about a different section's topic to a human reader — if INDUSTRY_POLICY looks like a dumping ground rather than genuinely policy-focused content, section ordering needs adjustment.

**Phase to address:** Dedup/classification phase. Section check order and title-vs-body matching priority should be a deliberate, documented decision made during that phase's plan — not an afterthought discovered during final QA.

---

### Pitfall 9: A structurally-dead or permanently-quiet source silently degrades content quality forever

**What goes wrong:**
Not every failure mode is a crash or a block — some are "the feed is live, well-formed, and returns HTTP 200, but nothing new is ever published to it" or "publishes only rarely." (For example, Threatpost publicly stopped active publishing in September 2022, though its domain and feed infrastructure may still technically respond.) Combined with the project's 24-hour lookback window, such a source contributes zero articles on essentially every refresh — not a bug, but a permanent, silent quality gap that's easy to never notice because nothing errors.

**Why it happens:** Health of a fixed source list is a point-in-time decision (made when the list was compiled from the reference repo) that decays over time as publishers change ownership, cadence, or shut down, with no automated signal distinguishing "legitimately quiet news day" from "this source hasn't published anything of substance in years."

**How to avoid:**
- During the ingestion phase, log a per-source "articles returned in last fetch" count and, if feasible, keep a lightweight rolling health signal (even something as simple as a manually-checked dashboard log, not a persisted DB record) to catch sources that are consistently at/near zero over many refresh cycles.
- Do a one-time manual sanity check of all 13 feeds during initial build (confirm each source has published something within the last 24-48 hours as of testing) rather than assuming the reference repo's source list is still current — publisher landscapes change over years.
- Treat "this source is structurally dead" as an operational/content decision (swap or remove the source) rather than an engineering bug to fix — no code change fixes a publisher that has stopped publishing.

**Warning signs:** One specific source in logs/diagnostics consistently contributes 0 articles across many consecutive 15-minute refresh cycles, days in a row, while other sources contribute normally.

**Phase to address:** Feed ingestion/normalization phase, as a one-time verification checklist item before considering that phase done — not a runtime pitfall to code around, but a build-time fact to confirm.

---

### Pitfall 10: Blowing past Vercel free-tier limits via redundant or over-frequent aggregation work

**What goes wrong:**
The architecture's entire free-tier viability rests on the assumption that the 13-source fetch+parse+classify pipeline runs only once per ~15 minutes *per region*, serving cached results to all other requests in between. Concrete ways this assumption breaks in practice, each of which can quietly multiply real invocations/duration far beyond that assumption:
- Any code path that calls the aggregation function outside of the cached data-fetching flow (e.g. an API route that redoes the fetch rather than reading the same cached `fetch()` calls, or a client-side re-fetch that hits an uncached server function on every filter interaction) turns "once per 15 min" into "once per request."
- Setting `revalidate` too low (e.g. dropping it far below 900s "to feel fresher") directly multiplies both invocation count and outbound bandwidth/CPU time proportionally.
- Preview deployments: every branch/PR preview on Vercel gets its own cache and, if visited, its own independent 13-fetch cycles — a forgotten preview environment getting occasional traffic (bots, uptime checkers) silently adds to the same account-wide free-tier usage pool.
- Multi-region deployment (Pitfall 6) multiplies the number of independent "once per 15 min" cycles by the number of regions serving traffic.
- Each of the 13 outbound fetches themselves is not billed against *your* function duration budget for the remote server, but the *sum* of time your function spends waiting on them all does count against your own function's execution duration and CPU-time budget (10s duration ceiling on Hobby, 4 CPU-hours/month, 360 GB-hours/month) — a pipeline that takes several seconds per cold invocation, invoked more often than assumed, adds up faster than expected. Bandwidth (100 GB/month Fast Data Transfer on Hobby) is consumed by responses served to end users, not by the outbound RSS fetches themselves, but heavier traffic than expected on a "fast, cached" page can still add up if pages/assets are unexpectedly large.
- Free tier is explicitly restricted to personal/non-commercial use; a public app that gets more traffic than anticipated for a public security news reader is worth watching against the monthly invocation/CPU-hour ceiling, since crossing it pauses functionality until the 30-day window resets.

**How to avoid:**
- Make sure every code path that needs the aggregated data reads from the same `fetch()`-cached calls (same URL + same `next.revalidate` value) rather than introducing a second, differently-cached or uncached code path — Next.js dedupes and reuses Data Cache entries per unique fetch signature, so consistency here is what keeps invocation counts low.
- Keep the client-side section filter purely client-side over the already-rendered/cached snapshot (as specified in the requirements) — never let filtering trigger a new server fetch per filter click.
- Pin to a single Vercel function region (also addresses Pitfall 6) so there's exactly one "once per 15 min" cycle, not N regions' worth.
- Treat the 900s revalidate value as a considered tradeoff, not a knob to tune casually toward "fresher" — freshness gains from lowering it are marginal for a "daily paper" product but the invocation/duration cost is linear.
- Periodically clean up/disable unused preview deployments if they're getting incidental traffic.

**Warning signs:** Vercel dashboard usage metrics (Function Invocations, Function Duration/CPU-hours, Fast Data Transfer) climbing faster than page-view/visitor growth would explain; usage alerts/emails from Vercel about approaching plan limits.

**Phase to address:** Caching/rendering phase for the core discipline (single fetch signature, single region, respecting the revalidate value); worth a explicit note in that phase's acceptance criteria ("no code path bypasses the cached fetch") so it's verified rather than assumed.

---

### Pitfall 11: Dense multi-section "newspaper" layout becomes unreadable/unusable on narrow viewports

**What goes wrong:**
A newspaper-style front page with 7 sections is naturally designed as a multi-column, information-dense grid (masthead, lead story, multiple columns of secondary items) — a layout that reads well on desktop but, ported naively to mobile, produces one of the common failure patterns: (a) all 7 sections + all their articles simply stacked in one long vertical scroll with no way to jump to a section or gauge where you are, (b) horizontally-scrolling tables/grids that require sideways scrolling on a phone, (c) text/tap-targets too small because column widths were fixed in px rather than fluid, or (d) a category filter UI (dropdown/tabs for 7 sections) that eats a large fraction of the viewport height or requires horizontal scrolling itself on small screens.

**Why it happens:** "Newspaper" as a visual metaphor is inherently a dense-grid, desktop-native pattern (think physical broadsheet), and it's easy to build the desktop grid first, then treat mobile as an afterthought pass of just collapsing columns to `1fr` — which produces a readable-but-directionless long scroll rather than a genuinely mobile-appropriate hierarchy.

**How to avoid:**
- Design mobile layout as its own hierarchy, not a squeezed desktop grid: a compact section-jump/tab bar (horizontally scrollable if needed, but with clear active-state) at the top, then one section at a time in a single column, each article as a full-width card with a comfortably large tap target (title + source + relative time).
- Use CSS Grid/Flexbox with fluid units (`fr`, `%`, `clamp()` for type sizes) rather than fixed pixel column widths, so text reflows instead of requiring horizontal scroll.
- Keep the client-side section filter's control itself mobile-friendly first (e.g. a horizontally-scrollable pill/tab row or a native `<select>`-style control) rather than porting a desktop dropdown/sidebar pattern that assumes more width.
- Test against real narrow-viewport breakpoints (360-390px, the most common phone widths) early, not just by shrinking a desktop browser window, and check that source-tier badges, timestamps, and section icons don't get truncated or overlap at those widths.
- Prioritize scannability over density on mobile: on a narrow screen, showing fewer items per section with clear typographic hierarchy (title weight/size clearly distinct from source/time metadata) reads better than cramming the same information density as desktop.

**Warning signs:** Manual testing on an actual phone (not just resized desktop browser) shows horizontal scroll appearing anywhere on the page, tap targets that are hard to hit accurately, or a first screenful that shows only masthead/nav with no actual content visible above the fold.

**Phase to address:** UI/front-page rendering phase — build and verify the mobile layout alongside (not after) the desktop layout within the same phase, since retrofitting responsive behavior onto a desktop-first grid is markedly more expensive than designing fluid from the start.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|--------------------|-----------------|------------------|
| Exact-match `(title, url)` dedup, no normalization | Zero implementation cost, zero false-positive risk | Visible duplicate stories across sections for widely-covered events | v1 default; revisit only if manual QA shows frequent visible duplication (add normalization first, fuzzy match only if that's still insufficient) |
| First-match-wins fixed-order keyword classification | Free, instant, deterministic, matches reference repo | Occasional misfiled articles into wrong/default section | v1 default per explicit project decision; mitigate via section ordering, not scoring logic |
| No pre-warm/cron for cache | No always-on infra, stays in free tier | First visitor after each deploy/idle period eats full 13-fetch latency | Acceptable for v1; add a one-shot post-deploy pre-warm curl only if this proves user-visible in practice |
| No per-source health dashboard/persisted history | No DB, no extra infra | A structurally dead source (Pitfall 9) can go unnoticed indefinitely | Acceptable for v1 if a one-time manual health check of all 13 sources is done at build time; revisit only if source list changes |
| Denylist-based (not allowlist-based) redirect validation | Faster to implement than researching every source's legitimate redirect target | Slightly larger residual SSRF surface than a strict per-source allowlist | Acceptable if the denylist correctly blocks all private/reserved IP ranges; upgrade to per-source allowlist if time allows since there are only 13 sources |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|-----------------|--------------------|
| CISA Alerts (government feed) | Assuming a `.gov` XML feed is always well-formed and always reachable with a default UA | Set browser-like `User-Agent`; tolerate bozo XML; treat outages as expected occasionally, not exceptional |
| Krebs on Security / other Cloudflare-fronted blogs | Default Node fetch UA gets 403'd or JS-challenged from Vercel's shared IP ranges even though it works from a dev machine | Explicit browser UA + Accept headers on every request; detect "got HTML not XML" as a distinct failure mode |
| Threatpost | Assuming every source in the fixed list is actively publishing | Verify during build; treat near-zero output as a content/source-list decision, not a bug to fix in code |
| Any source with CDN/domain migration history | Following redirects unconditionally | Validate redirect target against private/reserved IP ranges before following; cap redirect hops |
| Sources with occasionally malformed/non-UTF8 XML (older CMS platforms, syndication proxies) | Using a strict XML parser that throws on first well-formedness violation | Use a lenient/tolerant parser; catch and log per-source, salvage partial results where possible |
| Any of the 13 sources during a real outage | Letting one slow/down origin stall or crash the whole aggregation | Per-source timeout + `Promise.allSettled` + typed per-source result, never a bare `Promise.all` |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| Sequential (not parallel) per-source fetches | Cold-start latency roughly equals the *sum* of all 13 source response times | Fetch all 13 in parallel via `Promise.allSettled` | Breaks immediately at 13 sources — no scale threshold needed, always parallelize |
| No per-source timeout | One hung/slow origin can single-handedly approach or exceed the function's duration ceiling | Explicit `AbortController` timeout (e.g. 8-10s) per source | Breaks the moment any one of the 13 sources has a slow day |
| Revalidate window set too low | Invocation count and outbound bandwidth/CPU scale linearly downward with the window, eating free-tier budget faster than traffic would suggest | Keep the documented 900s (15 min) window; treat lowering it as a deliberate, budgeted tradeoff | Noticeable once real traffic + a lowered window pushes past Hobby's CPU-hour/invocation ceiling within a 30-day window |
| Duplicate/uncached code path re-running the 13-fetch pipeline | Usage metrics grow faster than visitor count would explain | Single shared `fetch()` signature reused everywhere the aggregated data is needed; client-side-only filtering | Breaks as soon as any second entry point (API route, different revalidate value) is added without reusing the same cached fetch |
| Multi-region deployment | Each region independently runs its own 15-min refresh cycle, multiplying total invocation/CPU cost by region count | Pin to a single Vercel function region | Breaks proportionally to number of active regions from day one, not a scale threshold |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Following feed redirects without validating the resolved target | SSRF: server-side fetch could be redirected to internal/private addresses (e.g. cloud metadata endpoint) | Validate resolved redirect host/IP against private/reserved ranges before following; cap redirect depth |
| Rendering feed-supplied titles/summaries as raw HTML | Stored/reflected XSS if any source (or a compromised/spoofed source) includes script-bearing markup in title/description fields | Treat all feed content as untrusted text: strip/escape HTML from titles and summaries before rendering, or sanitize through an allowlist-based HTML sanitizer if any rich formatting is intentionally preserved |
| Not capping response size read from a feed | A malicious or misconfigured origin could return an extremely large response body, consuming function memory/time (a mild DoS vector against your own function budget) | Cap the number of bytes read from each feed response before parsing; abort if exceeded |
| Trusting `Content-Type`/encoding headers blindly for XML parsing | Encoding mismatches can cause mis-parsed or garbled text to reach the rendered page | Normalize to UTF-8 defensively; don't assume declared encoding is accurate |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| Long undifferentiated vertical stack of all 7 sections on mobile | User can't tell where one section ends and another begins, or gauge how much content is below | Sticky/compact section navigation (tabs or jump-links) at the top of the mobile view |
| Fixed-px column widths ported from desktop grid | Horizontal scroll or truncated text on narrow viewports | Fluid Grid/Flexbox with `fr`/`%`/`clamp()` units, designed mobile-first or in parallel with desktop |
| Silent "0 sources failed" vs. actually-degraded page with no indicator | User sees a thinner-than-usual page with no explanation, may assume the whole site is broken rather than one source being briefly down | Optional lightweight "some sources temporarily unavailable" indicator when the success rate for a refresh dips notably (purely cosmetic, no need for detailed diagnostics exposed to end users) |
| Category filter control designed as a desktop dropdown/sidebar first | Hard to use one-handed on a phone, or requires horizontal scroll itself | Design the filter control as a horizontally-scrollable pill/tab row from the start, verified on real narrow-viewport devices |

## "Looks Done But Isn't" Checklist

- [ ] **Per-source fetch error handling:** Often "done" only for the happy path — verify by deliberately breaking one source (bad URL, force a timeout) and confirming the other 12 still render correctly.
- [ ] **Anti-bot header handling:** Often "done" based on local testing only — verify by checking production (Vercel-deployed) logs/responses for the specific sources known to have anti-bot protection (CISA, Krebs, similar), not just localhost.
- [ ] **Redirect/SSRF validation:** Often entirely missing even when redirects "work" — verify with a test that simulates a redirect to a private/reserved IP and asserts it's rejected, not just that normal redirects succeed.
- [ ] **XML parsing tolerance:** Often only tested against 2-3 well-behaved feeds — verify against a deliberately malformed fixture (unescaped ampersand, invalid byte sequence, missing closing tag).
- [ ] **Cold-start / first-request latency:** Often invisible in dev (cache always warm) — verify by measuring actual response time on the first request immediately following a fresh production deploy.
- [ ] **Single-region pinning:** Often left at platform default — verify the Vercel project's Function Region setting is explicitly pinned, not left to auto-select multi-region.
- [ ] **Client-side-only filtering:** Often silently becomes a server round-trip — verify via network tab that clicking a section filter makes zero new server requests.
- [ ] **Mobile layout:** Often verified only via a resized desktop browser window — verify on an actual phone-width device/emulator at common breakpoints (360-390px).
- [ ] **Dedup behavior around real duplicate events:** Often only tested with synthetic/distinct fixture articles — verify manually against a real day where 2+ of the 13 sources covered the same actual story.
- [ ] **Source list liveness:** Often assumed correct because it was ported from a working reference repo — verify each of the 13 feeds has published within the lookback window at least once during build-time QA.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|----------------|------------------|
| Whole-page crash from one bad source (Pitfall 1) | LOW | Swap `Promise.all` for `Promise.allSettled` and add per-source try/catch — small, isolated, low-risk change |
| Anti-bot blocking discovered post-launch (Pitfall 2) | LOW-MEDIUM | Add/adjust User-Agent and Accept headers per source; if a source remains persistently blocked, remove/replace it in the fixed source list (operational, not engineering, fix) |
| SSRF gap discovered post-launch (Pitfall 3) | LOW | Add redirect-target validation as a wrapper around the existing fetch call; no architectural change needed since sources are fixed/hardcoded |
| Malformed XML crashing a source (Pitfall 4) | LOW | Swap in/adjust the lenient parser's error handling; add the offending feed's malformed sample as a regression fixture |
| Cold-start latency worse than expected (Pitfall 5) | LOW-MEDIUM | Add a one-shot post-deploy pre-warm curl in CI; does not require introducing cron/KV infrastructure |
| Multi-region inconsistency discovered (Pitfall 6) | LOW | Change Function Region setting in Vercel project settings; redeploy |
| Visible duplicate stories in production (Pitfall 7) | MEDIUM | Add title/URL normalization (strip tracking params, boilerplate suffixes, punctuation) before the existing exact-match comparison — does not require introducing fuzzy-matching infrastructure |
| Frequent visible misclassification (Pitfall 8) | LOW-MEDIUM | Reorder the fixed section-check sequence (specific sections before generic/default); add title-priority matching if still insufficient |
| A source goes structurally dead post-launch (Pitfall 9) | LOW | Replace the source in the fixed list with a currently-active equivalent from the same tier |
| Free-tier limits approached/exceeded (Pitfall 10) | MEDIUM | Audit for duplicate/uncached fetch code paths first (usually the actual cause); only as a last resort consider raising the revalidate window or reducing source count |
| Mobile layout unusable post-launch (Pitfall 11) | MEDIUM-HIGH | Requires a real layout rework (grid restructuring, section-nav addition) rather than a small patch — cost scales with how desktop-coupled the original CSS structure is |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|----------------|
| Whole-page crash from one bad source | Feed ingestion/normalization phase | Deliberately break one source in a test/staging run; confirm other 12 sections still render |
| Anti-bot blocking on default UA | Feed ingestion/normalization phase | Check production logs for 403/challenge responses from known-protected sources after first live deploy |
| SSRF via unvalidated redirects | Feed ingestion/normalization phase | Unit test: simulated redirect to a private/reserved IP is rejected |
| Malformed XML crashes parser | Feed ingestion/normalization phase | Fixture test with deliberately malformed XML (bad entity, bad byte sequence) parses without throwing |
| Cold-start latency spike | Caching/rendering phase | Measure response time on first request after a fresh deploy; compare to a warm-cache request |
| Per-region cache inconsistency | Caching/rendering phase | Confirm Vercel project Function Region is explicitly pinned to one region |
| Exact-match dedup misses near-duplicates | Dedup/classification phase | Manual QA against a real multi-source-covered event; confirm normalization (if added) collapses tracking-param/boilerplate variants |
| First-match-wins classification false positives | Dedup/classification phase | Manual spot-check that INDUSTRY_POLICY (default bucket) isn't absorbing obviously-misclassified articles; confirm section check order is deliberate |
| Structurally dead source | Feed ingestion/normalization phase | One-time manual liveness check of all 13 feeds during build |
| Free-tier limit creep | Caching/rendering phase | Code review confirms one shared fetch signature, single region, client-side-only filtering; monitor Vercel usage dashboard post-launch |
| Mobile layout unreadable | UI/front-page rendering phase | Manual test on real narrow-viewport device/emulator at 360-390px; confirm no horizontal scroll, adequate tap targets |

## Sources

- Reference implementation context (mfksec/SecureNewspaper) as described in project PROJECT.md — documented prior need for browser-like User-Agent headers, bozo/malformed-XML tolerance, and redirect-target validation for feeds including CISA and Krebs on Security. (HIGH confidence — primary project source)
- Vercel official docs: Functions Limitations (https://vercel.com/docs/functions/limitations), Data Cache for Next.js (https://vercel.com/docs/caching/runtime-cache/data-cache), Incremental Static Regeneration (https://vercel.com/docs/incremental-static-regeneration) — verified current Hobby-tier limits (10s function duration, 1M invocations/month, 100GB Fast Data Transfer/month, 4 CPU-hours + 360 GB-hours/month) and per-region time-based cache behavior vs. globally-propagated on-demand (tag/path) revalidation. (HIGH confidence — official first-party docs, checked 2026-09-14)
- Next.js official docs: Getting Started — Revalidating (https://nextjs.org/docs/app/getting-started/revalidating), Guides — ISR (https://nextjs.org/docs/app/guides/incremental-static-regeneration). (HIGH confidence — official docs)
- Public reporting on Threatpost's 2022 cessation of active publishing under Kaspersky (multiple independent secondary sources, cross-checked) — used as a concrete illustration of the "structurally dead source" pitfall specific to this project's fixed 13-source list. (MEDIUM confidence — secondary/community sources, but consistent across multiple independent reports; worth a fresh manual check at build time regardless since feed status can change again)
- General, well-established engineering practices for feed aggregation (lenient/tolerant XML parsing equivalent to Python `feedparser`'s "bozo" handling, `Promise.allSettled` vs `Promise.all` semantics, SSRF-via-redirect as a known web-security pattern, dedup precision/recall tradeoffs, keyword-classification false-positive/negative tradeoffs) — standard, widely-documented software engineering patterns rather than single-sourced claims. (HIGH confidence — well-established, not project-specific)

---
*Pitfalls research for: serverless RSS aggregation, no-DB caching architecture*
*Researched: 2026-09-14*
