import type { Article, FrontPageResult, SourceConfig } from "../types.ts";
import { fetchSource } from "./fetchSource.ts";

/**
 * Fans a list of sources out to `fetcher` concurrently via
 * `Promise.allSettled` and flattens the successful results into one
 * article array.
 *
 * `Promise.allSettled` (not `Promise.all`) is load-bearing here per
 * RESEARCH.md Pitfall 5: a rejected settlement is just another array
 * element to skip, so it can never reach `getFrontPage`'s outer `catch`
 * and collapse every source into the page-wide error variant.
 *
 * An error-variant value (`{status:"error"}`) and a rejected settlement
 * are swallowed identically here — both contribute zero articles and are
 * never surfaced to the caller. This is CONTEXT.md D-05's
 * silent-degradation behaviour, carried over verbatim from Phase 1's
 * sequential loop: a broken source and a quiet source must look the same.
 *
 * `fetcher` defaults to `fetchSource` but is an explicit parameter so a
 * caller (e.g. Plan 02-03's tests) can inject a fetcher that rejects, to
 * exercise the otherwise-unreachable rejected-settlement branch given
 * `fetchSource`'s own never-throws contract.
 */
export async function fanOut(
  sources: SourceConfig[],
  fetcher: (source: SourceConfig) => Promise<FrontPageResult> = fetchSource
): Promise<Article[]> {
  const settled = await Promise.allSettled(sources.map((source) => fetcher(source)));
  const articles: Article[] = [];
  for (const outcome of settled) {
    if (outcome.status === "fulfilled" && outcome.value.status === "ok") {
      articles.push(...outcome.value.articles);
    }
    // A rejected settlement or a fulfilled {status:"error"} value are both
    // swallowed here, identically — see header comment above.
  }
  return articles;
}
