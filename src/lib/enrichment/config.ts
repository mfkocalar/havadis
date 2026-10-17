/**
 * Enrichment tunables, in one place (Phase 7). Starting values are sized
 * against the live CISA KEV feed on 2026-10-09: 1,739 entries, 1,777,558 raw
 * bytes, about 102 KB once slimmed to added, due and ransomware (RESEARCH
 * Pattern 1). No file here reads the clock.
 */

/** CISA's official KEV JSON feed (CC0). */
export const KEV_URL =
  "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";

/** KEV map cache window in seconds (D-12): 6 hours, the catalog changes a few times a week. */
export const KEV_REVALIDATE_SECONDS = 21_600;

/** A KEV map older than this many hours is `stale` (still used, never dropped; D-10). */
export const KEV_MAX_AGE_HOURS = 72;

/** Fewer valid entries than this means the feed collapsed or drifted (today 1,739). */
export const KEV_MIN_ENTRIES = 1500;

/** Raw feed byte cap: 4 MiB, about 2.2x today's 1,777,558 bytes. */
export const KEV_MAX_RAW_BYTES = 4 * 1024 * 1024;

/** Slim map byte cap: 256 KiB, about 2.5x today's roughly 102 KB. */
export const KEV_MAX_SLIM_BYTES = 256 * 1024;

/** More skipped (invalid) entries than this share of the array means schema drift. */
export const KEV_MAX_SKIPPED_RATIO = 0.01;

/** The oldest KEV `dateAdded` in the live data; anything earlier is rejected. */
export const KEV_EARLIEST_DATE_ADDED = "2021-11-03";

/** KEV fetch budget in milliseconds, spanning connect, redirects and the body read. */
export const KEV_TIMEOUT_MS = 10_000;
