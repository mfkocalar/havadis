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
  routes: Record<
    string,
    { initialRevalidateSeconds?: number | false; compute?: string; srcRoute?: string }
  >;
};

export type RouteInventoryInput = {
  /** The hand-written expectation table (test/fixtures/routeTable.ts). */
  table: Readonly<Record<string, number | false>>;
  prerender: PrerenderManifest;
  /** .next/app-path-routes-manifest.json: internal app path to route pattern. */
  appPathRoutes: Record<string, string>;
  /** Route patterns found by scanning page and route files under src/app. */
  fileRoutes: readonly string[];
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
 * The UX-07 route inventory: every route the build produced, every route the
 * app-path manifest lists and every page or route file under src/app is
 * compared with the hand-written table. Returns a sorted problem list; an empty
 * list means the inventory passes. Empty inputs never pass, so a missing or
 * truncated build cannot certify nothing. Table keys match srcRoute values by
 * exact string equality, so "/feed/[slug]" never satisfies "/feed/[name]".
 */
export function routeInventoryProblems(input: RouteInventoryInput): string[] {
  const { table, prerender, appPathRoutes, fileRoutes } = input;
  const problems: string[] = [];

  const builtRoutes = new Set<string>();
  for (const [route, entry] of Object.entries(prerender.routes)) {
    builtRoutes.add(entry.srcRoute ?? route);
  }
  const appRoutes = new Set(Object.values(appPathRoutes));

  if (builtRoutes.size === 0) problems.push("prerender manifest has no routes");
  if (appRoutes.size === 0) problems.push("app-path-routes-manifest.json has no routes");
  if (fileRoutes.length === 0) problems.push("no page or route files found under src/app");

  for (const route of builtRoutes) {
    if (!Object.hasOwn(table, route)) {
      problems.push(`route "${route}" is built but has no row in test/fixtures/routeTable.ts`);
    }
  }
  for (const route of Object.keys(table)) {
    if (!builtRoutes.has(route)) {
      problems.push(`table row "${route}" has no prerendered route`);
    }
    if (!appRoutes.has(route)) {
      problems.push(`table row "${route}" is not an app route`);
    }
  }
  for (const route of appRoutes) {
    if (!builtRoutes.has(route)) {
      problems.push(
        `route "${route}" is in app-path-routes-manifest.json but not prerendered (dynamic)`
      );
    }
  }
  for (const route of fileRoutes) {
    if (!Object.hasOwn(table, route)) {
      problems.push(`file route "${route}" has no row in test/fixtures/routeTable.ts`);
    }
  }

  for (const [route, entry] of Object.entries(prerender.routes)) {
    const key = entry.srcRoute ?? route;
    if (!Object.hasOwn(table, key)) continue;
    try {
      assertStaticRoute(prerender, route, table[key]);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }

  return problems.sort();
}

const APP_ROUTE_FILE = /^(?:page\.(?:tsx|ts|jsx|js)|route\.(?:ts|js))$/;

/**
 * The route pattern a page or route file under src/app serves, or null for any
 * other file (layout, not-found, error, metadata files, CSS). Directory names
 * are kept as written: src/app/feed.xml/route.ts is "/feed.xml" and
 * src/app/feed/[name]/route.ts is "/feed/[name]". Accepts / or \\ separators.
 */
export function routePatternFromAppFile(relPath: string): string | null {
  const segments = relPath.split(/[\\/]/);
  if (segments[0] !== "src" || segments[1] !== "app") return null;
  const file = segments[segments.length - 1];
  if (segments.length < 3 || !APP_ROUTE_FILE.test(file)) return null;
  return "/" + segments.slice(2, -1).join("/");
}

/** Root files whose change means the production build is out of date (D-11). */
export const BUILD_INPUT_ROOT_FILES = [
  "next.config.ts",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "postcss.config.mjs",
] as const;

/**
 * True for every file the production build is made from: the root files above,
 * non-test files under src/, and every file under public/. Test files are
 * excluded so editing a test never demands a rebuild.
 */
export function isBuildInput(relPath: string): boolean {
  const normalized = relPath.split("\\").join("/");
  if ((BUILD_INPUT_ROOT_FILES as readonly string[]).includes(normalized)) return true;
  if (normalized.startsWith("src/")) return !normalized.endsWith(".test.ts");
  return normalized.startsWith("public/");
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
