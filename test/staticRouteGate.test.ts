import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertStaticRoute,
  findStaleSources,
  type PrerenderManifest,
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
