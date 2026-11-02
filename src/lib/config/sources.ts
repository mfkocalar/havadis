import type { SourceConfig } from "../types.ts";

/**
 * The complete, fixed list of 29 ingestion sources (PROJECT.md's table of 13,
 * 14 live-verified additions, and the two English EU CERT feeds from Phase 5,
 * at the end of the array).
 * Phase 1 wired the first entry (Krebs on Security, per CONTEXT.md D-01);
 * Plan 02-01 added the second (CISA Alerts) to prove the multi-source
 * fan-out end to end; Plan 02-02 appended the remaining eleven, completing
 * all six SourceTier values.
 *
 * Every entry carries a required `sourceType`, `lang` and `family`
 * (Phase 5 D-01, D-04, D-11): the type is one of news, research, vendor, cert,
 * government or advisory; `lang` is "en" because only English sources are active; and
 * `family` is a lowercase publisher-organisation slug for Phase 9's
 * corroboration count.
 *
 * Three entries below intentionally use a URL that diverges from
 * PROJECT.md's literal table — see each entry's own comment for why. All
 * other entries use PROJECT.md's URL verbatim.
 *
 * Several sources here legitimately contribute zero articles at any given
 * moment because their newest item is currently outside the lookback window
 * for their source type (RESEARCH.md Pitfall 4) — different publishers post
 * at genuinely different cadences. A quiet source and a broken source look
 * identical by design (CONTEXT.md D-05); do not treat a source with zero
 * contributed articles as evidence of a fetch bug without checking its feed
 * directly.
 */
export const SOURCES: SourceConfig[] = [
  {
    id: "krebs",
    name: "Krebs on Security",
    tier: "Security Research",
    sourceType: "news",
    lang: "en",
    family: "krebs",
    url: "https://krebsonsecurity.com/feed/",
    // Krebs's bare /feed path serves genuinely valid RSS under
    // `text/html; charset=UTF-8` (confirmed live 2026-09-27, and the exact
    // case `fetchSource.ts`'s `allowHtmlContentType` opt-in was built for —
    // see its comment). This entry never set the flag, so Krebs has been
    // silently dropped by the content-type gate since Phase 2; this fixes it.
    allowHtmlContentType: true,
  },
  // CISA's PROJECT.md URL returns 200 (no redirect) at 427,927 bytes, well
  // under the 2MB body cap — wired in as-is. CISA's <pubDate> uses a
  // 2-digit RFC822 year (e.g. "Fri, 18 Sep 26 12:00:00 +0000"); this was
  // live-verified this session to parse correctly to a valid isoDate via
  // the installed rss-parser@3.13.0 for all 30 items, so the known unknown
  // flagged in 01-CONTEXT.md is closed with a no-op — no date-handling
  // code is added for this (RESEARCH.md Pitfall 3).
  {
    id: "cisa",
    name: "CISA Alerts",
    tier: "Government",
    sourceType: "cert",
    lang: "en",
    family: "cisa",
    url: "https://www.cisa.gov/cybersecurity-advisories/all.xml",
    // Live probe 2026-10-24: 5,696,987 bytes (up to 7,597,640 seen in a
    // build) for 30 items, ~185KB each because every item now carries the
    // full advisory text; 22 items inside the 72h window. Over the shared
    // 2MB cap it errored on every crawl and contributed nothing. The smaller
    // CISA feeds do not replace it (alerts.xml: 2 items in 72h). Above 2MB
    // Next cannot cache the body, so it is downloaded on every crawl
    // (~0.25s from a residential link).
    maxBodyBytes: 10 * 1024 * 1024,
  },
  // PROJECT.md's trailing-slash form (`.../feed/`) 301-redirects to this
  // no-trailing-slash URL. Configured post-redirect for the same reason the
  // Krebs comment above gives: Next's Data Cache only stores 200 responses,
  // so the pre-redirect URL would re-incur an uncached redirect hop on every
  // revalidation cycle forever (RESEARCH.md Pitfall 2).
  {
    id: "recorded-future",
    name: "Recorded Future",
    tier: "Security Research",
    sourceType: "vendor",
    lang: "en",
    family: "recorded-future",
    url: "https://www.recordedfuture.com/feed",
  },
  {
    id: "microsoft-security",
    name: "Microsoft Security Blog",
    tier: "Security Research",
    sourceType: "vendor",
    lang: "en",
    family: "microsoft",
    url: "https://www.microsoft.com/en-us/security/blog/feed/",
  },
  // PROJECT.md lists SANS ISC's daily-podcast archive feed
  // (`dailypodcast.xml`), which RESEARCH.md Pitfall 1 measured live at
  // 5,721,795 bytes — roughly 2.7x over fetchSource.ts's MAX_BODY_BYTES.
  // Wired as-is it would resolve to the error variant on every revalidation
  // cycle forever, contributing zero articles and looking identical to a
  // dead source (CONTEXT.md D-05). This rolling feed was verified at
  // 47,453 bytes, text/xml, with valid isoDate items. Do not raise
  // MAX_BODY_BYTES to accommodate the archive feed instead: that value
  // tracks Vercel's documented Data Cache per-entry item limit, so raising
  // it would move the failure from a clean per-source error to an
  // uncacheable fetch.
  {
    id: "sans-isc",
    name: "SANS ISC",
    tier: "Enterprise Security",
    sourceType: "research",
    lang: "en",
    family: "sans",
    url: "https://isc.sans.edu/rssfeed_full.xml",
  },
  {
    id: "dark-reading",
    name: "Dark Reading",
    tier: "Enterprise Security",
    sourceType: "news",
    lang: "en",
    family: "dark-reading",
    url: "https://www.darkreading.com/rss.xml",
  },
  // PROJECT.md's URL redirects twice (trailing slash dropped, then a
  // locale prefix added) before reaching 200. Configured at the final hop,
  // for the same pre-redirect-URL reason as Krebs and Recorded Future above.
  {
    id: "crowdstrike",
    name: "CrowdStrike Blog",
    tier: "Enterprise Security",
    sourceType: "vendor",
    lang: "en",
    family: "crowdstrike",
    url: "https://www.crowdstrike.com/en-us/blog/feed",
  },
  {
    id: "bleeping-computer",
    name: "Bleeping Computer",
    tier: "Threat Intelligence",
    sourceType: "news",
    lang: "en",
    family: "bleeping-computer",
    url: "https://www.bleepingcomputer.com/feed/",
  },
  {
    id: "hacker-news",
    name: "The Hacker News",
    tier: "Threat Intelligence",
    sourceType: "news",
    lang: "en",
    family: "hacker-news",
    url: "https://feeds.feedburner.com/TheHackersNews",
  },
  {
    id: "help-net-security",
    name: "Help Net Security",
    tier: "Threat Intelligence",
    sourceType: "news",
    lang: "en",
    family: "help-net-security",
    url: "https://www.helpnetsecurity.com/feed/",
  },
  {
    id: "techcrunch-security",
    name: "TechCrunch Security",
    tier: "Tech & General",
    sourceType: "news",
    lang: "en",
    family: "techcrunch",
    url: "https://techcrunch.com/category/security/feed/",
  },
  {
    id: "cso-online",
    name: "CSO Online",
    tier: "Executive News",
    sourceType: "news",
    lang: "en",
    family: "cso-online",
    url: "https://www.csoonline.com/feed/",
  },
  // Sources 14-27 were added 2026-10-02 after a live probe of a candidate
  // list (HavadisBot UA, 8s budget, 2MB cap): each returned 200 with valid
  // XML and published within the prior 24h. URLs are configured at the
  // final redirect hop (Pitfall 2 above); Schneier's legacy `atom.xml`
  // redirects to `/feed/atom/`, and Graham Cluley, Hackread and
  // databreaches.net drop their `www.` prefix.
  { id: "hackread", name: "Hackread", tier: "Threat Intelligence", sourceType: "news", lang: "en", family: "hackread", url: "https://hackread.com/feed/" },
  { id: "databreaches", name: "DataBreaches.net", tier: "Threat Intelligence", sourceType: "news", lang: "en", family: "databreaches", url: "https://databreaches.net/feed/" },
  { id: "cis-advisories", name: "CIS Advisories", tier: "Government", sourceType: "cert", lang: "en", family: "cis", url: "https://www.cisecurity.org/feed/advisories" },
  { id: "cert-cc", name: "CERT/CC Vulnerability Notes", tier: "Government", sourceType: "cert", lang: "en", family: "cert-cc", url: "https://www.kb.cert.org/vulfeed/" },
  { id: "graham-cluley", name: "Graham Cluley", tier: "Security Research", sourceType: "research", lang: "en", family: "graham-cluley", url: "https://grahamcluley.com/feed/" },
  { id: "schneier", name: "Schneier on Security", tier: "Security Research", sourceType: "research", lang: "en", family: "schneier", url: "https://www.schneier.com/feed/atom/" },
  { id: "reversinglabs", name: "ReversingLabs", tier: "Security Research", sourceType: "vendor", lang: "en", family: "reversinglabs", url: "https://www.reversinglabs.com/blog/rss.xml" },
  { id: "computer-weekly", name: "Computer Weekly Security", tier: "Executive News", sourceType: "news", lang: "en", family: "computer-weekly", url: "https://www.computerweekly.com/rss/IT-security.xml" },
  // CERT-EU Security Advisories, probed 2026-10-04 from a laptop: 200,
  // text/xml; charset=utf-8, 9,372 bytes, 10 items. The <pubDate> values use
  // CEST/CET zone abbreviations, so rss-parser yields no isoDate for any item
  // (fixed by Plan 05-04's date fallback); links carry leading and trailing
  // newlines; ttl 1440; roughly one advisory every 5 to 17 days. The CERT-EU
  // Threat Intelligence (monthly Cyber Brief) feed is deliberately not
  // configured (D-09). Local-egress probe through fetchSource (2026-10-04): ok,
  // rawItems 10, datedItems 10, normalizedItems 10, newestAgeHours 165.8,
  // inWindow 0. Vercel-preview egress probe: 2026-10-04: httpStatus 200,
  // text/xml; charset=utf-8, 9,372 bytes, rawItems 10, datedItems 10,
  // newestAgeHours 165.8, inWindow 0. Front-page presence depends on an advisory
  // newer than 72h.
  {
    id: "cert-eu",
    name: "CERT-EU Security Advisories",
    tier: "Government",
    sourceType: "cert",
    lang: "en",
    family: "cert-eu",
    url: "https://www.cert.europa.eu/publications/security-advisories-rss",
  },
  // NCSC-UK, probed 2026-10-04 from a laptop: 200, application/rss+xml;
  // charset=utf-8, 11,631 bytes, 20 items, all with isoDate, fixed 12:00 UTC
  // timestamps, roughly one item a week. Local-egress probe through fetchSource
  // (2026-10-04): ok, rawItems 20, datedItems 20, normalizedItems 20,
  // newestAgeHours 147.5, inWindow 0. Vercel-preview egress probe: 2026-10-04:
  // httpStatus 200, application/rss+xml; charset=utf-8, 11,631 bytes, rawItems
  // 20, datedItems 20, newestAgeHours 147.5, inWindow 0. Front-page presence
  // depends on an advisory newer than 72h.
  {
    id: "ncsc-uk",
    name: "NCSC-UK",
    tier: "Government",
    sourceType: "cert",
    lang: "en",
    family: "ncsc-uk",
    url: "https://www.ncsc.gov.uk/api/1/services/v1/all-rss-feed.xml",
  },
  // Palo Alto Security Advisories (Phase 7.1 SRC-06), probed 2026-10-31 from a
  // laptop: 200, application/xml, 8,373 bytes, 25 items, newestAgeHours 18.9,
  // inWindow 2. maxItems 5 (D-13): the feed posts in batches, 8 advisories on
  // 2026-10-14 (one identical timestamp) plus 5 on 2026-10-15, so 14 fall in
  // the busiest 72 hours; the cap keeps the newest 5.
  // Laptop probe through the probe harness 2026-11-02: httpStatus 200, application/xml; charset=utf-8, 8,381 bytes, rawItems 25, datedItems 25, normalizedItems 25, newestAgeHours 55.9, inWindow 1, maxPerWindow 14.
  // Netlify-egress probe: pending (Plan 07.1-07)
  {
    id: "paloalto-psirt",
    name: "Palo Alto Security Advisories",
    tier: "Enterprise Security",
    sourceType: "advisory",
    lang: "en",
    family: "palo-alto",
    url: "https://security.paloaltonetworks.com/rss.xml",
    maxItems: 5,
  },
  // Cisco Security Advisories (Phase 7.1 SRC-06), probed 2026-10-31 from a
  // laptop: 200, application/xml, 148,629 bytes, 50 items, newestAgeHours 25.3,
  // inWindow 4. maxItems 5 (D-13): 12 advisories on 2026-10-07, 14 in the
  // busiest 72 hours; the cap keeps the newest 5. Family cisco (D-04); Talos
  // joins it in Plan 07.1-03.
  // Laptop probe through the probe harness 2026-11-02: httpStatus 200, application/xml;charset=utf-8, 148,629 bytes, rawItems 50, datedItems 50, normalizedItems 50, newestAgeHours 62.3, inWindow 3, maxPerWindow 14.
  // Netlify-egress probe: pending (Plan 07.1-07)
  {
    id: "cisco-psirt",
    name: "Cisco Security Advisories",
    tier: "Enterprise Security",
    sourceType: "advisory",
    lang: "en",
    family: "cisco",
    url: "https://sec.cloudapps.cisco.com/security/center/psirtrss20/CiscoSecurityAdvisory.xml",
    maxItems: 5,
  },
  // Fortinet PSIRT (Phase 7.1 SRC-06). The www.fortiguard.com/rss/ir.xml form
  // redirects across hosts to Fortinet's own filestore.fortinet.com, so the final
  // hop is configured (D-09, D-18). Probed 2026-10-31 from a laptop: 200,
  // text/xml, 47,487 bytes, 50 items, newestAgeHours 135.2, inWindow 0.
  // maxItems 5 (D-13): 10 advisories on 2026-10-13 with an identical 07:00
  // timestamp, 11 in the busiest 72 hours.
  // Laptop probe through the probe harness 2026-11-02: httpStatus 200, text/xml, 47,487 bytes, rawItems 50, datedItems 50, normalizedItems 50, newestAgeHours 172.2, inWindow 0, maxPerWindow 11.
  // Netlify-egress probe: pending (Plan 07.1-07)
  {
    id: "fortinet-psirt",
    name: "Fortinet Security Advisories",
    tier: "Enterprise Security",
    sourceType: "advisory",
    lang: "en",
    family: "fortinet",
    url: "https://filestore.fortinet.com/fortiguard/rss/ir.xml",
    maxItems: 5,
  },
  // Ivanti security advisories (Phase 7.1 SRC-06), probed 2026-10-31 from a
  // laptop: 200, text/xml, 65,596 bytes, 19 items, newestAgeHours 439.6,
  // inWindow 0. The feed is Ivanti's security-advisory blog topic; each item is
  // the monthly security-update announcement, one per release (D-11). Marked
  // advisory by user confirmation (A-UI-2). No cap: one item per month.
  // Laptop probe through the probe harness 2026-11-02: httpStatus 200, text/xml; charset=utf-8, 65,596 bytes, rawItems 19, datedItems 19, normalizedItems 19, newestAgeHours 476.7, inWindow 0, maxPerWindow 1.
  // Netlify-egress probe: pending (Plan 07.1-07)
  {
    id: "ivanti-security",
    name: "Ivanti Security Advisories",
    tier: "Enterprise Security",
    sourceType: "advisory",
    lang: "en",
    family: "ivanti",
    url: "https://www.ivanti.com/blog/topics/security-advisory/rss",
  },
  // Chrome Releases (Phase 7.1 SRC-06). This Blogger label-intersection feed
  // returns only "Stable Channel Update for Desktop" posts (D-14 first
  // preference: no title pattern needed). The default posts feed redirects to
  // plain-http FeedBurner, which the validated redirect rejects, and
  // max-results=5 keeps the body near 0.6 MB at about 120 KB per item. Probed
  // 2026-10-31 from a laptop: 200, application/atom+xml, 5 items, newestAgeHours
  // 48.8, inWindow 1.
  // D-14 (D-26 deviation): body-based test, 19 of 20 sampled posts list security fixes (2026-11-02); titles carry no security keyword, so the card's section comes from the summary (a Phase 9 note, recorded in 07.1-PROBES.md)
  // Laptop probe through the probe harness 2026-11-02: httpStatus 200, application/atom+xml; charset=UTF-8, 657,648 bytes, rawItems 5, datedItems 5, normalizedItems 5, newestAgeHours 85.8, inWindow 0, maxPerWindow 2.
  // Netlify-egress probe: pending (Plan 07.1-07)
  {
    id: "chrome-releases",
    name: "Chrome Releases",
    tier: "Enterprise Security",
    sourceType: "advisory",
    lang: "en",
    family: "google",
    url: "https://chromereleases.googleblog.com/feeds/posts/default/-/Stable%20updates/Desktop%20Update?max-results=5",
  },
  // CCCS Alerts and Advisories (Phase 7.1 SRC-07). The rss/v1 URL redirects on
  // the same host to this Atom URL, so the final hop is configured. Probed
  // 2026-10-31 from a laptop: 200, application/xml, 153,469 bytes, 50 items,
  // newestAgeHours 24.6, inWindow 9. maxItems 5 (D-13): roundup notices issued
  // per vendor, 14 on 2026-10-28 and 27 in the busiest 72 hours.
  // Laptop probe through the probe harness 2026-11-02: httpStatus 200, application/xml, 153,469 bytes, rawItems 50, datedItems 50, normalizedItems 50, newestAgeHours 61.6, inWindow 5, maxPerWindow 27.
  // Netlify-egress probe: pending (Plan 07.1-07)
  {
    id: "cccs",
    name: "CCCS Alerts and Advisories",
    tier: "Government",
    sourceType: "cert",
    lang: "en",
    family: "cccs",
    url: "https://www.cyber.gc.ca/api/cccs/atom/v1/get?feed=alerts_advisories&lang=en",
    maxItems: 5,
  },
  // JPCERT/CC English (Phase 7.1 SRC-07), probed 2026-10-31 from a laptop: 200,
  // application/rdf+xml, 3,205 bytes, 6 items, newestAgeHours 427.8, inWindow 0.
  // RSS 1.0 (RDF), which the content-type gate accepts because the type
  // contains xml. No cap: a handful of items a month.
  // Laptop probe through the probe harness 2026-11-02: httpStatus 200, application/rdf+xml, 3,205 bytes, rawItems 6, datedItems 6, normalizedItems 6, newestAgeHours 464.8, inWindow 0, maxPerWindow 2.
  // Netlify-egress probe: pending (Plan 07.1-07)
  {
    id: "jpcert-en",
    name: "JPCERT/CC",
    tier: "Government",
    sourceType: "cert",
    lang: "en",
    family: "jpcert",
    url: "https://www.jpcert.or.jp/english/rss/jpcert-en.rdf",
  },
  // Unit 42 (Phase 7.1 SRC-07), Palo Alto Networks' threat-research lab, so
  // vendor type (D-06) and family palo-alto, shared with paloalto-psirt (D-04).
  // Probed 2026-10-31 from a laptop: 200, 24,210 bytes, 15 items,
  // newestAgeHours 52.2, inWindow 1.
  // Laptop probe through the probe harness 2026-11-02: httpStatus 200, application/rss+xml; charset=UTF-8, 24,210 bytes, rawItems 15, datedItems 15, normalizedItems 15, newestAgeHours 89.3, inWindow 0, maxPerWindow 4.
  // Netlify-egress probe: pending (Plan 07.1-07)
  {
    id: "unit42",
    name: "Unit 42",
    tier: "Threat Intelligence",
    sourceType: "vendor",
    lang: "en",
    family: "palo-alto",
    url: "https://unit42.paloaltonetworks.com/feed/",
  },
];

// Removed (Phase 7.1 D-23, user decision 2026-11-02; the evidence is the decision plus these measurements, with no item audit):
//   - ars-technica (Ars Technica): an all-content technology feed with low security signal (the "brain worm" classifier fix in sections.ts is one symptom); its security-category feed is not added either.
//   - heimdal (Heimdal Security): a preliminary hand classification put about 1 in 15 items on-topic; the rest were listicles, awards, partnerships and essays.
//   - gbhackers (GBHackers): floods with about 10 or more rewrites per day, and served text/html to cloud egress in Phase 5 research.
//   - upguard-breaches (UpGuard Breaches): a company marketing blog.
//   - bishop-fox (Bishop Fox): a company marketing blog.
//   - eff (EFF Updates): policy, not security news.
//   - nist-cybersecurity (NIST Cybersecurity Insights): policy, not security news; it was the only government-type source, so that type is unused for now (UNUSED_SOURCE_TYPES in sources.test.ts).
// hackread was flagged borderline and is kept for now.
//
// Not configured (Phase 7.1, SRC-06 and SRC-07; D-08 to D-10, D-22): never scraped.
// Reason codes: no feed, non-English only, JSON/CSAF/HTML only, mixed feed with no usable filter, probe failure from Netlify, volume.
//   - MSRC (api.msrc.microsoft.com update-guide RSS): volume. Per-CVE only, 3,014,250 bytes against the 2 MB cap, 1,411 items on Patch Tuesday 2026-10-13, no per-release feed (D-11; user decision in Plan 07.1-01).
//   - Citrix/NetScaler (support.citrix.com security-bulletin feed paths): no feed. Every path serves the same HTML app shell.
//   - Broadcom/VMware (support.broadcom.com security-advisory RSS, 404): JSON/CSAF/HTML only. A JSON feed exists; JSON readers are a deferred idea.
//   - Android Security Bulletin (source.android.com bulletin feed paths, 404): no feed. None found; the bulletin is HTML only.
// Rejected URLs (vendor configured through another feed, not gaps):
//   - Mandiant blog RSS: a cross-host redirect to an HTML page; Google Threat Intelligence covers Mandiant (Plan 07.1-03).
//   - Proofpoint /us/rss.xml: press releases; the Threat Insight feed covers Proofpoint (Plan 07.1-03).
//   - Chrome Releases default posts feed: redirects to plain-http FeedBurner; the label feed covers Chrome (Task 3).
