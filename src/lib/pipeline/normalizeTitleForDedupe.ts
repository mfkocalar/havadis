/**
 * Builds a dedupe comparison KEY from an already-decoded `Article.title`
 * (D-01). Operates on `Article.title` as it exists AFTER `normalize.ts`'s
 * single entity-decode pass (D-04) — this function must NOT decode entities
 * itself, since a second decode here would break the single-decode-point
 * guarantee (`&amp;` would already be `&` by the time this runs; decoding
 * again could double-unescape a publisher's literal ampersand text).
 *
 * Zero imports — pure, synchronous string transform, matching this
 * codebase's `truncateSummary.ts`-style convention.
 */
export function normalizeTitleForDedupe(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
