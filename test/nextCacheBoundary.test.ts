import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Standing gate against the Vercel-era cache paths (PLAT-13, T-14-61). Plan 12 retired the shared
 * snapshot, so the forbidden set has no allowed file any more: nothing under `src` may
 *
 * 1. import `next/cache` (or its `next/dist` unstable-cache and revalidate internals),
 * 2. import or require `unstable_cache` from any module,
 * 3. export `dynamic = "force-static"`, or
 * 4. export `revalidate`, `generateStaticParams` or `dynamicParams`.
 *
 * Every page and route reads SQLite per request, so a prerendered or ISR-cached route would serve a
 * stale edition and freeze its first read at build time.
 *
 * These are text scans over every source file under `src`, test files included, not module imports.
 * Because they are text-based, a comment that quotes one of these statements is flagged too (the
 * scan fails safe); comments may name the words but must not spell the statement. Each matcher has
 * positive and negative self-test samples so a regex that silently stopped matching fails here.
 */

const SRC = path.join(process.cwd(), "src");

// An import form (`from`, `import <ws>`, `import(` or `require(`) immediately
// followed by a quoted next/cache specifier, or a next/dist path to its
// unstable-cache or revalidate internals.
const IMPORT_RE =
  /(?:\bfrom\s*|\bimport\s+|\b(?:import|require)\s*\(\s*)["'`](?:next\/cache(?:\.js)?|next\/dist\/[^"'`]*(?:unstable-cache|revalidate)[^"'`]*)["'`]/;

// A named import (or re-export) whose braces list unstable_cache, from any module path, or a
// destructuring of a require or dynamic import that does.
const UNSTABLE_CACHE_RE =
  /\b(?:import|export)\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{[^}]*\bunstable_cache\b[^}]*\}\s*from\b|\b(?:const|let|var)\s*\{[^}]*\bunstable_cache\b[^}]*\}\s*=\s*(?:await\s+)?(?:require|import)\s*\(/;

// `export const dynamic = "force-static"` in any quote style, with or without a type annotation.
const FORCE_STATIC_RE = /\bexport\s+const\s+dynamic\s*(?::[^=;]+)?=\s*["'`]force-static["'`]/;

// The route-segment exports that make a route static or ISR-cached.
const FORBIDDEN_EXPORTS = ["revalidate", "generateStaticParams", "dynamicParams"] as const;
const FORBIDDEN_EXPORT_NAMES = FORBIDDEN_EXPORTS.join("|");
const DECLARED_EXPORT_RE = new RegExp(
  `\\bexport\\s+(?:(?:const|let|var)\\s+|(?:async\\s+)?function\\s*\\*?\\s*)(?:${FORBIDDEN_EXPORT_NAMES})\\b`,
);
const EXPORT_LIST_RE = /\bexport\s*(?:type\s*)?\{([^}]*)\}/g;

/**
 * True when the text exports one of the forbidden names: as an `export const`, `let` or `var`; as an
 * `export function` or `export async function`; or in an `export { ... }` list under the exported
 * name, so `export { x as revalidate }` counts and `export { revalidate as x }` does not.
 */
function exportsForbiddenSegmentConfig(text: string): boolean {
  if (DECLARED_EXPORT_RE.test(text)) return true;
  for (const match of text.matchAll(EXPORT_LIST_RE)) {
    for (const entry of match[1]!.split(",")) {
      const parts = entry.trim().split(/\s+as\s+/);
      const exported = (parts[1] ?? parts[0] ?? "").trim().replace(/^["']|["']$/g, "");
      if ((FORBIDDEN_EXPORTS as readonly string[]).includes(exported)) return true;
    }
  }
  return false;
}

type Matcher = { label: string; test: (text: string) => boolean };

const MATCHERS: readonly Matcher[] = [
  { label: "next/cache import", test: (text) => IMPORT_RE.test(text) },
  { label: "unstable_cache import", test: (text) => UNSTABLE_CACHE_RE.test(text) },
  { label: 'force-static route export', test: (text) => FORCE_STATIC_RE.test(text) },
  { label: "revalidate, generateStaticParams or dynamicParams export", test: exportsForbiddenSegmentConfig },
];

const [NEXT_CACHE, UNSTABLE_CACHE, FORCE_STATIC, SEGMENT_EXPORT] = MATCHERS as [Matcher, Matcher, Matcher, Matcher];

const SOURCE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts)$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => SOURCE_EXT.test(name))
    .map((name) => path.join(dir, name));
}

function checkSamples(matcher: Matcher, positives: string[], negatives: string[]): void {
  for (const text of positives) assert.ok(matcher.test(text), `${matcher.label} should match: ${text}`);
  for (const text of negatives) assert.ok(!matcher.test(text), `${matcher.label} should not match: ${text}`);
}

test("the next/cache matcher catches every import form and ignores mere mentions", () => {
  checkSamples(
    NEXT_CACHE,
    [
      'import { unstable_cache } from "next/cache";',
      'import "next/cache";',
      'export { unstable_cache } from "next/cache";',
      'const c = require("next/cache");',
      "const c = await import(`next/cache`);",
      'import { unstable_cache } from "next/dist/server/web/spec-extension/unstable-cache";',
    ],
    ['// "next/cache" is only mentioned here, with no import syntax', 'import Link from "next/link";'],
  );
});

test("the unstable_cache matcher catches named imports and requires from any module and ignores mentions", () => {
  checkSamples(
    UNSTABLE_CACHE,
    [
      'import { unstable_cache } from "./cache.ts";',
      'import { revalidateTag, unstable_cache } from "some-wrapper";',
      'import { unstable_cache as cached } from "../lib/wrapper";',
      'import type { unstable_cache } from "x";',
      'import {\n  other,\n  unstable_cache,\n} from "y";',
      'export { unstable_cache } from "z";',
      'const { unstable_cache } = require("next/cache");',
      'const { a, unstable_cache: u } = require("./wrap");',
      'const { unstable_cache } = await import("./wrap");',
    ],
    [
      "// unstable_cache is only named in this comment",
      'import { cache } from "react";',
      'import { unstable_noStore } from "x";',
      "const unstable_cache = 1;",
      'import { cached_unstable_cache_x } from "y";',
    ],
  );
});

test("the force-static matcher catches the route export in any quote style and ignores force-dynamic", () => {
  checkSamples(
    FORCE_STATIC,
    [
      'export const dynamic = "force-static";',
      "export const dynamic = 'force-static'",
      "export const dynamic = `force-static`;",
      'export const dynamic: "auto" | "force-static" = "force-static";',
      'export  const   dynamic="force-static";',
    ],
    [
      "// the route used to be force-static",
      'export const dynamic = "force-dynamic";',
      'const dynamic = "force-static";',
      'export const mode = "force-static";',
    ],
  );
});

test("the segment-export matcher catches const, let, var, function and list exports, including renames", () => {
  checkSamples(
    SEGMENT_EXPORT,
    [
      "export const revalidate = 900;",
      "export let revalidate = 900;",
      "export var dynamicParams = false;",
      "export const generateStaticParams = () => [];",
      "export function generateStaticParams() { return []; }",
      "export async function generateStaticParams() { return []; }",
      "export function* generateStaticParams() {}",
      "const x = 1;\nexport { x as revalidate };",
      "export { a, b as dynamicParams, c };",
      "export { revalidate };",
      'export { x as "revalidate" };',
      'export { revalidate } from "./segment";',
      "export {\n  dynamicParams,\n};",
    ],
    [
      "// the route no longer sets revalidate, generateStaticParams or dynamicParams",
      'export const dynamic = "force-dynamic";',
      "const revalidate = 900;\nexport default revalidate;",
      "let revalidate = 1;",
      "export { revalidate as refreshWindow };",
      "export const revalidateTag = 1;",
      "export function generateStaticParamsFor() {}",
      "export { dynamicParamsOnly };",
    ],
  );
});

test("no source file under src uses a forbidden cache or static-route pattern", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    const relative = path.relative(process.cwd(), file).split(path.sep).join("/");
    for (const matcher of MATCHERS) {
      if (matcher.test(text)) offenders.push(`${relative}: ${matcher.label}`);
    }
  }
  assert.deepStrictEqual(offenders.sort(), []);
});
