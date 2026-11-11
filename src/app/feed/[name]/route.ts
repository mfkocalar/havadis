import { feedResponse } from "@/lib/feeds/feedResponse";

/**
 * Scoped feeds: `/feed/<slug>.xml` (RSS) and `/feed/<slug>.json` (JSON Feed) for each importance
 * level and section. Rendered per request from the database. The name is validated against a strict
 * pattern and `findFeedVariant` guards the slug, so anything else is a 404 before the database is
 * touched.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: RouteContext<"/feed/[name]">) {
  const { name } = await params;
  const match = /^([a-z0-9-]+)\.(xml|json)$/.exec(name);
  if (!match || match[1] === "all") return new Response("Not found", { status: 404 });
  return feedResponse(match[1], match[2] as "xml" | "json");
}
