/**
 * The crawler's public identity (D-12, PLAT-04, SAFE-03). Every source fetch sends
 * `USER_AGENT` to a third-party publisher, who may keep it in their logs, so
 * the contact URL inside it must resolve to a page this project controls.
 *
 * The contact is the public project repository, which stays reachable for any
 * self-hosted instance and does not depend on a hosted site. Requests already
 * sent keep an older value in publishers' logs, so the contact must never point
 * at a domain the project does not own.
 *
 * No personal data (name, personal email address) belongs in this file.
 */
import { HAVADIS_VERSION } from "./version.ts";

/** Public repository describing the crawler. */
export const CRAWLER_CONTACT_URL = "https://github.com/mfkocalar/havadis";

/** Where a publisher can ask to be removed or report a problem. */
export const CRAWLER_CONTACT_CHANNEL_URL = "https://github.com/mfkocalar/havadis/issues";

/**
 * Carries browser-compatible tokens (to clear a source's bot-management
 * layer, per RESEARCH.md Assumption A1) while still naming Havadis, its
 * version and the repository as an automated aggregator. Printable ASCII only.
 */
export const USER_AGENT = `Mozilla/5.0 (compatible; HavadisBot/${HAVADIS_VERSION}; +${CRAWLER_CONTACT_URL}) automated cybersecurity news aggregator`;
