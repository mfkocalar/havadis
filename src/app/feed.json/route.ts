import { feedResponse } from "@/lib/feeds/feedResponse";

/** JSON Feed 1.1 of every story, for agents and services. Read per request like `/feed.xml`. */
export const dynamic = "force-dynamic";

export function GET() {
  return feedResponse("all", "json");
}
