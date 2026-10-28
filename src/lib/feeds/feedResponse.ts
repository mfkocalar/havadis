import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "../config/site.ts";
import { getSnapshot } from "../snapshot.ts";
import {
  FEED_CONTENT_TYPE,
  findFeedVariant,
  selectFeedArticles,
  toJsonFeed,
  toRss,
  type FeedFormat,
} from "./buildFeed.ts";

/**
 * Renders one feed variant as a Response for the feed route handlers.
 *
 * The feed reads the shared cached edition through `getSnapshot`, the same
 * entry the front page renders, so rebuilding a feed never triggers its own
 * crawl of the sources (PLAT-01, 08-CONTEXT D-25). Feeds follow the page's
 * failure policy (`snapshot.ts` header item 7, Phase 7 D-16): with a previous
 * edition a failed refresh is invisible; with none, `getSnapshot` throws and
 * the error propagates, so ISR keeps serving the last good feed and a cold
 * build fails. An error status is not returned because ISR would cache it for
 * a whole window. This replaces v1.0 D-03's empty-feed fallback for feeds. The
 * feed is public, read-only data with no credentials, so any origin may read
 * it (CORS `*`), which lets browser-based agents and dashboards consume it
 * directly.
 */
export async function feedResponse(slug: string, format: FeedFormat): Promise<Response> {
  const variant = findFeedVariant(slug);
  if (!variant) return new Response("Not found", { status: 404 });

  const result = await getSnapshot();
  const ctx = {
    variant,
    articles: selectFeedArticles(result, variant.scope),
    generatedAt: result.generatedAt,
    siteUrl: siteUrl(),
    siteName: SITE_NAME,
    siteDescription: SITE_DESCRIPTION,
  };

  return new Response(format === "xml" ? toRss(ctx) : toJsonFeed(ctx), {
    headers: {
      "Content-Type": FEED_CONTENT_TYPE[format],
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
