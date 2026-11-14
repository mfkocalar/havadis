import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUDGET_PREFIX,
  formatBudgetLine,
  parseBudgetLine,
  renderReadOps,
  withBudgetLine,
  type BudgetLine,
} from "./budgetLine.ts";
import type { EnrichmentHealth } from "./types.ts";

/**
 * Hermetic tests of the budget line (PLAT-04, D-02, D-13): an injected `emit`
 * collects lines, so nothing touches the console, the network or the clock
 * policy of any producer.
 */

const BASE: BudgetLine = {
  p: "edition",
  ok: 1,
  ms: 812,
  cpuMs: 371,
  n: 143,
  bytes: 205367,
  rcW: 1,
  rcR: 0,
  kvCmd: 0,
};

const PRODUCERS: BudgetLine[] = [
  BASE,
  { ...BASE, p: "kev", n: 1500, bytes: 180000 },
  { ...BASE, p: "ssvc", n: 1, bytes: 90, st: "assessed" },
  { ...BASE, p: "epss", n: 120, bytes: 40000, rcW: 3 },
  { ...BASE, p: "render", n: 120, bytes: 0, rcW: 0, rcR: 19 },
];

/** A line as the wire would carry it, with a caller-controlled object. */
function wire(obj: Record<string, unknown>): string {
  return `${BUDGET_PREFIX}${JSON.stringify(obj)}`;
}

for (const line of PRODUCERS) {
  test(`round trip: a ${line.p} line parses back to an equal object`, () => {
    const text = formatBudgetLine(line);
    assert.ok(text.startsWith("budget {"), "fixed prefix");
    assert.deepStrictEqual(parseBudgetLine(text), line);
  });
}

test("format: keys appear in the fixed order, with st last on ssvc lines only", () => {
  const edition = JSON.parse(formatBudgetLine(BASE).slice(BUDGET_PREFIX.length)) as object;
  assert.deepStrictEqual(Object.keys(edition), [
    "p", "ok", "ms", "cpuMs", "n", "bytes", "rcW", "rcR", "kvCmd",
  ]);
  const ssvc = JSON.parse(formatBudgetLine(PRODUCERS[2]).slice(BUDGET_PREFIX.length)) as object;
  assert.deepStrictEqual(Object.keys(ssvc), [
    "p", "ok", "ms", "cpuMs", "n", "bytes", "rcW", "rcR", "kvCmd", "st",
  ]);
});

test("format: st on a non-ssvc input is dropped and a missing st on ssvc becomes failed", () => {
  const withSt = formatBudgetLine({ ...BASE, st: "assessed" });
  assert.equal(parseBudgetLine(withSt)?.st, undefined);
  const noSt = formatBudgetLine({ ...BASE, p: "ssvc" });
  assert.equal(parseBudgetLine(noSt)?.st, "failed");
});

test("format: NaN, Infinity and negatives become 0 and floats are rounded", () => {
  const text = formatBudgetLine({
    ...BASE,
    ms: Number.NaN,
    cpuMs: Number.POSITIVE_INFINITY,
    n: -5,
    bytes: 12.6,
    rcW: 2.4,
  });
  const parsed = parseBudgetLine(text);
  assert.ok(parsed);
  assert.equal(parsed.ms, 0);
  assert.equal(parsed.cpuMs, 0);
  assert.equal(parsed.n, 0);
  assert.equal(parsed.bytes, 13);
  assert.equal(parsed.rcW, 2);
});

test("format: ok is 1 only when it is exactly 1", () => {
  const odd = formatBudgetLine({ ...BASE, ok: 2 as unknown as 1 });
  assert.equal(parseBudgetLine(odd)?.ok, 0);
});

const OK_FIELDS = { ...BASE } as Record<string, unknown>;
const BAD_CASES: Array<[string, string]> = [
  ["an empty string", ""],
  ["a missing prefix", JSON.stringify(OK_FIELDS)],
  ["text before the prefix", `x ${wire(OK_FIELDS)}`],
  ["an extra key", wire({ ...OK_FIELDS, extra: 1 })],
  ["a missing key", wire(Object.fromEntries(Object.entries(OK_FIELDS).filter(([k]) => k !== "kvCmd")))],
  [
    "keys out of order",
    wire({ p: "edition", ok: 1, ms: 1, cpuMs: 1, bytes: 1, n: 1, rcW: 1, rcR: 0, kvCmd: 0 }),
  ],
  ["a __proto__ key", `${BUDGET_PREFIX}{"__proto__":{},"p":"edition","ok":1,"ms":1,"cpuMs":1,"n":1,"bytes":1,"rcW":1,"rcR":0,"kvCmd":0}`],
  ["a string number", wire({ ...OK_FIELDS, ms: "812" })],
  ["a negative number", wire({ ...OK_FIELDS, ms: -1 })],
  ["a float", wire({ ...OK_FIELDS, ms: 1.5 })],
  ["ok equal to 2", wire({ ...OK_FIELDS, ok: 2 })],
  ["an unknown producer", wire({ ...OK_FIELDS, p: "nope" })],
  ["st on a non-ssvc line", wire({ ...OK_FIELDS, st: "assessed" })],
  ["an ssvc line without st", wire({ ...OK_FIELDS, p: "ssvc" })],
  ["trailing text after the JSON", `${wire(OK_FIELDS)} tail`],
  ["an array instead of an object", `${BUDGET_PREFIX}[1,2,3]`],
  ["invalid JSON", `${BUDGET_PREFIX}{"p":`],
];
for (const [name, text] of BAD_CASES) {
  test(`parse: returns null for ${name}`, () => {
    assert.equal(parseBudgetLine(text), null);
  });
}

test("parse: an ssvc line with an unknown st is rejected", () => {
  assert.equal(parseBudgetLine(wire({ ...OK_FIELDS, p: "ssvc", st: "weird" })), null);
});

test("parse: trailing whitespace is tolerated", () => {
  assert.deepStrictEqual(parseBudgetLine(`${formatBudgetLine(BASE)}\n`), BASE);
});

test("withBudgetLine on success: one line, counts from describe, the identical value", async () => {
  const lines: string[] = [];
  const value = { articles: [1, 2, 3] };
  const out = await withBudgetLine(
    "edition",
    async () => value,
    (v) => ({ n: v.articles.length, bytes: 77, rcW: 1 }),
    (l) => lines.push(l)
  );
  assert.equal(out, value);
  assert.equal(lines.length, 1);
  const parsed = parseBudgetLine(lines[0]);
  assert.ok(parsed);
  assert.equal(parsed.p, "edition");
  assert.equal(parsed.ok, 1);
  assert.equal(parsed.n, 3);
  assert.equal(parsed.bytes, 77);
  assert.equal(parsed.rcW, 1);
  assert.equal(parsed.rcR, 0);
  assert.equal(parsed.kvCmd, 0);
  assert.ok(Number.isSafeInteger(parsed.ms) && parsed.ms >= 0);
  assert.ok(Number.isSafeInteger(parsed.cpuMs) && parsed.cpuMs >= 0);
});

test("withBudgetLine: describe may set rcR, ok and st", async () => {
  const lines: string[] = [];
  await withBudgetLine(
    "ssvc",
    async () => 1,
    () => ({ n: 1, bytes: 2, rcW: 1, rcR: 5, ok: 0, st: "not-assessed" }),
    (l) => lines.push(l)
  );
  const parsed = parseBudgetLine(lines[0]);
  assert.equal(parsed?.rcR, 5);
  assert.equal(parsed?.ok, 0);
  assert.equal(parsed?.st, "not-assessed");
});

test("withBudgetLine on failure: ok 0 and zero counts, the identical error is rethrown", async () => {
  const lines: string[] = [];
  const err = new Error("boom");
  await assert.rejects(
    withBudgetLine(
      "kev",
      async () => {
        throw err;
      },
      () => ({ n: 9, bytes: 9, rcW: 9 }),
      (l) => lines.push(l)
    ),
    (thrown) => thrown === err
  );
  assert.equal(lines.length, 1);
  const parsed = parseBudgetLine(lines[0]);
  assert.ok(parsed);
  assert.equal(parsed.p, "kev");
  assert.equal(parsed.ok, 0);
  assert.equal(parsed.n, 0);
  assert.equal(parsed.bytes, 0);
  assert.equal(parsed.rcW, 0);
});

test("withBudgetLine on an ssvc failure marks st failed", async () => {
  const lines: string[] = [];
  await assert.rejects(
    withBudgetLine(
      "ssvc",
      async () => {
        throw new Error("x");
      },
      () => ({ n: 1, bytes: 1, rcW: 1 }),
      (l) => lines.push(l)
    )
  );
  assert.equal(parseBudgetLine(lines[0])?.st, "failed");
});

test("withBudgetLine never puts an error message, URL or CVE ID in the line", async () => {
  const lines: string[] = [];
  const err = new Error("fetch https://evil.example/CVE-2026-0001 failed");
  await assert.rejects(
    withBudgetLine(
      "ssvc",
      async () => {
        throw err;
      },
      () => ({ n: 1, bytes: 1, rcW: 1 }),
      (l) => lines.push(l)
    ),
    (thrown) => thrown === err
  );
  assert.equal(lines.length, 1);
  assert.ok(!lines[0].includes("evil"));
  assert.ok(!lines[0].includes("http"));
  assert.ok(!lines[0].includes("CVE-"));
  assert.notEqual(parseBudgetLine(lines[0]), null);
});

test("withBudgetLine: an emit that throws still resolves to the identical value", async () => {
  const value = { v: 1 };
  const out = await withBudgetLine(
    "edition",
    async () => value,
    () => ({ n: 1, bytes: 1, rcW: 1 }),
    () => {
      throw new Error("emit broke");
    }
  );
  assert.equal(out, value);
});

test("withBudgetLine: a describe that throws still resolves to the identical value", async () => {
  const value = { v: 1 };
  const out = await withBudgetLine(
    "edition",
    async () => value,
    () => {
      throw new Error("describe broke");
    },
    () => {}
  );
  assert.equal(out, value);
});

test("withBudgetLine: an emit that throws on failure still rethrows the producer's own error", async () => {
  const err = new Error("producer failed");
  await assert.rejects(
    withBudgetLine(
      "epss",
      async () => {
        throw err;
      },
      () => ({ n: 0, bytes: 0, rcW: 0 }),
      () => {
        throw new Error("emit broke");
      }
    ),
    (thrown) => thrown === err
  );
});

test("withBudgetLine: the default emit writes one console.info line", async (t) => {
  const info = t.mock.method(console, "info", () => {});
  await withBudgetLine(
    "kev",
    async () => 1,
    () => ({ n: 1, bytes: 1, rcW: 1 })
  );
  assert.equal(info.mock.calls.length, 1);
  assert.equal(parseBudgetLine(String(info.mock.calls[0].arguments[0]))?.p, "kev");
});

function health(ssvcRequested: number, epssRequested: number): EnrichmentHealth {
  return {
    kev: { status: "ok", fetchedAt: null },
    epss: { status: "ok", requested: epssRequested, unavailable: 0 },
    ssvc: { status: "ok", requested: ssvcRequested, unavailable: 0 },
  };
}

test("renderReadOps: 16 SSVC and 16 EPSS candidates model 19 reads", () => {
  assert.equal(renderReadOps(health(16, 16)), 19);
});

test("renderReadOps: SSVC lookups are capped at 100", () => {
  assert.equal(renderReadOps(health(150, 0)), 102);
});

test("renderReadOps: EPSS batches round up and are capped at 500 ids", () => {
  assert.equal(renderReadOps(health(0, 50)), 3);
  assert.equal(renderReadOps(health(0, 51)), 4);
  assert.equal(renderReadOps(health(0, 501)), 12);
});
