import type { SourceConfig } from "../types.ts";

/**
 * The complete, fixed list of 13 ingestion sources (PROJECT.md's table).
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
];
