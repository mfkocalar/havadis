import { createHash } from "node:crypto";

/**
 * A short, stable key for a story's client-side read/flag state. Hashing keeps
 * the feed-supplied URL itself out of client component props (T-01-07) and
 * out of the reader's localStorage. Dedupe already guarantees one card per
 * URL, so the key is unique on the page.
 *
 * Lives in its own module so the web-side read adapter can import it without
 * reaching `getFrontPage.ts`, whose `fetchSource` import is the network path.
 */
export function articleId(url: string): string {
  return createHash("sha256").update(url).digest("base64url").slice(0, 12);
}
