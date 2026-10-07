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
