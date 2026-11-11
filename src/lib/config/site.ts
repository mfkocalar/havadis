/**
 * The origin feeds and metadata use for absolute URLs. It comes from `HAVADIS_BASE_URL`, which the
 * operator configures and `loadConfig` validates at startup (http or https, no userinfo, query or
 * fragment). Routes render per request but have no trusted way to read the public host from the
 * request, so the configured origin is used. Falls back to the local default when unset and is
 * always returned without a trailing slash.
 */
export function siteUrl(): string {
  const explicit = process.env.HAVADIS_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  return "http://localhost:4000";
}

export const SITE_NAME = "Havadis";
export const SITE_DESCRIPTION =
  "A source-independent security newspaper: current cybersecurity coverage from curated feeds, deduplicated, classified and scored for urgency.";
