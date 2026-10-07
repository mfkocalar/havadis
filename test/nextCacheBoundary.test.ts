import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * D-03: `next/cache` is imported in exactly one file, `src/lib/snapshot.ts`.
 * A second importer would be a second cache path, or a no-store fetch outside
 * the snapshot that flips `/` to dynamic.
 *
 * This is a text scan, not a module import: `src/lib/snapshot.ts` cannot load
 * under `node --test` (RESEARCH Pitfall 4). Because it is text-based, comments
 * elsewhere under `src` must not quote an import statement of the module; such
 * a comment is flagged too (the scan fails safe).
 */

const SRC = path.join(process.cwd(), "src");
const ALLOWED = "src/lib/snapshot.ts";

// An import form (`from`, `import <ws>`, `import(` or `require(`) immediately
// followed by a quoted next/cache specifier, or a next/dist path to its
// unstable-cache or revalidate internals.
const IMPORT_RE =
  /(?:\bfrom\s*|\bimport\s+|\b(?:import|require)\s*\(\s*)["'`](?:next\/cache(?:\.js)?|next\/dist\/[^"'`]*(?:unstable-cache|revalidate)[^"'`]*)["'`]/;

const SOURCE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts)$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => SOURCE_EXT.test(name))
    .map((name) => path.join(dir, name));
}

test("the matcher catches every import form and ignores mere mentions", () => {
  const positives = [
    'import { unstable_cache } from "next/cache";',
    'import "next/cache";',
    'export { unstable_cache } from "next/cache";',
    'const c = require("next/cache");',
    "const c = await import(`next/cache`);",
    'import { unstable_cache } from "next/dist/server/web/spec-extension/unstable-cache";',
  ];
  for (const text of positives) {
    assert.ok(IMPORT_RE.test(text), `should match: ${text}`);
  }

  const negatives = [
    '// "next/cache" is only mentioned here, with no import syntax',
    'import Link from "next/link";',
  ];
  for (const text of negatives) {
    assert.ok(!IMPORT_RE.test(text), `should not match: ${text}`);
  }
});

test("next/cache is imported only in src/lib/snapshot.ts, which does import it", () => {
  const offenders = sourceFiles(SRC)
    .filter((file) => IMPORT_RE.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(process.cwd(), file).split(path.sep).join("/"))
    .sort();
  assert.deepStrictEqual(offenders, [ALLOWED]);
});
