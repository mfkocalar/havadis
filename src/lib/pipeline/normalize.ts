import type Parser from "rss-parser";
import type { Article, SourceConfig } from "../types.ts";
import { decodeHtmlEntities } from "./decodeHtmlEntities.ts";
import { parseFeedDate } from "./parseFeedDate.ts";
import { truncateSummary } from "./truncateSummary.ts";

/**
 * Normalizes one parsed feed item into the shared `Article` shape.
 *
 * Every field arriving from the feed is untrusted external input:
 * - Missing `title`, `link`, or date drops the item entirely (`null`). The
 *   date is `isoDate`, falling back to `parseFeedDate(pubDate)` for European
 *   zone abbreviations (CET, CEST, ...) that V8 rejects, which leaves
 *   `rss-parser` without an `isoDate` (SRC-03, D-10).
 * - `link` is trimmed before the protocol gate and stored trimmed, so hrefs
 *   and React keys carry no whitespace (SRC-03, D-10).
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
 *
 * `summary` is sourced from `contentSnippet` only, never `item.content`:
 * `rss-parser` auto-generates `contentSnippet` by stripping HTML tags from
 * the raw content, but `item.content` itself is NOT stripped and can
 * contain raw markup. `ArticleCard.tsx` renders `article.summary` as a
 * plain JSX text node on the assumption that it is already HTML-stripped
 * (WR-01) — falling back to the unstripped `item.content` would violate
 * that assumption and display raw markup on the front page. A missing
 * `contentSnippet` is therefore treated the same as a missing summary.
 */
export function normalize(item: Parser.Item, source: SourceConfig): Article | null {
  const link = item.link?.trim();
  const publishedAt = item.isoDate || parseFeedDate(item.pubDate);
  if (!item.title || !link || !publishedAt) return null;

  let parsedLink: URL;
  try {
    parsedLink = new URL(link);
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
    url: link,
    source: source.name,
    sourceTier: source.tier,
    sourceType: source.sourceType,
    publishedAt,
    summary: truncateSummary((item.contentSnippet ?? "").trim()),
  };
}
