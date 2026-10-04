/**
 * The crawler's public identity (D-12, PLAT-04). Every source fetch sends
 * `USER_AGENT` to a third-party publisher, who may keep it in their logs, so
 * the contact URL inside it must resolve to a page this project controls.
 *
 * The host was confirmed by the user at the phase 5 checkpoint. The value
 * shipped before Phase 5 pointed at a third-party domain the project does not
 * own; it must never come back. Changing the host or the contact channel is a
 * one-line edit here, but requests already sent keep the old value in
 * publishers' logs.
 *
 * No personal data (name, personal email address) belongs in this file.
 */

/** Public page describing the crawler; served by `src/app/about/page.tsx`. */
export const CRAWLER_CONTACT_URL = "https://security-news-dun.vercel.app/about";

/** Where a publisher can ask to be removed or report a problem. */
export const CRAWLER_CONTACT_CHANNEL_URL = "https://github.com/mfkocalar/havadis/issues";

/**
 * Carries browser-compatible tokens (to clear a source's bot-management
 * layer, per RESEARCH.md Assumption A1) while still naming Havadis as an
 * automated aggregator with a contact URL.
 */
export const USER_AGENT = `Mozilla/5.0 (compatible; HavadisBot/0.1; +${CRAWLER_CONTACT_URL}) automated cybersecurity news aggregator`;
