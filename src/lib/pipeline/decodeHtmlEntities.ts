/**
 * Decodes HTML/XML character entities in feed-supplied text (D-04).
 *
 * Root cause this closes: `rss-parser@3.13.0`'s `getSnippet()` decodes
 * entities when building `item.contentSnippet` (via its own `entities`
 * dependency — see `node_modules/rss-parser/lib/utils.js:11-13`), but
 * nothing in `rss-parser` ever decodes `item.title`. A title that arrives
 * double-encoded in the source feed's raw XML (e.g. a literal `&amp;trade;`,
 * which `xml2js`'s own single-pass SAX decoding resolves only once, down to
 * the still-encoded text `&trade;`) reaches `Article.title` undecoded. This
 * is exactly the STATE.md "CrowdStrike `&trade;`" blocker: a CrowdStrike
 * headline shows the literal text `&trade;` instead of the trademark sign.
 *
 * No dependency is added for this (STACK.md's dependency-minimalism bias;
 * 03-RESEARCH.md's Package Legitimacy Audit flagged `entities`'s current
 * `latest` tag `SUS`/too-new, and this session's live snapshot needed
 * nothing beyond a small named-entity table plus numeric entities). This
 * module is a zero-import, pure, synchronous string transform — the same
 * shape as `truncateSummary.ts`.
 */

// Every quantifier below is bounded ({1,7}, {1,6}, {1,31}), so a scan over
// an unbounded, feed-supplied title is linear in input length — never
// catastrophic backtracking (T-03-09). The decimal branch's digit class
// accepts only `\d`, so a mixed run like "&#12ab;" can never be
// half-parsed into a numeric match; it simply fails to match at all and is
// left untouched, exactly like any other malformed entity.
const ENTITY_PATTERN =
  /&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g;

// A small named-entity table covering what's actually plausible in RSS/Atom
// titles (03-RESEARCH.md "Don't Hand-Roll": no named entity beyond the 5 XML
// defaults appeared in the 81-article live snapshot this project researched;
// the numeric branch below covers the long tail — RESEARCH Assumption A2).
// Any name not in this map is left as the original, unchanged match.
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  trade: "™",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  copy: "©",
  reg: "®",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
};

const MIN_CODE_POINT = 1;
const MAX_CODE_POINT = 0x10ffff;
const SURROGATE_RANGE_START = 0xd800;
const SURROGATE_RANGE_END = 0xdfff;

/**
 * Decodes HTML/XML entities in `text` exactly once. Replacement output is
 * never re-scanned — `String.prototype.replace` with a global pattern only
 * matches against the original input, so a doubly-encoded input like
 * `"&amp;lt;"` decodes to the single-decoded `"&lt;"`, never to `"<"`
 * (D-04: "decoded once").
 *
 * Decoded markup-looking text (e.g. `&lt;script&gt;` -> the plain string
 * `<script>`) is returned as literal characters, not interpreted as HTML —
 * callers render it as a plain JSX text child, so this never reopens the
 * XSS surface closed by T-01-07 (see T-03-06 in this plan's threat model).
 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(ENTITY_PATTERN, (match, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body[1] === "x" || body[1] === "X";
      const digits = isHex ? body.slice(2) : body.slice(1);
      const codePoint = parseInt(digits, isHex ? 16 : 10);
      if (
        !Number.isFinite(codePoint) ||
        codePoint < MIN_CODE_POINT ||
        codePoint > MAX_CODE_POINT ||
        (codePoint >= SURROGATE_RANGE_START && codePoint <= SURROGATE_RANGE_END)
      ) {
        // Invalid code point (out of range, or a lone surrogate) — never
        // throw, just leave the original entity text untouched.
        return match;
      }
      return String.fromCodePoint(codePoint);
    }

    const name = body.toLowerCase();
    return name in NAMED_ENTITIES ? NAMED_ENTITIES[name] : match;
  });
}
