import type { Article } from "../types.ts";

/**
 * Trims `articles` to the last `hours` hours before `now`. The cutoff is
 * computed once, before the filter runs, so every article in a single call
 * is compared against one consistent instant rather than a cutoff that
 * drifts mid-iteration (INGEST-04, concurrency edge).
 *
 * Never reads the wall clock: the caller passes `now` (PLAT-03, D-13). An
 * unparseable `publishedAt` is dropped, because a NaN time never passes the
 * cutoff comparison.
 */
export function filterLookback(articles: Article[], hours: number, now: number): Article[] {
  const cutoff = now - hours * 60 * 60 * 1000;
  return articles.filter((article) => new Date(article.publishedAt).getTime() >= cutoff);
}
