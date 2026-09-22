import type { Article } from "../types.ts";

/**
 * Returns a new array of `articles` sorted newest-first by `publishedAt`.
 * Pure — copies the input before sorting, so the caller's array is never
 * mutated.
 *
 * `Array.prototype.sort` is specified stable (ES2019+), so entries with an
 * equal `publishedAt` retain their incoming order — which is
 * source-iteration order coming out of `fanOut`. That is the resolved
 * ordering edge for this phase: equal timestamps are kept deterministic,
 * never re-shuffled and never treated as duplicates (dedup is Phase 3 /
 * NORM-02).
 *
 * This recency-descending order is the interim choice CONTEXT.md left to
 * Claude's Discretion — Phase 3's real classification + ranking replaces
 * it; this is a transitional data decision, not a lasting product one.
 */
export function sortByRecencyDesc(articles: Article[]): Article[] {
  return [...articles].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
}
