import type { Article } from "../types.ts";

/**
 * Trims `articles` to the last `hours` hours. The cutoff is computed once,
 * before the filter runs, so every article in a single call is compared
 * against one consistent instant rather than a cutoff that drifts
 * mid-iteration (INGEST-04, concurrency edge).
 */
export function filterLookback(articles: Article[], hours = 24): Article[] {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return articles.filter((article) => new Date(article.publishedAt).getTime() >= cutoff);
}
