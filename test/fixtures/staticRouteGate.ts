/**
 * Pure checkers for the D-08 static-route gate.
 *
 * Test-only module: no file under `src` may import it (same convention as
 * `makeArticle.ts` and `hostileRedirectServer.ts`). It is used by
 * `test/productionPage.test.ts` for the static-route gate and unit-tested in
 * `test/staticRouteGate.test.ts`; it lives in `test/fixtures` because that is
 * the repository's existing home for test-only modules.
 *
 * Pure by construction: no `node:fs`, no clock read, no top-level side effect.
 * The caller reads the manifest and the file mtimes and hands them in.
 */

export type PrerenderManifest = {
  routes: Record<string, { initialRevalidateSeconds?: number | false; compute?: string }>;
};

export type SourceStamp = { path: string; mtimeMs: number };

/**
 * Throws when `route` is not prerendered static with the given revalidation
 * window. The message names the route and the offending value. Check order:
 * presence, compute, window.
 */
export function assertStaticRoute(
  manifest: PrerenderManifest,
  route: string,
  seconds: number | false
): void {
  const entry = manifest.routes[route];
  if (!entry) {
    throw new Error(
      `"${route}" is not in the prerender manifest (the route became dynamic or was removed)`
    );
  }
  if (entry.compute !== "static") {
    throw new Error(`"${route}" compute is ${String(entry.compute)}, expected "static"`);
  }
  if (entry.initialRevalidateSeconds !== seconds) {
    throw new Error(
      `"${route}" initialRevalidateSeconds is ${String(entry.initialRevalidateSeconds)}, expected ${String(seconds)}`
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
