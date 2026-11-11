import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertNotPrerendered,
  findStaleSources,
  type PrerenderManifest,
} from "./fixtures/staticRouteGate.ts";

/**
 * Proves the prerender gate checker can fail. The gate in test/productionPage.test.ts is only as
 * good as these checkers: if assertNotPrerendered silently accepted a manifest that lists a data
 * route, the gate would certify a route that froze its first database read at build time (T-14-36).
 */

const PRERENDERED: PrerenderManifest = {
  routes: {
    "/": { initialRevalidateSeconds: 900, compute: "static" },
    "/feed.xml": { initialRevalidateSeconds: false, compute: "static" },
    "/api/health": { compute: "dynamic" },
  },
};

for (const route of Object.keys(PRERENDERED.routes)) {
  test(`assertNotPrerendered rejects a manifest that lists ${route}, naming the route`, () => {
    assert.throws(
      () => assertNotPrerendered(PRERENDERED, route),
      (err: unknown) => err instanceof Error && err.message.includes(`"${route}" is in the prerender manifest`)
    );
  });
}

test("assertNotPrerendered names the offending route, not a fixed one", () => {
  assert.throws(
    () => assertNotPrerendered({ routes: { "/feed/high.json": {} } }, "/feed/high.json"),
    /"\/feed\/high\.json" is in the prerender manifest/
  );
});

test("assertNotPrerendered accepts a route that is absent from the manifest", () => {
  assert.doesNotThrow(() => assertNotPrerendered(PRERENDERED, "/about"));
  assert.doesNotThrow(() => assertNotPrerendered({ routes: {} }, "/"));
});

test("assertNotPrerendered judges only the exact route: a prefix of a listed route is absent", () => {
  assert.doesNotThrow(() => assertNotPrerendered(PRERENDERED, "/feed"));
  assert.doesNotThrow(() => assertNotPrerendered(PRERENDERED, "/api"));
});

test("assertNotPrerendered is not fooled by inherited object keys", () => {
  assert.doesNotThrow(() => assertNotPrerendered({ routes: {} }, "constructor"));
  assert.doesNotThrow(() => assertNotPrerendered({ routes: {} }, "toString"));
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
