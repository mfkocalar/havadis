import type { Article, Section } from "../types.ts";
import { CLASSIFICATION_ORDER, DEFAULT_SECTION, SECTION_KEYWORDS } from "../config/sections.ts";

/**
 * Compiles a literal keyword/phrase into a case-insensitive, word-bounded,
 * plural-tolerant RegExp (D-07). Escapes every regex metacharacter first,
 * then:
 * - prefixes `\b` when the keyword's first character is an ASCII word
 *   character (letter/digit/underscore);
 * - when the keyword's last character is an ASCII word character, appends
 *   the optional plural suffix `(?:e?s)?` and then `\b` — this is why
 *   `patch` also matches "patches" with no separate config entry;
 * - when the keyword ends in a non-word character (only `"CVE-"` does),
 *   appends nothing: the digit that follows in real text ("CVE-2026-...")
 *   already delimits the match, and a trailing `\b` there would behave
 *   inconsistently (verified live against "CVE-2026-87902"-style titles).
 *
 * Flag is `i` only — never `g` or `y`. A stateful `lastIndex` under `g`/`y`
 * with `.test()` would make repeated classification of the same input
 * order-dependent (CLASSIFY-01 determinism edge). The resulting pattern
 * has no nested quantifiers, so it is ReDoS-safe on unbounded feed-supplied
 * titles (threat T-03-01).
 */
export function keywordToRegExp(keyword: string): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startsWithWordChar = /^[A-Za-z0-9_]/.test(keyword);
  const endsWithWordChar = /[A-Za-z0-9_]$/.test(keyword);

  let pattern = escaped;
  if (startsWithWordChar) pattern = `\\b${pattern}`;
  if (endsWithWordChar) pattern = `${pattern}(?:e?s)?\\b`;

  return new RegExp(pattern, "i");
}

/**
 * Compiled once at module scope, in `CLASSIFICATION_ORDER` (D-05)
 * specificity order — never compiled per call. String keyword entries are
 * compiled via `keywordToRegExp`; RegExp entries (e.g. the `TA\d{1,5}`
 * pattern) are used as-is.
 */
const RULES: ReadonlyArray<{ section: Section; patterns: readonly RegExp[] }> =
  CLASSIFICATION_ORDER.map((section) => ({
    section,
    patterns: SECTION_KEYWORDS[section].map((kw) =>
      typeof kw === "string" ? keywordToRegExp(kw) : kw
    ),
  }));

/**
 * Classifies an article into exactly one of the 7 `Section`s (CLASSIFY-01).
 * Pass 1: every rule, in `CLASSIFICATION_ORDER`, tried against `title`.
 * Pass 2 (only if pass 1 found nothing): every rule tried against
 * `summary`. Otherwise `DEFAULT_SECTION` (D-06).
 *
 * The parameter type admits only `title` and `summary` — structurally, no
 * per-source override is possible here (D-08): `classify` cannot see which
 * source an article came from even if a caller wanted it to.
 *
 * Total for any string input, including empty strings — never throws
 * (supports `getFrontPage`'s never-throws contract, threat T-03-02).
 */
export function classify(article: Pick<Article, "title" | "summary">): Section {
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(article.title))) return rule.section;
  }
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(article.summary))) return rule.section;
  }
  return DEFAULT_SECTION;
}
