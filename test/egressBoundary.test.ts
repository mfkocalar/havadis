import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * PLAT-06, SAFE-01, T-14-15, T-14-60: every network call leaves through `src/lib/egress`, and no
 * web-side module can reach that directory through any chain of value imports. Two gates:
 *
 * 1. A text scan of every non-test file under `src` outside `src/lib/egress`: no bare `fetch(`,
 *    no import of undici, http, https, dns, tls or dgram, nothing from net beyond the pure IP
 *    helpers, no import that reaches into `test/`, and no direct import of `lib/egress` from
 *    web-side code.
 * 2. A walk of the import graph from every web-side entry file that names the full chain of any
 *    path into `src/lib/egress`.
 *
 * Both are text-based, so a comment elsewhere under `src` must not quote an import statement or a
 * bare call: such a comment is flagged too (the scan fails safe). Dynamic imports with a
 * non-literal specifier cannot be followed; none exist under `src`.
 */

const ROOT = process.cwd();
const CODE_EXT = /\.(?:ts|tsx|js|mjs)$/;
const EGRESS_DIR = "src/lib/egress/";
const WEB_SIDE_DIRS = ["src/app/", "src/components/", "src/lib/adapters/", "src/lib/feeds/"];
const WEB_SIDE_FILES = ["src/proxy.ts", "src/instrumentation.ts"];

/**
 * Files the walk does not descend into. Empty since Plan 12 deleted `src/lib/snapshot.ts`, the last
 * build-time path that reached the network: the walk now runs from every web-side entry with no
 * exemption. The existence test below passes vacuously while the list is empty and still fails if a
 * listed file is ever deleted, so an exemption cannot outlive its file.
 */
const INTERIM_EXEMPT: readonly string[] = [];

// ---------------------------------------------------------------------------------------------
// Statement extraction
// ---------------------------------------------------------------------------------------------

type ImportStatement = {
  specifier: string;
  /** `import type` or `export type`: erased at build time, so no runtime edge. */
  typeOnly: boolean;
  /** The text between the keyword and `from`; empty for side-effect, dynamic and require forms. */
  clause: string;
};

function stripComments(text: string): string {
  const withoutBlocks = text.replace(/\/\*[\s\S]*?\*\//g, " ");
  return withoutBlocks
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*");
    })
    .join("\n");
}

const IMPORT_FROM =
  /\bimport\s+(type\s+)?((?:[\w$]+\s*,?\s*)?(?:\*\s*as\s+[\w$]+|\{[^}]*\})?)\s*from\s*["']([^"'\n]+)["']/g;
const EXPORT_FROM =
  /\bexport\s+(type\s+)?(\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*["']([^"'\n]+)["']/g;
const IMPORT_SIDE_EFFECT = /\bimport\s*["']([^"'\n]+)["']/g;
const DYNAMIC_OR_REQUIRE = /\b(?:import|require)\s*\(\s*["'`]([^"'`\n]+)["'`]\s*\)/g;

function statementsIn(text: string): ImportStatement[] {
  const code = stripComments(text);
  const out: ImportStatement[] = [];
  for (const m of code.matchAll(IMPORT_FROM)) {
    out.push({ specifier: m[3], typeOnly: m[1] !== undefined, clause: m[2].trim() });
  }
  for (const m of code.matchAll(EXPORT_FROM)) {
    out.push({ specifier: m[3], typeOnly: m[1] !== undefined, clause: m[2].trim() });
  }
  for (const m of code.matchAll(IMPORT_SIDE_EFFECT)) {
    out.push({ specifier: m[1], typeOnly: false, clause: "" });
  }
  for (const m of code.matchAll(DYNAMIC_OR_REQUIRE)) {
    out.push({ specifier: m[1], typeOnly: false, clause: "" });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Text-scan offences
// ---------------------------------------------------------------------------------------------

const BARE_FETCH = /\bfetch\s*\(/;
const NETWORK_MODULE = /^(?:node:)?(?:undici|http|https|dns|tls|dgram)(?:\/.*)?$/;
const NET_MODULE = /^(?:node:)?net$/;
const PURE_NET_NAMES: ReadonlySet<string> = new Set(["isIP", "isIPv4", "isIPv6"]);

/** True when a `net` import clause names only the pure IP helpers. */
function isPureNetClause(clause: string): boolean {
  const braces = /^\{([^}]*)\}$/.exec(clause);
  if (!braces) return false;
  const names = braces[1]
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n !== "");
  return names.length > 0 && names.every((n) => PURE_NET_NAMES.has(n));
}

function isWebSide(file: string): boolean {
  return WEB_SIDE_DIRS.some((d) => file.startsWith(d)) || WEB_SIDE_FILES.includes(file);
}

/** The offence labels found in one file's text; `file` is root-relative with forward slashes. */
function offencesIn(text: string, file: string): string[] {
  const found: string[] = [];
  if (BARE_FETCH.test(stripComments(text))) found.push("bare-fetch");
  for (const s of statementsIn(text)) {
    if (NETWORK_MODULE.test(s.specifier)) found.push(`network-module:${s.specifier}`);
    if (NET_MODULE.test(s.specifier) && !isPureNetClause(s.clause)) found.push(`net-import:${s.specifier}`);
    if (s.specifier.startsWith(".")) {
      const resolved = path.posix.join(path.posix.dirname(file), s.specifier);
      if (resolved === "test" || resolved.startsWith("test/")) found.push(`test-import:${s.specifier}`);
    }
    if (isWebSide(file) && s.specifier.includes("lib/egress")) found.push(`egress-import:${s.specifier}`);
  }
  return found;
}

test("the matcher catches each offence and ignores look-alikes", () => {
  const lib = "src/lib/x.ts";
  const web = "src/app/x.ts";
  const positives: Array<[string, string, string]> = [
    ["const r = await fetch(url);", lib, "bare-fetch"],
    ["const r = await fetch (url);", lib, "bare-fetch"],
    ['import { Agent } from "undici";', lib, "network-module:undici"],
    ['import http from "node:http";', lib, "network-module:node:http"],
    ['import https from "https";', lib, "network-module:https"],
    ['import { lookup } from "node:dns/promises";', lib, "network-module:node:dns/promises"],
    ['const tls = require("tls");', lib, "network-module:tls"],
    ['const d = await import("node:dgram");', lib, "network-module:node:dgram"],
    ['import "node:http";', lib, "network-module:node:http"],
    ['import net from "node:net";', lib, "net-import:node:net"],
    ['import { isIP, connect } from "net";', lib, "net-import:net"],
    ['import * as net from "node:net";', lib, "net-import:node:net"],
    ['import { makeLoopbackFetch } from "../../test/fixtures/loopbackFetch.ts";', lib, "test-import:../../test/fixtures/loopbackFetch.ts"],
    ['import { safeFetch } from "../lib/egress/safeFetch.ts";', web, "egress-import:../lib/egress/safeFetch.ts"],
    ['export { safeFetch } from "@/lib/egress/safeFetch";', web, "egress-import:@/lib/egress/safeFetch"],
  ];
  for (const [text, file, label] of positives) {
    assert.ok(offencesIn(text, file).includes(label), `should flag ${label}: ${text}`);
  }

  const negatives: Array<[string, string]> = [
    ["const r = await safeFetch(url);", lib],
    ["const r = await boundedFetchJson(url, opts);", lib],
    ["const r = await fetcher(url);", lib],
    ["// fetch(url) is only mentioned here", lib],
    [" * the request does not call fetch(url) directly", lib],
    ["/* fetch(url) */ const x = 1;", lib],
    ['import { isIP } from "node:net";', lib],
    ['import { isIP, isIPv4, isIPv6 } from "net";', lib],
    ['import { createServer } from "node:http2";', lib],
    ['import { x } from "./test/helpers.ts";', "src/lib/pipeline/x.ts"],
    ['import { safeFetch } from "../egress/safeFetch.ts";', "src/lib/pipeline/x.ts"],
    ['import { x } from "../test.ts";', "src/lib/x.ts"],
  ];
  for (const [text, file] of negatives) {
    assert.deepStrictEqual(offencesIn(text, file), [], `should not flag: ${text}`);
  }
});

// ---------------------------------------------------------------------------------------------
// Import-graph walk
// ---------------------------------------------------------------------------------------------

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function isFile(abs: string): boolean {
  return existsSync(abs) && statSync(abs).isFile();
}

/** Resolves one specifier from `fromFile` (root-relative) to a root-relative code file, or null. */
function resolveSpecifier(root: string, fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = path.join(root, "src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.join(root, path.dirname(fromFile), specifier);
  } else {
    return null;
  }
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (CODE_EXT.test(candidate) && isFile(candidate)) return toPosix(path.relative(root, candidate));
  }
  return null;
}

function listCodeFiles(dirAbs: string): string[] {
  if (!existsSync(dirAbs)) return [];
  return readdirSync(dirAbs, { recursive: true, encoding: "utf8" })
    .filter((name) => CODE_EXT.test(name))
    .map((name) => path.join(dirAbs, name))
    .filter(isFile);
}

/** Every non-test code file under src, root-relative. */
function sourceFilesUnder(root: string): string[] {
  return listCodeFiles(path.join(root, "src"))
    .map((abs) => toPosix(path.relative(root, abs)))
    .filter((rel) => !rel.endsWith(".test.ts"))
    .sort();
}

function webSideEntries(root: string): string[] {
  const entries = sourceFilesUnder(root).filter((rel) => WEB_SIDE_DIRS.some((d) => rel.startsWith(d)));
  for (const f of WEB_SIDE_FILES) if (isFile(path.join(root, f))) entries.push(f);
  return entries.sort();
}

/**
 * Walks value imports from `entries` and returns one chain (entry, each hop, egress file) per
 * reachable file under src/lib/egress. Type-only edges are not followed, and the walk does not
 * descend into `exempt` files or into the egress directory itself.
 */
function egressChains(root: string, entries: readonly string[], exempt: readonly string[]): string[][] {
  const parent = new Map<string, string | null>();
  const queue: string[] = [];
  for (const entry of entries) {
    if (!parent.has(entry)) {
      parent.set(entry, null);
      queue.push(entry);
    }
  }
  const chains: string[][] = [];
  const chainTo = (file: string): string[] => {
    const chain: string[] = [];
    for (let cur: string | null | undefined = file; cur != null; cur = parent.get(cur)) chain.unshift(cur);
    return chain;
  };
  for (let i = 0; i < queue.length; i++) {
    const file = queue[i];
    if (file.startsWith(EGRESS_DIR)) {
      chains.push(chainTo(file));
      continue;
    }
    if (exempt.includes(file)) continue;
    const text = readFileSync(path.join(root, file), "utf8");
    for (const s of statementsIn(text)) {
      if (s.typeOnly) continue;
      const next = resolveSpecifier(root, file, s.specifier);
      if (next === null || parent.has(next)) continue;
      parent.set(next, file);
      queue.push(next);
    }
  }
  return chains;
}

function withTree<T>(files: Record<string, string>, body: (root: string) => T): T {
  const root = mkdtempSync(path.join(tmpdir(), "egress-walk-"));
  try {
    for (const [rel, text] of Object.entries(files)) {
      const abs = path.join(root, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, text);
    }
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const EGRESS_FILE = { "src/lib/egress/safeFetch.ts": "export const safeFetch = 1;\n" };

test("walker: a two-hop chain into an egress file is reported with that chain", () => {
  withTree(
    {
      ...EGRESS_FILE,
      "src/app/page.ts": 'import { mid } from "@/lib/mid";\nexport const p = mid;\n',
      "src/lib/mid.ts": 'import { safeFetch } from "./egress/safeFetch";\nexport const mid = safeFetch;\n',
    },
    (root) => {
      assert.deepStrictEqual(egressChains(root, ["src/app/page.ts"], []), [
        ["src/app/page.ts", "src/lib/mid.ts", "src/lib/egress/safeFetch.ts"],
      ]);
    }
  );
});

test("walker: an import type edge is not followed", () => {
  withTree(
    {
      ...EGRESS_FILE,
      "src/app/page.ts": 'import type { safeFetch } from "@/lib/egress/safeFetch";\nexport type T = typeof safeFetch;\n',
    },
    (root) => {
      assert.deepStrictEqual(egressChains(root, ["src/app/page.ts"], []), []);
    }
  );
});

test("walker: a dynamic import() edge is followed", () => {
  withTree(
    {
      ...EGRESS_FILE,
      "src/app/page.ts": 'export const load = () => import("@/lib/egress/safeFetch");\n',
    },
    (root) => {
      assert.deepStrictEqual(egressChains(root, ["src/app/page.ts"], []), [
        ["src/app/page.ts", "src/lib/egress/safeFetch.ts"],
      ]);
    }
  );
});

test("walker: a chain through an exempt file is not reported", () => {
  withTree(
    {
      ...EGRESS_FILE,
      "src/app/page.ts": 'import { snap } from "@/lib/snapshot";\nexport const p = snap;\n',
      "src/lib/snapshot.ts": 'import { safeFetch } from "./egress/safeFetch";\nexport const snap = safeFetch;\n',
    },
    (root) => {
      assert.deepStrictEqual(egressChains(root, ["src/app/page.ts"], ["src/lib/snapshot.ts"]), []);
      assert.equal(egressChains(root, ["src/app/page.ts"], []).length, 1, "the same tree is an offence without the exemption");
    }
  );
});

// ---------------------------------------------------------------------------------------------
// The real tree
// ---------------------------------------------------------------------------------------------

test("every INTERIM_EXEMPT file still exists, so deleting it forces the list to be emptied", () => {
  for (const file of INTERIM_EXEMPT) {
    assert.ok(isFile(path.join(ROOT, file)), `${file} is gone: delete it from INTERIM_EXEMPT in test/egressBoundary.test.ts`);
  }
});

test("no file under src outside src/lib/egress uses the network directly", () => {
  const offenders: string[] = [];
  for (const file of sourceFilesUnder(ROOT)) {
    if (file.startsWith(EGRESS_DIR)) continue;
    const found = offencesIn(readFileSync(path.join(ROOT, file), "utf8"), file);
    for (const label of found) offenders.push(`${file}: ${label}`);
  }
  assert.deepStrictEqual(offenders, []);
});

test("no web-side module reaches src/lib/egress through any chain of value imports", () => {
  const entries = webSideEntries(ROOT);
  assert.ok(entries.length > 0, "no web-side entry files were found");
  const offenders = egressChains(ROOT, entries, INTERIM_EXEMPT).map((chain) => chain.join(" -> "));
  assert.deepStrictEqual(offenders, []);
});
