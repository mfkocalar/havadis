import { getFrontPage } from "./pipeline/getFrontPage.ts";
import type { SectionedFrontPageResult } from "./types.ts";

/**
 * Cache key of the shared front-page snapshot. The `-vN` suffix is the
 * snapshot schema version: any phase that changes the shape of the cached
 * edition bumps it, because the key otherwise depends only on the callback's
 * source text and an old-shape entry would be served to new code (RESEARCH
 * Pitfall 5). The `havadis-` prefix keeps the entry apart from other projects
 * sharing the Hobby Data Cache (Pitfall 9b). Lives here, not in `snapshot.ts`,
 * so hermetic tests can import it (`snapshot.ts` cannot load under
 * `node --test`).
 */
export const EDITION_CACHE_KEY = "havadis-snapshot-v2";

/** The publishable variant of the front-page result: at least one article. */
export type OkEdition = Extract<SectionedFrontPageResult, { status: "ok" }>;

/**
 * Pure edition policy (D-05, D-06, D-07). Loads the composed edition once,
 * with the caller's explicit `now`, and rejects it only when it errored or
 * composed zero articles. A partial outage that still yields at least one
 * article publishes normally: there is no source-count floor and no
 * article-count-drop rule.
 *
 * It THROWS instead of returning the error variant because `unstable_cache`
 * writes any returned value over the cached entry for a full window, whereas
 * a throw during a refresh keeps the last good entry (RESEARCH F1, F2).
 *
 * The accepted edition is returned as the very object the loader produced:
 * no copy and no added field, so nothing marks an edition as stale (D-06) and
 * `generatedAt` is always the time that edition was composed. There is no
 * maximum age (D-07): the last good edition is served until a non-empty
 * refresh succeeds, and its Updated time shows its age.
 *
 * Never reads the clock; `now` is the caller's (D-12).
 */
export async function produceEdition(
  now: number,
  load: (now: number) => Promise<SectionedFrontPageResult> = getFrontPage
): Promise<OkEdition> {
  const loaded = await load(now);
  if (loaded.status !== "ok") {
    throw new Error(`edition rejected: ${loaded.reason}`);
  }
  if (loaded.articles.length === 0) {
    throw new Error("edition rejected: zero articles");
  }
  return loaded;
}
