import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * D-13, D-15: the old production host never comes back into the repository.
 *
 * This is a text scan that fails safe: any repository text file naming the old
 * host is an offender, except one exact line. The old host is built from parts
 * below so this file never matches itself. The one exempt line is the
 * `HAVADIS_NS` export in `src/lib/feeds/buildFeed.ts`, an opaque RSS namespace
 * identifier that is never dereferenced; changing it would alter every feed's
 * XML namespace for existing subscribers.
 */

const ROOT = process.cwd();
const OLD_HOST = ["netlify", "app"].join(".");
const FORBIDDEN = new RegExp(OLD_HOST.replace(".", "\\."), "i");
const HAVADIS_NS_FILE = "src/lib/feeds/buildFeed.ts";
const HAVADIS_NS_LINE = `export const HAVADIS_NS = "https://havadis.${OLD_HOST}/ns/feed/1.0";`;

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".planning",
  ".claude",
  ".gsd",
  ".netlify",
  ".vercel",
  ".impeccable",
  "coverage",
  "out",
  "build",
]);
const TEXT_EXT = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|md|yml|yaml|json|css|html|txt|xml)$/;

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...walk(path.join(dir, entry.name)));
    } else if (entry.name !== "package-lock.json" && TEXT_EXT.test(entry.name)) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

function offendingLines(relPath: string, text: string): string[] {
  const offenders: string[] = [];
  for (const line of text.split("\n")) {
    if (!FORBIDDEN.test(line)) continue;
    if (relPath === HAVADIS_NS_FILE && line.trim() === HAVADIS_NS_LINE) continue;
    offenders.push(`${relPath}: ${line.trim()}`);
  }
  return offenders;
}

test("the matcher flags the old host and exempts only the exact HAVADIS_NS line", () => {
  assert.equal(offendingLines("README.md", `see https://havadis.${OLD_HOST}`).length, 1);
  assert.equal(offendingLines("README.md", `see HTTPS://HAVADIS.${OLD_HOST.toUpperCase()}`).length, 1);
  assert.deepStrictEqual(
    offendingLines(
      "src/lib/config/sources.ts",
      "// Netlify-egress probe 2026-11-02 (Netlify deploy, Next server function)",
    ),
    [],
  );
  assert.deepStrictEqual(offendingLines("README.md", "ignore the .netlify folder"), []);
  assert.deepStrictEqual(offendingLines("README.md", "https://havadis-news.vercel.app"), []);

  assert.deepStrictEqual(offendingLines(HAVADIS_NS_FILE, `  ${HAVADIS_NS_LINE}\n`), []);
  assert.equal(offendingLines(HAVADIS_NS_FILE, `const other = "https://x.${OLD_HOST}";`).length, 1);
  assert.equal(offendingLines("src/other.ts", HAVADIS_NS_LINE).length, 1);
});

test("no repository text file names the old host outside the HAVADIS_NS line", () => {
  const offenders: string[] = [];
  for (const file of walk(ROOT)) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    offenders.push(...offendingLines(rel, readFileSync(file, "utf8")));
  }
  assert.deepStrictEqual(offenders.sort(), []);
});
