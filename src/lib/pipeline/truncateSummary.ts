/**
 * Caps `Article.summary` at the data layer, before it enters the RSC
 * payload (D-08). `rss-parser`'s `contentSnippet` is not a bounded excerpt
 * despite its name — it is the publisher's entire HTML-stripped body, with
 * no length limit whatsoever (see debug session
 * `article-card-text-length-inconsistent.md`, evidence T5). Live
 * measurement across all 13 sources found a worst case of 26,744 Unicode
 * code points (CISA); this module keeps a body that large out of the
 * payload entirely, rather than merely hiding it with CSS after it
 * arrives.
 *
 * This module deliberately does NOT touch the title — the title is not
 * capped here at all. `normalize.ts` now entity-decodes the title exactly
 * once (D-04), a different transform from capping: decoding restores the
 * publisher's intended characters, it does not bound length. The title's
 * measured spread is only ~3.1x across sources (vs. the summary's ~94x) and
 * it is the card's primary affordance, so ArticleCard.tsx's presentational
 * clamp is sufficient there.
 */

/**
 * The absolute ceiling on `Article.summary`, in Unicode code points.
 *
 * Derivation: the card's widest desktop measure is the `max-w-4xl` page
 * column (896px) less the card's own horizontal padding (24px each side),
 * giving roughly an 848px text column; at the summary's 16px `text-base`
 * size that is roughly 105-110 characters per line, so three lines hold
 * roughly 318 characters. 400 sits deliberately above that, which makes
 * ArticleCard's three-line CSS clamp — not this cap — the bound the reader
 * actually perceives on every viewport. This cap's job is different and
 * narrower: keeping a 26,744-code-point publisher body (the measured
 * worst case) out of the RSC payload, a roughly 98.5% reduction in that
 * worst case. These two bounds are complementary, not redundant — do not
 * remove either one as "the duplicate of the other".
 */
export const SUMMARY_MAX_CHARS = 400;

const ELLIPSIS = "…"; // U+2026 HORIZONTAL ELLIPSIS — one character, not three periods.

/**
 * Caps `text` at `SUMMARY_MAX_CHARS` Unicode code points, cutting on a
 * whitespace boundary where possible and marking the cut with a single
 * trailing ellipsis character.
 *
 * Pure, synchronous, no I/O, no awareness of which source produced the
 * text — safe to call unconditionally from `normalize.ts`.
 */
export function truncateSummary(text: string): string {
  // Measure in Unicode code points, never UTF-16 code units — `Array.from`
  // splits on code points, so an astral-plane character (surrogate pair)
  // is one array element, not two. Indexing the raw string by position is
  // exactly how a surrogate pair gets split into a lone surrogate.
  const codePoints = Array.from(text);

  if (codePoints.length <= SUMMARY_MAX_CHARS) {
    // Already within budget (this includes the empty string) — return
    // unchanged, no marker, no reallocation. This is also what keeps
    // normalize.test.ts's existing well-under-cap expectations passing
    // byte-identically.
    return text;
  }

  // Reserve exactly one code point for the ellipsis marker, so the cap is
  // an absolute ceiling (marker counts against the budget, never on top
  // of it) and so the function is idempotent: this branch's own output is
  // at most SUMMARY_MAX_CHARS code points, so re-applying truncateSummary
  // to it always takes the early-return branch above and returns it
  // untouched. Do not "simplify" this minus-one away — that silently
  // breaks idempotency.
  const budget = SUMMARY_MAX_CHARS - 1;
  const slice = codePoints.slice(0, budget);
  let cut = slice.join("");

  // Prefer cutting at the last whitespace boundary inside the slice, but
  // only if that boundary sits at or beyond 60% of the budget. Without
  // this floor, a pathological input whose only whitespace sits near the
  // very start of the slice would collapse a 400-code-point budget down
  // to a handful of words.
  // `[\s\S]` (rather than `.` + the `s`/dotAll flag) matches any character
  // including newlines while staying compatible with this repo's ES2017
  // TypeScript target, which predates the `s` flag.
  const lastWhitespace = cut.search(/\s(?![\s\S]*\s)/u);
  const minBoundary = Math.floor(budget * 0.6);
  if (lastWhitespace >= minBoundary) {
    cut = cut.slice(0, lastWhitespace);
  }

  cut = cut.trimEnd();
  // Drop a trailing comma, semicolon, or colon so the marker never reads
  // as "...," or "...;" or "...:" — the ellipsis alone carries the cut.
  cut = cut.replace(/[,;:]+$/u, "");

  return cut + ELLIPSIS;
}
