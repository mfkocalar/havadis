/**
 * Pure checkers for the production-build gates (PLAT-13).
 *
 * Test-only module: no file under `src` may import it (same convention as
 * `makeArticle.ts` and `hostileRedirectServer.ts`). It is used by
 * `test/productionPage.test.ts` and unit-tested in `test/staticRouteGate.test.ts`;
 * it lives in `test/fixtures` because that is the repository's existing home for
 * test-only modules.
 *
 * Every data route reads the database on each request, so none may appear in the
 * build's prerender manifest: a prerendered route would freeze its first read at
 * build time. `assertNotPrerendered` proves one route stayed out; `findStaleSources`
 * keeps that proof honest by refusing a build older than the sources it covers.
 *
 * Pure by construction: no `node:fs`, no clock read, no top-level side effect.
 * The caller reads the manifest and the file mtimes and hands them in.
 */

export type PrerenderManifest = {
  routes: Record<string, { initialRevalidateSeconds?: number | false; compute?: string }>;
};

export type SourceStamp = { path: string; mtimeMs: number };

/**
 * Throws, naming the route, when `route` is an entry of the prerender manifest.
 * A route that is absent (served per request) passes.
 */
export function assertNotPrerendered(manifest: PrerenderManifest, route: string): void {
  if (Object.hasOwn(manifest.routes, route)) {
    throw new Error(
      `"${route}" is in the prerender manifest: it must read the database on every request, never be prerendered`
    );
  }
}

/**
 * Returns the paths of files modified strictly after the build, sorted. A file
 * with the same mtime as the build is fresh.
 */
export function findStaleSources(buildMtimeMs: number, files: SourceStamp[]): string[] {
  return files
    .filter((file) => file.mtimeMs > buildMtimeMs)
    .map((file) => file.path)
    .sort();
}
