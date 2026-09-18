import type { SourceConfig } from "../types.ts";

/**
 * The fixed list of ingestion sources. Phase 1 wires exactly one entry
 * (Krebs on Security, per CONTEXT.md D-01); Phase 2 appends the other
 * twelve PROJECT.md rows to this same array with no other code changes.
 *
 * The URL below is the canonical, post-redirect form
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
];
