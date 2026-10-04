/**
 * Offsets for the unambiguous European zone abbreviations that V8's
 * `Date.parse` rejects (SRC-03, D-10). BST is British Summer Time (+0100).
 * Deliberately excludes ambiguous abbreviations (IST, CST-as-China, AST):
 * an ambiguous zone returns null (item dropped) instead of a guessed time
 * (T-05-11). GMT, UT and the US zones are left to V8.
 */
const ZONE_OFFSETS: Record<string, string> = {
  CET: "+0100",
  CEST: "+0200",
  EET: "+0200",
  EEST: "+0300",
  BST: "+0100",
  WET: "+0000",
  WEST: "+0100",
  MSK: "+0300",
};

/** Anchored trailing zone: whitespace then 2 to 5 letters at the end of the string. */
const TRAILING_ZONE = /\s([A-Za-z]{2,5})$/;

/**
 * Bounded, pure fallback parser for RFC-822 feed dates whose zone is a
 * European abbreviation (CET, CEST, EET, EEST, BST, WET, WEST, MSK).
 *
 * Verified root cause: `rss-parser` sets `isoDate` only when V8 can parse
 * `pubDate`, V8 returns Invalid Date for these abbreviations, and
 * `normalize` then dropped every such item, so all CERT-EU advisories
 * vanished. `rss-parser`'s `isoDate` stays the first choice; this function
 * is only consulted when it is absent.
 *
 * The input is trimmed and length-bounded (64 characters) before any regex
 * runs, so a hostile multi-kilobyte `pubDate` cannot trigger pathological
 * matching (T-05-09). Returns an ISO string, or `null` for undefined,
 * empty, oversized, unparseable or ambiguous-zone input. Never throws and
 * never reads the clock (PLAT-03, D-13).
 */
export function parseFeedDate(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const text = raw.trim();
  if (text === "" || text.length > 64) return null; // MAX_INPUT_LENGTH

  const match = TRAILING_ZONE.exec(text);
  const offset = match ? ZONE_OFFSETS[match[1].toUpperCase()] : undefined;
  const candidate = match && offset ? text.slice(0, match.index) + " " + offset : text;

  const time = Date.parse(candidate);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString();
}
