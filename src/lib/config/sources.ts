import type { SourceConfig } from "../types.ts";

/**
 * The complete, fixed list of 27 ingestion sources (PROJECT.md's table of 13,
 * plus 14 live-verified additions at the end of the array).
 * Phase 1 wired the first entry (Krebs on Security, per CONTEXT.md D-01);
 * Plan 02-01 added the second (CISA Alerts) to prove the multi-source
 * fan-out end to end; this array (Plan 02-02) appends the remaining eleven,
 * completing all six SourceTier values.
 *
 * Three entries below intentionally use a URL that diverges from
 * PROJECT.md's literal table — see each entry's own comment for why. All
 * other entries use PROJECT.md's URL verbatim.
 *
 * Several sources here legitimately contribute zero articles at any given
 * moment because their newest item is currently outside the 24h lookback
 * window (RESEARCH.md Pitfall 4) — different publishers post at genuinely
 * different cadences. A quiet source and a broken source look identical by
 * design (CONTEXT.md D-05); do not treat a source with zero contributed
 * articles as evidence of a fetch bug without checking its feed directly.
 */
export const SOURCES: SourceConfig[] = [
  {
    id: "krebs",
    name: "Krebs on Security",
    tier: "Security Research",
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
    url: "https://www.recordedfuture.com/feed",
  },
  {
    id: "microsoft-security",
    name: "Microsoft Security Blog",
    tier: "Security Research",
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
    url: "https://isc.sans.edu/rssfeed_full.xml",
  },
  {
    id: "dark-reading",
    name: "Dark Reading",
    tier: "Enterprise Security",
    url: "https://www.darkreading.com/rss.xml",
  },
  // PROJECT.md's URL redirects twice (trailing slash dropped, then a
  // locale prefix added) before reaching 200. Configured at the final hop,
  // for the same pre-redirect-URL reason as Krebs and Recorded Future above.
  {
    id: "crowdstrike",
    name: "CrowdStrike Blog",
    tier: "Enterprise Security",
    url: "https://www.crowdstrike.com/en-us/blog/feed",
  },
  {
    id: "bleeping-computer",
    name: "Bleeping Computer",
    tier: "Threat Intelligence",
    url: "https://www.bleepingcomputer.com/feed/",
  },
  {
    id: "hacker-news",
    name: "The Hacker News",
    tier: "Threat Intelligence",
    url: "https://feeds.feedburner.com/TheHackersNews",
  },
  {
    id: "help-net-security",
    name: "Help Net Security",
    tier: "Threat Intelligence",
    url: "https://www.helpnetsecurity.com/feed/",
  },
  {
    id: "techcrunch-security",
    name: "TechCrunch Security",
    tier: "Tech & General",
    url: "https://techcrunch.com/category/security/feed/",
  },
  {
    id: "ars-technica",
    name: "Ars Technica",
    tier: "Tech & General",
    url: "https://feeds.arstechnica.com/arstechnica/index",
  },
  {
    id: "cso-online",
    name: "CSO Online",
    tier: "Executive News",
    url: "https://www.csoonline.com/feed/",
  },
  // Sources 14-27 were added 2026-10-02 after a live probe of a candidate
  // list (HavadisBot UA, 8s budget, 2MB cap): each returned 200 with valid
  // XML and published within the prior 24h. URLs are configured at the
  // final redirect hop (Pitfall 2 above); Schneier's legacy `atom.xml`
  // redirects to `/feed/atom/`, and Graham Cluley, Hackread and
  // databreaches.net drop their `www.` prefix.
  { id: "gbhackers", name: "GBHackers", tier: "Threat Intelligence", url: "https://gbhackers.com/feed/" },
  { id: "hackread", name: "Hackread", tier: "Threat Intelligence", url: "https://hackread.com/feed/" },
  { id: "databreaches", name: "DataBreaches.net", tier: "Threat Intelligence", url: "https://databreaches.net/feed/" },
  { id: "upguard-breaches", name: "UpGuard Breaches", tier: "Threat Intelligence", url: "https://www.upguard.com/breaches/rss.xml" },
  { id: "cis-advisories", name: "CIS Advisories", tier: "Government", url: "https://www.cisecurity.org/feed/advisories" },
  { id: "cert-cc", name: "CERT/CC Vulnerability Notes", tier: "Government", url: "https://www.kb.cert.org/vulfeed/" },
  { id: "nist-cybersecurity", name: "NIST Cybersecurity Insights", tier: "Government", url: "https://www.nist.gov/blogs/cybersecurity-insights/rss.xml" },
  { id: "graham-cluley", name: "Graham Cluley", tier: "Security Research", url: "https://grahamcluley.com/feed/" },
  { id: "schneier", name: "Schneier on Security", tier: "Security Research", url: "https://www.schneier.com/feed/atom/" },
  { id: "bishop-fox", name: "Bishop Fox", tier: "Security Research", url: "https://bishopfox.com/feeds/blog.rss" },
  { id: "reversinglabs", name: "ReversingLabs", tier: "Security Research", url: "https://www.reversinglabs.com/blog/rss.xml" },
  { id: "heimdal", name: "Heimdal Security", tier: "Enterprise Security", url: "https://heimdalsecurity.com/blog/feed/" },
  { id: "eff", name: "EFF Updates", tier: "Tech & General", url: "https://www.eff.org/rss/updates.xml" },
  { id: "computer-weekly", name: "Computer Weekly Security", tier: "Executive News", url: "https://www.computerweekly.com/rss/IT-security.xml" },
];
