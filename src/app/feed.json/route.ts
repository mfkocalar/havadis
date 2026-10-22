import { feedResponse } from "@/lib/feeds/feedResponse";

/** JSON Feed 1.1 of every story, for agents and services. Cached like `/feed.xml`. */
export const dynamic = "force-static";
export const revalidate = 900;

export function GET() {
  return feedResponse("all", "json");
}
