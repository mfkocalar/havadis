import type { Article } from "../types.ts";
import { TIER_WEIGHT, recencyDecay } from "../config/ranking.ts";

/**
 * `score = TIER_WEIGHT[sourceTier] * recencyDecay(age)` (D-09). `now` is
 * always passed in — this function never reads the clock itself, so tests
 * can use fixed timestamps (D-09) and the score is reproducible.
 */
export function rankScore(article: Pick<Article, "sourceTier" | "publishedAt">, now: number): number {
  const ageMs = now - new Date(article.publishedAt).getTime();
  return TIER_WEIGHT[article.sourceTier] * recencyDecay(ageMs);
}

/**
 * Orders `articles` within a section by `rankScore` descending, breaking
 * ties by original input index ascending (never re-shuffling equal
 * scores — CLASSIFY-02 adjacency/ordering edges). Pure: copies before
 * sorting, never mutates the input, following the `sortByRecencyDesc.ts`
 * never-mutate idiom it supersedes. Only tier weight and recency count —
 * no multi-outlet coverage boost, no source-diversity penalty (D-11).
 * `now` is always a parameter; nothing in this module reads the clock.
 */
export function rankWithinSection<T extends Article>(articles: readonly T[], now: number): T[] {
  return articles
    .map((article, index) => ({ article, index, score: rankScore(article, now) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.article);
}
