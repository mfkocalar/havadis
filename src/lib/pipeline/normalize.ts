import type Parser from "rss-parser";
import type { Article, SourceConfig } from "../types.ts";
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
 * Performs no sorting, merging, or deduplication — two items with the same
 * title and link both survive. Collapsing them is NORM-02 (Phase 3); doing
 * it here would make that later change invisible.
 *
 * The `summary` field is now length-capped per D-08 — `truncateSummary()`
 * bounds it to `SUMMARY_MAX_CHARS` Unicode code points before it enters
 * the returned `Article`, keeping an unbounded publisher body (measured up
 * to 26,744 code points) out of the RSC payload. `title` deliberately is
 * NOT capped here: its measured cross-source spread is only ~3.1x (vs. the
 * summary's ~94x) and it is the card's primary affordance, so bounding it
 * visually (ArticleCard.tsx's CSS clamp) is sufficient.
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

  return {
    title: item.title.trim(),
    url: item.link,
    source: source.name,
    sourceTier: source.tier,
    publishedAt: item.isoDate,
    summary: truncateSummary((item.contentSnippet ?? item.content ?? "").trim()),
  };
}
