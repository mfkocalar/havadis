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

/** FIRST's EPSS API (BETA, no key). */
export const EPSS_URL = "https://api.first.org/data/v1/epss";

/** At most this many CVE IDs per EPSS request: 50 IDs are at most 849 characters of `cve` value, under FIRST's 2000 (ENR-02). */
export const EPSS_BATCH_SIZE = 50;

/** Per-edition ceiling on EPSS lookups: 10 requests of 50; IDs past it are unavailable (D-13). */
export const EPSS_MAX_IDS = 500;

/** Fetch Data Cache window per EPSS batch URL, in seconds: 1 hour, so a cached "no row" cannot outlive the next hourly refresh. */
export const EPSS_REVALIDATE_SECONDS = 3600;

/** Per-batch EPSS budget in milliseconds, spanning connect, redirects and the body read. */
export const EPSS_TIMEOUT_MS = 5_000;

/** Per-batch EPSS body cap: 256 KiB (a 50-row answer is about 5 KB). */
export const EPSS_MAX_BYTES = 256 * 1024;

/** An EPSS score at or above this gets the strong chip tone (D-06, consumed by Plan 07-03). */
export const EPSS_EMPHASIS_THRESHOLD = 0.1;

/** CVE Program API base for one CVE record; Phase 10 CVE-03 builds the same URL (ENR-06). */
export const SSVC_RECORD_URL_BASE = "https://cveawg.mitre.org/api/cve";

/** Per-edition ceiling on SSVC lookups, counted whether the answer is cached or fetched (D-06, D-08); confirmed by the 07.2-01 spike. */
export const SSVC_MAX_LOOKUPS = 100;

/** Parallel SSVC lookups in flight at once (RESEARCH A7). */
export const SSVC_CONCURRENCY = 12;

/** Per-lookup SSVC budget in milliseconds, spanning connect, redirects and the body read; applied inside the producer. */
export const SSVC_TIMEOUT_MS = 5_000;

/** Whole-SSVC-phase budget in milliseconds per regeneration, enforced by `fetchSsvc` (D-13, T-07.2-16). */
export const SSVC_TOTAL_BUDGET_MS = 6_000;

/** Per-record SSVC body cap: 512 KiB (observed p95 12 KB, max 44 KB). */
export const SSVC_MAX_BYTES = 512 * 1024;

/**
 * Window of one cached SSVC result, in seconds: 6 hours (D-13). Must stay at or
 * above 900: `unstable_cache` lowers the route's ISR window to its smallest
 * entry window. Sized against the Runtime Cache write budget on Vercel Hobby
 * (D-14), confirmed by the 07.2-01 spike.
 */
export const SSVC_REVALIDATE_SECONDS = 21_600;

/** Cache key prefix of the per-CVE SSVC lookup; the CVE ID is the cached call's argument and completes the key. */
export const SSVC_CACHE_KEY = "havadis-ssvc-v1";

/** The CVE Program organisation id of the CISA-ADP container; the id is compared, never the display name. */
export const CISA_ADP_ORG_ID = "134c704f-9b21-4f2e-91b3-4a467353bcc0";
