import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertStaticRoute,
  findStaleSources,
  isBuildInput,
  routeInventoryProblems,
  routePatternFromAppFile,
  type PrerenderManifest,
  type RouteInventoryInput,
} from "./fixtures/staticRouteGate.ts";

/**
 * Proves the D-08 static-route gate checker can fail. The gate in
 * test/productionPage.test.ts is only as good as these checkers: if
 * assertStaticRoute silently accepted a bad manifest, the gate would certify a
 * route that stopped being static (threat T-06-11).
 */

const BAD_MANIFESTS: Array<{ name: string; manifest: PrerenderManifest; message: RegExp }> = [
  {
    name: "route missing from the manifest",
    manifest: { routes: {} },
    message: /"\/" is not in the prerender manifest/,
  },
  {
    name: "revalidate false (page no longer refreshes)",
    manifest: { routes: { "/": { initialRevalidateSeconds: false, compute: "static" } } },
    message: /"\/" initialRevalidateSeconds is false, expected 900/,
  },
  {
    name: "revalidate 3600 (wrong window)",
    manifest: { routes: { "/": { initialRevalidateSeconds: 3600, compute: "static" } } },
    message: /"\/" initialRevalidateSeconds is 3600, expected 900/,
  },
  {
    name: "revalidate 0 (revalidates on every request)",
    manifest: { routes: { "/": { initialRevalidateSeconds: 0, compute: "static" } } },
    message: /"\/" initialRevalidateSeconds is 0, expected 900/,
  },
  {
    name: "revalidate missing entirely",
    manifest: { routes: { "/": { compute: "static" } } },
    message: /"\/" initialRevalidateSeconds is undefined, expected 900/,
  },
  {
    name: "compute dynamic",
    manifest: { routes: { "/": { initialRevalidateSeconds: 900, compute: "dynamic" } } },
    message: /"\/" compute is dynamic, expected "static"/,
  },
  {
    name: "compute field missing",
    manifest: { routes: { "/": { initialRevalidateSeconds: 900 } } },
    message: /"\/" compute is undefined, expected "static"/,
  },
];

for (const row of BAD_MANIFESTS) {
  test(`assertStaticRoute rejects: ${row.name}`, () => {
    assert.throws(() => assertStaticRoute(row.manifest, "/", 900), row.message);
  });
}

test("assertStaticRoute names the offending route, not a fixed one", () => {
  assert.throws(
    () => assertStaticRoute({ routes: {} }, "/cve", 900),
    /"\/cve" is not in the prerender manifest/
  );
});

test("assertStaticRoute accepts a static route with the 900-second window", () => {
  assert.doesNotThrow(() =>
    assertStaticRoute({ routes: { "/": { initialRevalidateSeconds: 900, compute: "static" } } }, "/", 900)
  );
});

test("assertStaticRoute accepts a fully static route when false is expected", () => {
  assert.doesNotThrow(() =>
    assertStaticRoute(
      { routes: { "/about": { initialRevalidateSeconds: false, compute: "static" } } },
      "/about",
      false
    )
  );
});

test("assertStaticRoute rejects a 900-second route when false is expected", () => {
  assert.throws(
    () =>
      assertStaticRoute(
        { routes: { "/about": { initialRevalidateSeconds: 900, compute: "static" } } },
        "/about",
        false
      ),
    /"\/about" initialRevalidateSeconds is 900, expected false/
  );
});

test("findStaleSources treats a source with the same mtime as the build as fresh", () => {
  assert.deepStrictEqual(
    findStaleSources(1000, [
      { path: "src/a.ts", mtimeMs: 999 },
      { path: "src/b.ts", mtimeMs: 1000 },
    ]),
    []
  );
});

test("findStaleSources returns strictly newer sources sorted by path", () => {
  assert.deepStrictEqual(
    findStaleSources(1000, [
      { path: "c", mtimeMs: 1001 },
      { path: "a", mtimeMs: 2000 },
      { path: "b", mtimeMs: 500 },
    ]),
    ["a", "c"]
  );
});

test("findStaleSources returns an empty list for no files", () => {
  assert.deepStrictEqual(findStaleSources(1000, []), []);
});

/** A healthy three-route inventory; each negative test below breaks one thing. */
function healthyInventory(): RouteInventoryInput {
  return {
    table: { "/": 900, "/about": false, "/feed/[name]": 900 },
    prerender: {
      routes: {
        "/": { initialRevalidateSeconds: 900, compute: "static", srcRoute: "/" },
        "/about": { initialRevalidateSeconds: false, compute: "static", srcRoute: "/about" },
        "/feed/a.xml": {
          initialRevalidateSeconds: 900,
          compute: "static",
          srcRoute: "/feed/[name]",
        },
      },
    },
    appPathRoutes: {
      "/page": "/",
      "/about/page": "/about",
      "/feed/[name]/route": "/feed/[name]",
    },
    fileRoutes: ["/", "/about", "/feed/[name]"],
  };
}

test("routeInventoryProblems accepts a healthy inventory", () => {
  assert.deepStrictEqual(routeInventoryProblems(healthyInventory()), []);
});

test("routeInventoryProblems names a built route that has no table row", () => {
  const input = healthyInventory();
  input.prerender.routes["/sources"] = {
    initialRevalidateSeconds: false,
    compute: "static",
    srcRoute: "/sources",
  };
  assert.deepStrictEqual(routeInventoryProblems(input), [
    'route "/sources" is built but has no row in test/fixtures/routeTable.ts',
  ]);
});

test("routeInventoryProblems names a table row that has no built route", () => {
  const input = healthyInventory();
  input.table = { ...input.table, "/gone": false };
  const problems = routeInventoryProblems(input);
  assert.ok(problems.includes('table row "/gone" has no prerendered route'));
  assert.ok(problems.includes('table row "/gone" is not an app route'));
});

test("routeInventoryProblems fails a route that is an app route but not prerendered (dynamic)", () => {
  const input = healthyInventory();
  input.appPathRoutes["/live/page"] = "/live";
  assert.deepStrictEqual(routeInventoryProblems(input), [
    'route "/live" is in app-path-routes-manifest.json but not prerendered (dynamic)',
  ]);
});

for (const seconds of [899, 901]) {
  test(`routeInventoryProblems fails a window of ${seconds} against a row of 900`, () => {
    const input = healthyInventory();
    input.prerender.routes["/"].initialRevalidateSeconds = seconds;
    assert.deepStrictEqual(routeInventoryProblems(input), [
      `"/" initialRevalidateSeconds is ${seconds}, expected 900`,
    ]);
  });
}

test("routeInventoryProblems fails a route whose compute is dynamic", () => {
  const input = healthyInventory();
  input.prerender.routes["/about"].compute = "dynamic";
  assert.deepStrictEqual(routeInventoryProblems(input), [
    '"/about" compute is dynamic, expected "static"',
  ]);
});

test("routeInventoryProblems names a page file that has no table row", () => {
  const input = healthyInventory();
  input.fileRoutes = [...input.fileRoutes, "/sources"];
  assert.deepStrictEqual(routeInventoryProblems(input), [
    'file route "/sources" has no row in test/fixtures/routeTable.ts',
  ]);
});

test("routeInventoryProblems fails instead of passing on an empty prerender manifest", () => {
  const input = healthyInventory();
  input.prerender = { routes: {} };
  assert.ok(routeInventoryProblems(input).includes("prerender manifest has no routes"));
});

test("routeInventoryProblems fails instead of passing on an empty app-path-routes manifest", () => {
  const input = healthyInventory();
  input.appPathRoutes = {};
  assert.ok(routeInventoryProblems(input).includes("app-path-routes-manifest.json has no routes"));
});

test("routeInventoryProblems fails instead of passing when no route files were found", () => {
  const input = healthyInventory();
  input.fileRoutes = [];
  assert.deepStrictEqual(routeInventoryProblems(input), [
    "no page or route files found under src/app",
  ]);
});

test("routeInventoryProblems matches table keys exactly: /feed/[slug] does not satisfy /feed/[name]", () => {
  const input = healthyInventory();
  delete (input.table as Record<string, number | false>)["/feed/[name]"];
  (input.table as Record<string, number | false>)["/feed/[slug]"] = 900;
  const problems = routeInventoryProblems(input);
  assert.ok(
    problems.includes('route "/feed/[name]" is built but has no row in test/fixtures/routeTable.ts')
  );
  assert.ok(problems.includes('table row "/feed/[slug]" has no prerendered route'));
});

test("routeInventoryProblems returns the same sorted list however the input is ordered", () => {
  const input = healthyInventory();
  input.fileRoutes = ["/zeta", "/alpha", ...input.fileRoutes];
  const problems = routeInventoryProblems(input);
  assert.deepStrictEqual(problems, [
    'file route "/alpha" has no row in test/fixtures/routeTable.ts',
    'file route "/zeta" has no row in test/fixtures/routeTable.ts',
  ]);
  assert.deepStrictEqual(problems, [...problems].sort());
});

test("routePatternFromAppFile maps the six current page and route files", () => {
  const cases: Array<[string, string]> = [
    ["src/app/page.tsx", "/"],
    ["src/app/about/page.tsx", "/about"],
    ["src/app/feeds/page.tsx", "/feeds"],
    ["src/app/feed.xml/route.ts", "/feed.xml"],
    ["src/app/feed.json/route.ts", "/feed.json"],
    ["src/app/feed/[name]/route.ts", "/feed/[name]"],
  ];
  for (const [file, route] of cases) assert.equal(routePatternFromAppFile(file), route, file);
});

test("routePatternFromAppFile accepts a backslash separator", () => {
  assert.equal(routePatternFromAppFile("src\\app\\feed\\[name]\\route.ts"), "/feed/[name]");
});

test("routePatternFromAppFile returns null for files that are not pages or routes", () => {
  for (const file of [
    "src/app/layout.tsx",
    "src/app/not-found.tsx",
    "src/app/icon.svg",
    "src/app/globals.css",
    "src/lib/page.tsx",
  ]) {
    assert.equal(routePatternFromAppFile(file), null, file);
  }
});

test("isBuildInput is true for every build input named in D-11", () => {
  for (const file of [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "postcss.config.mjs",
    "next.config.ts",
    "public/icon-192.png",
    "src/app/page.tsx",
  ]) {
    assert.equal(isBuildInput(file), true, file);
  }
});

test("isBuildInput is false for tests, docs and scripts", () => {
  for (const file of [
    "src/lib/edition.test.ts",
    "README.md",
    "test/productionPage.test.ts",
    "scripts/verify-viewports.mjs",
    ".planning/STATE.md",
  ]) {
    assert.equal(isBuildInput(file), false, file);
  }
});
