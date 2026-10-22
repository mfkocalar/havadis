import { FEED_VARIANTS } from "@/lib/feeds/buildFeed";
import { feedResponse } from "@/lib/feeds/feedResponse";

/**
 * Scoped feeds: `/feed/<slug>.xml` (RSS) and `/feed/<slug>.json` (JSON Feed)
 * for each importance level and section. Every valid name is prerendered and
 * anything else is a 404 without running the pipeline (`dynamicParams`).
 */
export const dynamic = "force-static";
export const revalidate = 900;
export const dynamicParams = false;

export function generateStaticParams() {
  return FEED_VARIANTS.filter((variant) => variant.slug !== "all").flatMap((variant) => [
    { name: `${variant.slug}.xml` },
    { name: `${variant.slug}.json` },
  ]);
}

export async function GET(_request: Request, { params }: RouteContext<"/feed/[name]">) {
  const { name } = await params;
  const match = /^([a-z0-9-]+)\.(xml|json)$/.exec(name);
  if (!match || match[1] === "all") return new Response("Not found", { status: 404 });
  return feedResponse(match[1], match[2] as "xml" | "json");
}
