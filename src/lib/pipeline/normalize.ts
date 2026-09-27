import type Parser from "rss-parser";
import type { Article, SourceConfig } from "../types.ts";
import { decodeHtmlEntities } from "./decodeHtmlEntities.ts";
import { truncateSummary } from "./truncateSummary.ts";

/**
 * Normalizes one parsed feed item into the shared `Article` shape.
 *
 * Every field arriving from the feed is untrusted external input:
 * - Missing `title`, `link`, or `isoDate` drops the item entirely (`null`).
 * - `link` is parsed as a URL and dropped unless its protocol is `https:`
 *   or `http:` — this keeps a hostile feed from putting any other scheme
 *   into an `href` at render time (threat T-01-04).
 *
 * Performs no merging or deduplication of its own — two items with the same
 * title and link both survive this function. Collapsing them is NORM-02
 * (Phase 3's `dedupe()`, composed later in `getFrontPage.ts`).
 *
 * The title is now entity-decoded exactly once here, via
 * `decodeHtmlEntities()` (D-04) — decode first, then trim, so an
 * entity-encoded leading/trailing non-breaking space (e.g. `&nbsp;`) is
 * trimmed too. This closes the STATE.md "CrowdStrike `&trade;`" blocker: a
 * title that decodes to the empty string returns `null`, the same as a
 * missing title. Decoding is a different transform from capping — it is
 * still never re-cased, re-worded or truncated, so UI-02's verbatim
 * guarantee (as narrowed by Phase 2 D-08) still holds, and the decoded text
 * still reaches the card as a plain JSX text node (T-01-07). The decoded
 * string is also NORM-02's dedupe input (D-04), so decoding must happen
 * here, before dedupe ever runs.
 *
 * The `summary` field is length-capped per D-08 — `truncateSummary()`
 * bounds it to `SUMMARY_MAX_CHARS` Unicode code points before it enters
 * the returned `Article`, keeping an unbounded publisher body (measured up
 * to 26,744 code points) out of the RSC payload. `summary` is deliberately
 * NOT entity-decoded again here: `rss-parser`'s `contentSnippet` is already
 * entity-decoded (that's the exact asymmetry D-04 fixes for titles), so a
 * second decode pass over the summary would alter publisher text.
 */
export function normalize(item: Parser.Item, source: SourceConfig): Article | null {
  if (!item.title || !item.link || !item.isoDate) return null;

  let parsedLink: URL;
  try {
    parsedLink = new URL(item.link);
  } catch {
    return null;
  }
  if (parsedLink.protocol !== "https:" && parsedLink.protocol !== "http:") {
    return null;
  }

  const title = decodeHtmlEntities(item.title).trim();
  if (title === "") return null;

  return {
    title,
    url: item.link,
    source: source.name,
    sourceTier: source.tier,
    publishedAt: item.isoDate,
    summary: truncateSummary((item.contentSnippet ?? item.content ?? "").trim()),
  };
}
