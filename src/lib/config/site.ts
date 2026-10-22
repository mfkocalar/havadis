/**
 * The public origin feeds and metadata use for absolute URLs. Feeds are
 * prerendered, so there is no request to read the host from: the origin comes
 * from the environment at build/revalidation time.
 *
 * Order: `SITE_URL` (set this in production), then Vercel's production
 * domain, then the local dev server. Always returned without a trailing slash.
 */
export function siteUrl(): string {
  const explicit = process.env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
  return "http://localhost:4000";
}

export const SITE_NAME = "Havadis";
export const SITE_DESCRIPTION =
  "A source-independent security newspaper: current cybersecurity coverage from curated feeds, deduplicated, classified and scored for urgency.";
