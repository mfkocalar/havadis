/**
 * Builds a dedupe comparison KEY from a raw article URL (D-01). The output
 * is used ONLY as a `Map`/union-find key inside `dedupe.ts` — it never
 * replaces the displayed `Article.url`, so T-01-04's http(s)-only guarantee
 * (enforced in `normalize.ts`) is completely untouched by this module.
 *
 * Uses only the built-in `URL`/`URLSearchParams` — zero imports, matching
 * this codebase's `truncateSummary.ts`-style pure-transform convention.
 */

/**
 * Tracking query parameters stripped before comparison, so
 * `?utm_source=rss` (or a social/newsletter tracking param) never makes two
 * otherwise-identical URLs compare as different stories.
 *
 * `[ASSUMED]` — none of the 81 live URLs sampled in 03-RESEARCH.md's live
 * snapshot (2026-09-23) carried any query parameter at all, so this exact
 * list is untested against live data (RESEARCH Assumption A1). Kept as a
 * defensive, forward-looking denylist covering common cross-platform
 * tracking params publishers intermittently add for social/newsletter
 * syndication.
 */
export const TRACKING_PARAM_EXACT: ReadonlySet<string> = new Set([
  "fbclid",
  "gclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "yclid",
  "spm",
  "ref",
  "ref_src",
  "_hsenc",
  "_hsmi",
  "mkt_tok",
]);

/** Matches any `utm_*` parameter, case-insensitively. */
export const TRACKING_PARAM_PREFIX = /^utm_/i;

/**
 * Builds the canonical comparison key for `rawUrl` (D-01):
 * - Parses with `new URL`; on a parse failure, returns the trimmed raw
 *   string instead of throwing — a throw here would collapse the whole
 *   page to the empty state (T-03-10), and `getFrontPage`'s single outer
 *   `try` is the last line of defence, not the first.
 * - Key = lowercase `host` (not `hostname`: `URL` already drops a default
 *   port, so keeping `host` still distinguishes a non-default port, e.g.
 *   `a.test:8443` vs `a.test`), then the pathname with trailing slashes
 *   stripped (an empty path becomes `"/"`), then the remaining query
 *   string after deleting tracking keys and sorting the rest
 *   (prefixed with `"?"` only when non-empty).
 * - Scheme and fragment are omitted on purpose: D-01 treats `http` and
 *   `https` as equal, and a `#fragment` never distinguishes two stories.
 * - Path letter case is preserved — paths are case-sensitive (`/Foo` !==
 *   `/foo`), unlike the host.
 */
export function canonicalizeUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl.trim();
  }

  const host = parsed.host.toLowerCase();
  const path = parsed.pathname.replace(/\/+$/, "") || "/";

  const params = new URLSearchParams(parsed.search);
  for (const key of [...params.keys()]) {
    if (TRACKING_PARAM_PREFIX.test(key) || TRACKING_PARAM_EXACT.has(key.toLowerCase())) {
      params.delete(key);
    }
  }
  params.sort();
  const search = params.toString();

  return `${host}${path}${search ? `?${search}` : ""}`;
}
