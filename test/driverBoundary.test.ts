import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Carried-forward lock: better-sqlite3 sits behind a driver seam. Only src/lib/db/openDb.ts loads it
 * at runtime, so every connection gets the same pragmas and the BEGIN IMMEDIATE dialect (T-14-53).
 *
 * Offences:
 *   (a) any import, require or dynamic import of better-sqlite3, type-only or not, in a file outside
 *       src/lib/db/;
 *   (b) a non-type import, require or dynamic import of better-sqlite3 in a file inside src/lib/db/
 *       other than openDb.ts (a type-only `import type` is fine there).
 *
 * This is a text scan, not a module import, so a comment under src that quotes an import statement of
 * the module is flagged too (the scan fails safe). Plans 06, 11, 13, 14 and 15 run it in their
 * verify so restore, selftest, health and the web code stay behind openDb.
 */

const SRC = path.join(process.cwd(), "src");
const DB_DIR = "src/lib/db/";
const DRIVER_FILE = "src/lib/db/openDb.ts";

const SPECIFIER = String.raw`["'\x60]better-sqlite3(?:/[^"'\x60]*)?["'\x60]`;
// An import form (`from`, `import <ws>`, `import(` or `require(`) immediately followed by the specifier.
const IMPORT_RE = new RegExp(
  String.raw`(?:\bfrom\s*|\bimport\s+|\b(?:import|require)\s*\(\s*)` + SPECIFIER,
  "g",
);

const SOURCE_EXT = /\.(?:ts|tsx|js|mjs)$/;

type Use = { typeOnly: boolean };

/** Every place `text` loads or references better-sqlite3, with whether the statement is `import type`. */
function driverUses(text: string): Use[] {
  const uses: Use[] = [];
  for (const match of text.matchAll(IMPORT_RE)) {
    const before = text.slice(0, match.index);
    // The statement starts at the closest import or export keyword before the specifier.
    const start = Math.max(before.lastIndexOf("import"), before.lastIndexOf("export"));
    const statement = start === -1 ? "" : text.slice(start, match.index);
    const dynamic = /(?:import|require)\s*\(\s*$/.test(statement);
    uses.push({ typeOnly: !dynamic && /^(?:import|export)\s+type\b/.test(statement) });
  }
  return uses;
}

function offence(file: string, text: string): boolean {
  const uses = driverUses(text);
  if (uses.length === 0 || file === DRIVER_FILE) return false;
  if (!file.startsWith(DB_DIR)) return true;
  return uses.some((use) => !use.typeOnly);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => SOURCE_EXT.test(name) && !name.endsWith(".test.ts"))
    .map((name) => path.join(dir, name));
}

test("the matcher catches every import form and ignores mere mentions", () => {
  const positives = [
    'import Database from "better-sqlite3";',
    'import type { Database } from "better-sqlite3";',
    'const Database = require("better-sqlite3");',
    'const { default: Database } = await import("better-sqlite3");',
    "import Database from 'better-sqlite3';",
    'import type {\n  Database,\n  Statement,\n} from "better-sqlite3";',
  ];
  for (const text of positives) {
    assert.ok(driverUses(text).length > 0, `should match: ${text}`);
  }

  const negatives = [
    "// better-sqlite3 is the driver behind openDb",
    'import thing from "not-better-sqlite3-at-all";',
    'import helper from "@scope/better-sqlite3-helpers";',
  ];
  for (const text of negatives) {
    assert.equal(driverUses(text).length, 0, `should not match: ${text}`);
  }
});

test("the matcher tells a type-only import from a runtime load", () => {
  assert.deepEqual(driverUses('import type { Database } from "better-sqlite3";'), [{ typeOnly: true }]);
  assert.deepEqual(driverUses('import type {\n  Database,\n} from "better-sqlite3";'), [{ typeOnly: true }]);
  assert.deepEqual(driverUses('import Database from "better-sqlite3";'), [{ typeOnly: false }]);
  // Under verbatimModuleSyntax an inline `type` specifier still loads the module.
  assert.deepEqual(driverUses('import { type Database } from "better-sqlite3";'), [{ typeOnly: false }]);
  assert.deepEqual(driverUses('const D = require("better-sqlite3");'), [{ typeOnly: false }]);
  assert.deepEqual(driverUses('const D = await import("better-sqlite3");'), [{ typeOnly: false }]);
});

test("the offence rules: openDb may load it, src/lib/db may import its types, nothing else may touch it", () => {
  const runtime = 'import Database from "better-sqlite3";';
  const typeOnly = 'import type { Database } from "better-sqlite3";';
  assert.equal(offence("src/lib/db/openDb.ts", runtime), false);
  assert.equal(offence("src/lib/db/schemaVersion.ts", typeOnly), false);
  assert.equal(offence("src/lib/db/migrator.ts", runtime), true);
  assert.equal(offence("src/lib/worker/cycle.ts", typeOnly), true);
  assert.equal(offence("src/lib/worker/cycle.ts", runtime), true);
  assert.equal(offence("src/app/api/health/route.ts", 'const D = await import("better-sqlite3");'), true);
  assert.equal(offence("src/lib/worker/cycle.ts", "// better-sqlite3 stays behind openDb"), false);
});

test("better-sqlite3 is loaded only by src/lib/db/openDb.ts", () => {
  const files = sourceFiles(SRC);
  assert.ok(files.length > 0, "the scan found no source files");
  const offenders = files
    .map((file) => ({ file: path.relative(process.cwd(), file).split(path.sep).join("/"), text: readFileSync(file, "utf8") }))
    .filter(({ file, text }) => offence(file, text))
    .map(({ file }) => file)
    .sort();
  assert.deepEqual(offenders, [], `better-sqlite3 must stay behind src/lib/db/openDb.ts; offenders: ${offenders.join(", ")}`);
  const driver = readFileSync(path.join(process.cwd(), DRIVER_FILE), "utf8");
  assert.ok(driverUses(driver).some((use) => !use.typeOnly), "openDb.ts is the module that loads the driver");
});
