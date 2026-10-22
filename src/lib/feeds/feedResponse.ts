import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "../config/site.ts";
import { getFrontPage } from "../pipeline/getFrontPage.ts";
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
 * Like the page, a pipeline failure yields a valid, empty feed rather than an
 * error status (D-03): a cached 5xx would make every poller back off or alert
 * for a whole revalidation window. The feed is public, read-only data with no
 * credentials, so any origin may read it (CORS `*`), which lets browser-based
 * agents and dashboards consume it directly.
 */
export async function feedResponse(slug: string, format: FeedFormat): Promise<Response> {
  const variant = findFeedVariant(slug);
  if (!variant) return new Response("Not found", { status: 404 });

  const result = await getFrontPage();
  const ctx = {
    variant,
    articles: selectFeedArticles(result, variant.scope),
    generatedAt: result.status === "ok" ? result.generatedAt : new Date().toISOString(),
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
