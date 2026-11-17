/**
 * The hand-written route expectation table for the UX-07 static-route gate.
 *
 * Test-only module: no file under `src` may import it (same convention as
 * `staticRouteGate.ts`). The table is written by hand on purpose and must never
 * be generated from the build output: a table derived from what was built would
 * make the gate certify whatever was built. Adding a page or route means adding
 * a row here, which is the point of the gate.
 *
 * Keys are the route patterns Next.js reports as `srcRoute` (dynamic segments
 * in brackets), compared by exact string equality. The value is the expected
 * `initialRevalidateSeconds`: a number of seconds, or `false` for a route that
 * is fully static and never revalidates.
 */

export type RouteExpectation = number | false;

export const ROUTE_TABLE: Readonly<Record<string, RouteExpectation>> = {
  "/": 900,
  "/feed.xml": 900,
  "/feed.json": 900,
  "/feed/[name]": 900,
  "/about": false,
  "/feeds": false,
  "/_not-found": false,
  "/_global-error": false,
  "/favicon.ico": false,
  "/opengraph-image.png": false,
};
