import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Pins the three cached arrow callbacks in src/lib/snapshot.ts (PLAT-04, F2).
 * `unstable_cache` derives its key from the callback's SOURCE TEXT plus the
 * key parts plus the arguments, so editing an arrow, or moving
 * `produceSsvcLogged` into another file, changes the key and cold-starts the
 * shared cache. The budget lines therefore live inside the producers, never in
 * the arrows.
 *
 * It is a text scan, not a module import: `src/lib/snapshot.ts` cannot load
 * under `node --test` (it imports `next/cache`). It passes at HEAD by design:
 * it is a regression pin, so it is not a RED test.
 */

const SNAPSHOT = readFileSync(path.join(process.cwd(), "src/lib/snapshot.ts"), "utf8");

const ARROWS = [
  "cachedSnapshot(EDITION_CACHE_KEY, () => produceEdition(Date.now()));",
  "cachedSnapshot(KEV_CACHE_KEY, () => produceKev(Date.now()), {",
  "cachedLookup(SSVC_CACHE_KEY, (id: string) => produceSsvcLogged(id), {",
];

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

for (const arrow of ARROWS) {
  test(`the cached arrow appears exactly once, unchanged: ${arrow}`, () => {
    assert.equal(occurrences(SNAPSHOT, arrow), 1);
  });
}

test("produceSsvcLogged stays declared locally in snapshot.ts", () => {
  assert.equal(
    occurrences(SNAPSHOT, "async function produceSsvcLogged(id: string): Promise<CacheableSsvcState> {"),
    1
  );
  assert.ok(!/import[^;]*\bproduceSsvcLogged\b/.test(SNAPSHOT), "produceSsvcLogged is never imported");
});
