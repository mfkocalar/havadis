import type { Article, Section } from "../types.ts";
import { SECTION_DISPLAY_ORDER } from "../config/sections.ts";
import { rankWithinSection } from "./rank.ts";

/**
 * Buckets already-classified articles by `.section`, preserving each
 * bucket's incoming relative order, ranks each non-empty bucket via
 * `rankWithinSection` (CLASSIFY-02: tier weight x recency decay, D-09),
 * then emits one group per `SECTION_DISPLAY_ORDER` (D-12) member whose
 * bucket is non-empty — empty sections are skipped entirely (D-16,
 * CLASSIFY-03). Pure: never mutates `articles`. `now` is always a
 * parameter threaded through to `rankWithinSection`; nothing here reads
 * the clock itself (D-09).
 *
 * Generic over `T` (rather than fixed to `ClassifiedArticle`) so a richer
 * caller article type (Plan 03-03 adds `cves`) flows through without any
 * test-fixture churn here.
 */
export function groupBySection<T extends Article & { section: Section }>(
  articles: readonly T[],
  now: number
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
    articles: rankWithinSection(bySection.get(section) ?? [], now),
  })).filter((group) => group.articles.length > 0);
}
