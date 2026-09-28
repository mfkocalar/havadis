import type { Article } from "../types.ts";

/**
 * CVE identifier pattern (D-13): the literal "CVE-", a 4-digit year, a
 * hyphen, then 4 to 7 digits, case-insensitive. This is the single source
 * of truth for what counts as a CVE ID anywhere in the pipeline; `cveChips.ts`
 * re-validates against an anchored variant of the same shape (D-14 defence
 * in depth) rather than importing this global-flag pattern directly.
 *
 * The trailing `(?!\d)` (WR-02) rejects sequence numbers longer than 7
 * digits outright rather than silently truncating them: without it, a
 * hypothetical 8+-digit ID (e.g. `CVE-2026-123456789`) would greedily match
 * only its first 7 digits, producing a different, syntactically-valid but
 * wrong CVE ID rather than failing to match. `cveChips.ts`'s anchored
 * `CVE_ID_SHAPE` already rejects this case via its own `$` anchor, so this
 * lookahead brings the global-scan pattern's behavior in line with it.
 *
 * `CVE_PATTERN` is a module-level `RegExp` with the `g` flag, so it carries
 * mutable `lastIndex` state across calls to `.match()`/`.exec()`. This is
 * safe here: `String.prototype.match(regexp)` with a global regexp always
 * resets `lastIndex` to 0 before scanning and again after collecting all
 * matches, so concurrent/sequential calls to `extractCves` never observe a
 * stale `lastIndex` from a previous call.
 */
export const CVE_PATTERN = /CVE-\d{4}-\d{4,7}(?!\d)/gi;

/**
 * Extracts every CVE ID from an article's title and capped summary (Phase 2
 * D-08's 400-code-point cap; RESEARCH.md Pitfall 5 — this function must
 * never read an uncapped body to "find more" IDs: a chip only ever
 * corresponds to text the reader can actually reach).
 *
 * Title and summary are joined with a single space specifically so a match
 * can never span the two fields (e.g. a title ending "CVE-2026-" plus a
 * summary starting "1234" must never combine into a false match). Joining
 * with exactly one space, rather than concatenating directly, also can't
 * accidentally bridge two digit runs across the boundary since the pattern
 * requires the literal "CVE-" prefix.
 *
 * IDs are uppercased, deduplicated (first occurrence wins), and returned in
 * first-appearance order — title IDs before summary IDs, falling out of the
 * left-to-right scan over the title-then-summary concatenation. Pure;
 * never throws.
 */
export function extractCves(article: Pick<Article, "title" | "summary">): string[] {
  const combined = `${article.title} ${article.summary}`;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of combined.match(CVE_PATTERN) ?? []) {
    const id = raw.toUpperCase();
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}
