/**
 * The Content-Security-Policy for every HTML response (PLAT-14, T-14-29). Pure: src/proxy.ts supplies
 * the per-request nonce. The browser may contact only the instance itself, so there is no origin
 * other than 'self' in any directive and no scheme or wildcard source.
 *
 * There is deliberately no directive that upgrades requests to HTTPS: until Phase 15 puts TLS in front,
 * the instance serves plain HTTP on loopback and such a directive would break its own assets.
 */

/** base64 of a random UUID: unpredictable, unique per request, and free of characters that end a CSP source. */
export function newNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

/**
 * `dev` is for `next dev` only: React there needs eval for debugging stacks, and the dev server injects
 * inline styles without a nonce. Production keeps both out.
 */
export function buildCsp(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    dev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
