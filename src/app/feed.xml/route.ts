import { feedResponse } from "@/lib/feeds/feedResponse";

/**
 * RSS 2.0 feed of every story on the front page. Rendered per request from the database through the
 * read adapter, so it lists each source's last good items like the page does and never reaches the
 * network.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return feedResponse("all", "xml");
}
