import type { SourceConfig } from "../types.ts";

/**
 * The fixed list of ingestion sources. Phase 1 wired the first entry
 * (Krebs on Security, per CONTEXT.md D-01). Phase 2 widens this array
 * toward the full 13-source PROJECT.md table; Plan 02-01 adds the second
 * entry (CISA Alerts) to prove the multi-source fan-out end to end before
 * Plan 02-02 appends the remaining ten.
 *
 * The Krebs URL below is the canonical, post-redirect form
 * (`https://krebsonsecurity.com/feed/`, trailing slash) rather than the
 * bare `/feed` path that appears in PROJECT.md/CONTEXT.md. The bare path
 * 301-redirects to this trailing-slash URL, and because Next.js's Data
 * Cache only stores 200 responses, configuring the pre-redirect URL would
 * re-incur that redirect hop on every revalidation cycle forever
 * (RESEARCH.md Pitfall P1-2).
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
];
