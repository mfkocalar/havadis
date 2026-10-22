import { feedResponse } from "@/lib/feeds/feedResponse";

/**
 * RSS 2.0 feed of every story on the front page. Prerendered and revalidated
 * on the page's 900-second window, so pollers are served from cache and never
 * trigger a fan-out to the upstream sources themselves.
 */
export const dynamic = "force-static";
export const revalidate = 900;

export function GET() {
  return feedResponse("all", "xml");
}
