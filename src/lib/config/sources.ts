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
 * (Phase 5 D-01, D-04, D-11): the type is one of news, research, vendor, cert
 * or government; `lang` is "en" because only English sources are active; and
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
    id: "ars-technica",
    name: "Ars Technica",
    tier: "Tech & General",
    sourceType: "news",
    lang: "en",
    family: "ars-technica",
    url: "https://feeds.arstechnica.com/arstechnica/index",
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
  { id: "gbhackers", name: "GBHackers", tier: "Threat Intelligence", sourceType: "news", lang: "en", family: "gbhackers", url: "https://gbhackers.com/feed/" },
  { id: "hackread", name: "Hackread", tier: "Threat Intelligence", sourceType: "news", lang: "en", family: "hackread", url: "https://hackread.com/feed/" },
  { id: "databreaches", name: "DataBreaches.net", tier: "Threat Intelligence", sourceType: "news", lang: "en", family: "databreaches", url: "https://databreaches.net/feed/" },
  { id: "upguard-breaches", name: "UpGuard Breaches", tier: "Threat Intelligence", sourceType: "vendor", lang: "en", family: "upguard", url: "https://www.upguard.com/breaches/rss.xml" },
  { id: "cis-advisories", name: "CIS Advisories", tier: "Government", sourceType: "cert", lang: "en", family: "cis", url: "https://www.cisecurity.org/feed/advisories" },
  { id: "cert-cc", name: "CERT/CC Vulnerability Notes", tier: "Government", sourceType: "cert", lang: "en", family: "cert-cc", url: "https://www.kb.cert.org/vulfeed/" },
  { id: "nist-cybersecurity", name: "NIST Cybersecurity Insights", tier: "Government", sourceType: "government", lang: "en", family: "nist", url: "https://www.nist.gov/blogs/cybersecurity-insights/rss.xml" },
  { id: "graham-cluley", name: "Graham Cluley", tier: "Security Research", sourceType: "research", lang: "en", family: "graham-cluley", url: "https://grahamcluley.com/feed/" },
  { id: "schneier", name: "Schneier on Security", tier: "Security Research", sourceType: "research", lang: "en", family: "schneier", url: "https://www.schneier.com/feed/atom/" },
  { id: "bishop-fox", name: "Bishop Fox", tier: "Security Research", sourceType: "vendor", lang: "en", family: "bishop-fox", url: "https://bishopfox.com/feeds/blog.rss" },
  { id: "reversinglabs", name: "ReversingLabs", tier: "Security Research", sourceType: "vendor", lang: "en", family: "reversinglabs", url: "https://www.reversinglabs.com/blog/rss.xml" },
  { id: "heimdal", name: "Heimdal Security", tier: "Enterprise Security", sourceType: "vendor", lang: "en", family: "heimdal", url: "https://heimdalsecurity.com/blog/feed/" },
  { id: "eff", name: "EFF Updates", tier: "Tech & General", sourceType: "news", lang: "en", family: "eff", url: "https://www.eff.org/rss/updates.xml" },
  { id: "computer-weekly", name: "Computer Weekly Security", tier: "Executive News", sourceType: "news", lang: "en", family: "computer-weekly", url: "https://www.computerweekly.com/rss/IT-security.xml" },
  // CERT-EU Security Advisories, probed 2026-10-04 from a laptop: 200,
  // text/xml; charset=utf-8, 9,372 bytes, 10 items. The <pubDate> values use
  // CEST/CET zone abbreviations, so rss-parser yields no isoDate for any item
  // (fixed by Plan 05-04's date fallback); links carry leading and trailing
  // newlines; ttl 1440; roughly one advisory every 5 to 17 days. The CERT-EU
  // Threat Intelligence (monthly Cyber Brief) feed is deliberately not
  // configured (D-09). Vercel-preview egress probe: pending (Plan 05-05).
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
  // timestamps, roughly one item a week. Vercel-preview egress probe: pending
  // (Plan 05-05).
  {
    id: "ncsc-uk",
    name: "NCSC-UK",
    tier: "Government",
    sourceType: "cert",
    lang: "en",
    family: "ncsc-uk",
    url: "https://www.ncsc.gov.uk/api/1/services/v1/all-rss-feed.xml",
  },
];
