import type { Article, Section } from "../types.ts";
import { SECTION_DISPLAY_ORDER } from "../config/sections.ts";

/**
 * Buckets already-classified articles by `.section`, preserving each
 * bucket's incoming relative order, then emits one group per
 * `SECTION_DISPLAY_ORDER` (D-12) member whose bucket is non-empty — empty
 * sections are skipped entirely (D-16, CLASSIFY-03). Pure: never mutates
 * `articles`.
 *
 * Generic over `T` (rather than fixed to `ClassifiedArticle`) so a richer
 * caller article type (Plan 03-03 adds `cves`) flows through without any
 * test-fixture churn here.
 *
 * Task 1 leaves within-section order as whatever order articles arrived in
 * (the interim recency sort applied upstream in `composeFrontPage`); Task 2
 * replaces that interim order by running `rankWithinSection` on each
 * non-empty bucket here, before it is emitted.
 */
export function groupBySection<T extends Article & { section: Section }>(
  articles: readonly T[]
): Array<{ section: Section; articles: T[] }> {
  const bySection = new Map<Section, T[]>();
  for (const article of articles) {
    const bucket = bySection.get(article.section);
    if (bucket) {
      bucket.push(article);
    } else {
      bySection.set(article.section, [article]);
    }
  }

  return SECTION_DISPLAY_ORDER.map((section) => ({
    section,
    articles: bySection.get(section) ?? [],
  })).filter((group) => group.articles.length > 0);
}
