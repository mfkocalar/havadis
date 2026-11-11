import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "../config/site.ts";
import { readFrontPage } from "../adapters/frontPage.ts";
import { getWebDb, isBusyError } from "../db/openDb.ts";
import { createLogger } from "../log/logger.ts";
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
 * Every feed is read from the database on each request through `readFrontPage`, the same read
 * adapter the front page renders from. Each source is therefore windowed from its own last
 * successful fetch inside one read snapshot, so feeds hold every source's last good items exactly
 * like the page: a failed or empty cycle, or one source failing inside a partial cycle, never thins
 * a feed (PLAT-09). Nothing here reaches the network and nothing is cached or prerendered.
 *
 * Before the first successful ingestion cycle there is nothing to list, and an empty but valid feed
 * would look like a quiet news day to a subscriber, so the answer is 503 with `Retry-After: 300`.
 * A read that hits a busy database answers 503 with `Retry-After: 30` and logs only a fixed event
 * with the route, never the driver's error text. The instance is private, so the response carries
 * no CORS header: other sites the operator visits cannot read it through the browser.
 */

const WAITING_RETRY_SECONDS = "300";
const BUSY_RETRY_SECONDS = "30";

export async function feedResponse(slug: string, format: FeedFormat): Promise<Response> {
  const variant = findFeedVariant(slug);
  if (!variant) return new Response("Not found", { status: 404 });

  let read: Awaited<ReturnType<typeof readFrontPage>>;
  try {
    read = await readFrontPage(getWebDb().db, Date.now());
  } catch (err) {
    if (!isBusyError(err)) throw err;
    createLogger({ level: "info" }).log("warn", "web_db_busy", { route: `/feed/${variant.slug}.${format}` });
    return new Response("Database busy; try again shortly", {
      status: 503,
      headers: { "Retry-After": BUSY_RETRY_SECONDS, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (read.kind === "waiting") {
    return new Response("Waiting for the first ingestion", {
      status: 503,
      headers: { "Retry-After": WAITING_RETRY_SECONDS, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const ctx = {
    variant,
    articles: selectFeedArticles(read.result, variant.scope),
    generatedAt: read.result.generatedAt,
    siteUrl: siteUrl(),
    siteName: SITE_NAME,
    siteDescription: SITE_DESCRIPTION,
  };

  return new Response(format === "xml" ? toRss(ctx) : toJsonFeed(ctx), {
    headers: {
      "Content-Type": FEED_CONTENT_TYPE[format],
      "X-Content-Type-Options": "nosniff",
    },
  });
}
