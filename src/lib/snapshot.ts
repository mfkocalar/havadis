import { unstable_cache } from "next/cache";
import { EDITION_CACHE_KEY, produceEdition } from "./edition.ts";
import type { SectionedFrontPageResult } from "./types.ts";

/**
 * The single read path the front page uses, and that `/cve/[id]`, the RSS
 * routes and the KEV map will reuse (D-01). This is the ONLY file under
 * `src` that imports `next/cache` (D-03).
 *
 * The snapshot holds only feed-derived public content, never anything
 * derived from a request or a visitor (cookies, headers, query parameters,
 * IP addresses).
 *
 * Verified behaviour (Next 16.3.6, Cache Components off), measured by the
 * Phase 6 spike on a local production build and on a Vercel preview (the
 * preview was removed afterwards):
 *
 * 1. A throw inside `produce` during a refresh serves the stale entry and
 *    leaves it stale, so the next window retries. Verified on a local
 *    production build on 2026-10-07 (frozen value served for 16 windows) and
 *    on a Vercel preview on 2026-10-07 (frozen for 8 windows while the page
 *    kept regenerating).
 * 2. A returned value always overwrites the entry, even an empty one. This is
 *    why `produceEdition` throws on an errored or zero-article edition (D-05).
 * 3. The `revalidate` option alone sets the route's ISR window: no segment
 *    config is needed, and `/` reports 900 in the prerender manifest.
 * 4. Every fetch inside `produce` runs uncached, so a feed that fails during
 *    a refresh is missing from that edition instead of being served from a
 *    stale per-source body (local fetch cache: 3 entries instead of about
 *    58). Accepted by the user on 2026-10-07 (Open Question 1).
 * 5. The cache key is EDITION_CACHE_KEY plus the callback's source text, and
 *    Vercel's Data Cache survives deployments, so a shape change must bump
 *    the key. src/lib/edition.test.ts pins the shape per key version.
 * 6. With one reader, the Updated time equals the regeneration time. Once
 *    `/cve/[id]` or the feeds also read the entry, an edition can be up to
 *    about two windows old (RESEARCH Pitfall 8, Phase 10).
 * 7. A cold start with no entry and a failing refresh renders the quiet empty
 *    state (RESEARCH Pitfall 7, v1.0 D-03 behaviour). Covered by design, not
 *    exercised live.
 * 8. One regeneration costs about 373 ms of CPU. That is a local cold-compose
 *    upper-bound proxy (user plus system time, 2026-10-07), not a Vercel
 *    measurement: Vercel's CPU metric needed a paid add-on. The worst case of
 *    one regeneration per window all month is about 7.5% of the Hobby plan's
 *    4 hours of Active CPU (D-11).
 */

/** The shared cache window, and so the route's ISR window, in seconds. */
export const SNAPSHOT_REVALIDATE_SECONDS = 900;

/** Cache tag carried by every snapshot entry. */
export const SNAPSHOT_TAG = "havadis-snapshot";

/**
 * Generic seam over `unstable_cache`. `produce` must THROW to reject a
 * refresh: a returned value, even an empty one, overwrites the last good
 * entry for a full window, while a throw keeps it. Phase 7's KEV map reuses
 * this seam with its own key. Call arguments must never carry the clock
 * (they become part of the cache key and the cache would never hit), and it
 * must never be called from inside another `cachedSnapshot` callback (a
 * nested call bypasses the cache).
 */
export function cachedSnapshot<T>(
  key: string,
  produce: () => Promise<T>,
  opts: { revalidate?: number; tags?: string[] } = {}
): () => Promise<T> {
  return unstable_cache(produce, [key], {
    revalidate: opts.revalidate ?? SNAPSHOT_REVALIDATE_SECONDS,
    tags: opts.tags ?? [SNAPSHOT_TAG],
  });
}

// The clock is sampled here, once per refresh, inside the cached callback: a
// `now` argument would become part of the cache key.
const readEdition = cachedSnapshot(EDITION_CACHE_KEY, () => produceEdition(Date.now()));

/**
 * Returns the shared cached edition. Never throws: when a refresh is rejected
 * and there is no previous edition to fall back on, it returns the error
 * variant, which the page renders as its quiet empty state.
 */
export async function getSnapshot(): Promise<SectionedFrontPageResult> {
  try {
    return await readEdition();
  } catch (err) {
    console.error("getSnapshot failed (no previous edition to serve):", err);
    return {
      status: "error",
      reason: err instanceof Error ? err.message : "unknown snapshot error",
    };
  }
}
