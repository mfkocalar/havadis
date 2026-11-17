/**
 * The public origin feeds and metadata use for absolute URLs. Feeds are
 * prerendered, so there is no request to read the host from: the origin comes
 * from the environment at build/revalidation time.
 *
 * Order: `SITE_URL` (set this in production), then the local dev server.
 * Always returned without a trailing slash.
 *
 * A Vercel production build without `SITE_URL` throws (D-18): the guard exists
 * so a production build can never publish localhost URLs in Open Graph tags or
 * feeds. Previews and local builds fall back to the dev server as before. The
 * message is fixed text and never echoes an environment value.
 */
export function siteUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  if (env.VERCEL_ENV === "production") {
    throw new Error("SITE_URL must be set for a Vercel production build");
  }
  return "http://localhost:4000";
}

export const SITE_NAME = "Havadis";
export const SITE_DESCRIPTION =
  "A source-independent security newspaper: current cybersecurity coverage from curated feeds, deduplicated, classified and scored for urgency.";
