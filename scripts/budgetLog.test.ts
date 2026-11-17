import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseBudgetLine, type BudgetLine } from "../src/lib/budgetLine.ts";
import {
  acquireLock,
  coverage,
  dedupeKey,
  meterStatus,
  readUnits,
  renderTable,
  writeUnits,
  keysFromText,
  outPathProblem,
  readRows,
  takeNew,
  validateWindow,
  type BudgetRow,
  type PollRow,
  type RequestRow,
  type Row,
  parseRequestRecord,
  parseRuntimeRecord,
  parseSummaryRecord,
  rowsFromCliOutput,
} from "./budgetLog.ts";

/**
 * Parser and whitelist tests for the budget capture (PLAT-04, T-21-06). The
 * two fixtures are real `vercel logs` records (production, Plan 21-02) with
 * requestId and deploymentId replaced and fake visitor values, so the tests pin
 * the real record shape and prove the visitor fields are dropped.
 */

const RUNTIME_FIXTURE = readFileSync(
  new URL("./fixtures/budget-runtime-record.jsonl", import.meta.url),
  "utf8",
).trim();
const REQUEST_FIXTURE = readFileSync(
  new URL("./fixtures/budget-request-record.jsonl", import.meta.url),
  "utf8",
).trim();

test("parseRuntimeRecord reads the runtime fixture into a BudgetRow", () => {
  const row = parseRuntimeRecord(RUNTIME_FIXTURE);
  assert.ok(row);
  assert.equal(row.k, "budget");
  assert.equal(row.rid, "req_fixture_1");
  assert.equal(row.dep, "dpl_fixture");
  assert.equal(row.path, "/");
  assert.match(row.ts, /^\d{4}-\d{2}-\d{2}T/);
  const message = (JSON.parse(RUNTIME_FIXTURE) as { data: { message: string } }).data.message;
  assert.deepEqual(row.line, parseBudgetLine(message));
  assert.equal(row.line.p, "render");
});

test("parseRuntimeRecord returns null for anything that is not a budget log record", () => {
  const record = JSON.parse(RUNTIME_FIXTURE) as { type: string; data: { message: string } };
  const other = { ...record, data: { ...record.data, message: "something else" } };
  assert.equal(parseRuntimeRecord(JSON.stringify(other)), null);
  const malformed = { ...record, data: { ...record.data, message: "budget {not json" } };
  assert.equal(parseRuntimeRecord(JSON.stringify(malformed)), null);
  assert.equal(parseRuntimeRecord("not json at all"), null);
  assert.equal(parseRuntimeRecord(REQUEST_FIXTURE), null);
  assert.equal(parseRuntimeRecord('{"type":"summary"}'), null);
});

test("parseRequestRecord keeps exactly the seven request fields and no visitor value", () => {
  const row = parseRequestRecord(REQUEST_FIXTURE);
  assert.ok(row);
  assert.deepEqual(Object.keys(row), ["k", "ts", "rid", "path", "route", "status", "cache", "dep"]);
  assert.equal(row.status, 200);
  assert.equal(row.rid, "req_fixture_1");
  assert.equal(row.dep, "dpl_fixture");
  const text = JSON.stringify(row);
  assert.ok(!text.includes("ZZ"));
  assert.ok(!text.includes("fixture-agent"));
  assert.equal(parseRequestRecord(RUNTIME_FIXTURE), null);
  assert.equal(parseRequestRecord("not json at all"), null);
});

test("parseSummaryRecord reads the pagination and excluded intervals", () => {
  const summary = {
    type: "summary",
    recordsReturned: 3,
    timeRange: { start: "a", end: "b" },
    pagination: { hasMore: true, next: "cursor-1" },
    excludedIntervals: [{ start: "x", end: "y" }],
  };
  assert.deepEqual(parseSummaryRecord(JSON.stringify(summary)), {
    hasMore: true,
    next: "cursor-1",
    excluded: [{ start: "x", end: "y" }],
  });
  assert.equal(parseSummaryRecord(RUNTIME_FIXTURE), null);
  assert.equal(parseSummaryRecord("{"), null);
});

test("rowsFromCliOutput drops visitor keys, values and the query string from request rows", () => {
  const record = {
    type: "request",
    data: {
      timestamp: "2026-11-14T10:00:00.000Z",
      requestId: "r1",
      deploymentId: "d1",
      requestPath: "/feed.json?utm_source=x",
      route: "/feed.json",
      httpStatus: 200,
      cacheResult: "HIT",
      clientIpCountry: "DE",
      clientUserAgent: "Mozilla/5.0 (test)",
      clientIp: "203.0.113.7",
    },
  };
  const lines = rowsFromCliOutput(`${JSON.stringify(record)}\nnot json\n`, "requests");
  assert.equal(lines.length, 1);
  const text = lines[0];
  for (const needle of [
    "clientIpCountry",
    "clientUserAgent",
    "clientIp",
    "DE",
    "Mozilla",
    "203.0.113.7",
    "?",
  ]) {
    assert.ok(!text.includes(needle), `row must not contain ${needle}`);
  }
  assert.equal((JSON.parse(text) as { path: string }).path, "/feed.json");
});

test("rowsFromCliOutput keeps only the budget row fields from a runtime record", () => {
  const record = JSON.parse(RUNTIME_FIXTURE) as { type: string; data: Record<string, unknown> };
  record.data.clientUserAgent = "Mozilla/5.0 (extra)";
  record.data.clientIp = "198.51.100.9";
  const lines = rowsFromCliOutput(`${JSON.stringify(record)}\n{"type":"summary"}\n`, "runtime");
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed), ["k", "ts", "rid", "path", "dep", "line"]);
  assert.ok(!lines[0].includes("Mozilla"));
  assert.ok(!lines[0].includes("198.51.100.9"));
});

// ---- Plan 21-03 Task 1: capture loop helpers (no CLI is ever spawned here) ----

function budgetRow(ts: string, rid: string, ms = 10): BudgetRow {
  return {
    k: "budget",
    ts,
    rid,
    path: "/",
    dep: "dpl_x",
    line: { p: "edition", ok: 1, ms, cpuMs: 5, n: 3, bytes: 100, rcW: 1, rcR: 0, kvCmd: 0 },
  };
}

function requestRow(ts: string, rid: string): RequestRow {
  return { k: "req", ts, rid, path: "/feed.json", route: "/feed.json", status: 200, cache: "HIT", dep: "dpl_x" };
}

test("dedupeKey is equal for two copies of one record and differs when only requestId differs", () => {
  const a = budgetRow("2026-11-14T10:00:00.000Z", "r1");
  const copy = JSON.parse(JSON.stringify(a)) as BudgetRow;
  assert.equal(dedupeKey(a), dedupeKey(copy));
  assert.match(dedupeKey(a), /^[0-9a-f]{40}$/);
  assert.notEqual(dedupeKey(a), dedupeKey(budgetRow("2026-11-14T10:00:00.000Z", "r2")));
  assert.notEqual(dedupeKey(requestRow("2026-11-14T10:00:00.000Z", "r1")), dedupeKey(a));
});

test("takeNew keeps each record once across overlapping polls and after a reload from the file", () => {
  const first = [budgetRow("2026-11-14T10:00:00.000Z", "r1"), requestRow("2026-11-14T10:00:01.000Z", "r1")];
  const second = [first[1], budgetRow("2026-11-14T10:10:00.000Z", "r2"), first[0]];
  const seen = new Set<string>();
  assert.equal(takeNew(first, seen).length, 2);
  const added = takeNew(second, seen);
  assert.equal(added.length, 1);
  assert.equal((added[0] as BudgetRow).rid, "r2");
  const file = [...first, ...added].map((r) => JSON.stringify(r)).join("\n") + "\n";
  const reloaded = keysFromText(file);
  assert.equal(takeNew([...first, ...added], reloaded).length, 0);
});

test("takeNew collapses duplicates inside one batch", () => {
  const row = budgetRow("2026-11-14T10:00:00.000Z", "r1");
  assert.equal(takeNew([row, row], new Set()).length, 1);
});

test("readRows skips blank, truncated and invalid lines and counts them", () => {
  const good = JSON.stringify(budgetRow("2026-11-14T10:00:00.000Z", "r1"));
  const poll = JSON.stringify({
    k: "poll",
    at: "2026-11-14T10:00:00.000Z",
    from: "2026-11-14T09:35:00.000Z",
    to: "2026-11-14T10:00:00.000Z",
    ok: true,
    runtime: 1,
    requests: 0,
    cli: "65.16.0",
  });
  const gap = JSON.stringify({ k: "gap", from: "2026-11-14T10:00:00.000Z", to: "2026-11-14T10:05:00.000Z", reason: "cli-exit" });
  const invalid = JSON.stringify({ k: "budget", ts: "x", rid: "r", path: "/", dep: "d", line: { p: "nope" } });
  const truncated = good.slice(0, good.length - 7);
  const text = [good, "", poll, gap, invalid, '{"k":"other"}', truncated].join("\n");
  const { rows, skipped } = readRows(text);
  assert.deepEqual(rows.map((r) => r.k), ["budget", "poll", "gap"]);
  assert.equal(skipped, 3);
  assert.deepEqual(readRows(""), { rows: [], skipped: 0 });
});

test("validateWindow accepts 50 and rejects 51, and enforces window >= interval + 5", () => {
  assert.equal(validateWindow(10, 25), null);
  assert.equal(validateWindow(10, 50), null);
  assert.notEqual(validateWindow(10, 51), null);
  assert.notEqual(validateWindow(10, 14), null);
  assert.equal(validateWindow(10, 15), null);
  assert.notEqual(validateWindow(0, 25), null);
  assert.notEqual(validateWindow(10, Number.NaN), null);
});

test("outPathProblem rejects an in-repo path that git does not ignore", () => {
  const root = "/repo";
  assert.equal(outPathProblem("/elsewhere/out.jsonl", root, () => false), null);
  assert.equal(outPathProblem("/repo/.planning/x/out.jsonl", root, () => true), null);
  assert.notEqual(outPathProblem("/repo/scripts/out.jsonl", root, () => false), null);
});

test("acquireLock fails while a live PID holds the lock and takes over a dead one", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "budget-lock-"));
  const lock = path.join(dir, "out.jsonl.lock");
  assert.equal(acquireLock(lock, process.pid), true);
  assert.equal(readFileSync(lock, "utf8").trim(), String(process.pid));
  assert.equal(acquireLock(lock, process.pid + 1), false, "live holder keeps the lock");

  const child = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], {
    encoding: "utf8",
  });
  const deadPid = Number(child.stdout);
  writeFileSync(lock, `${deadPid}\n`);
  assert.equal(acquireLock(lock, process.pid), true, "dead holder is taken over");
  assert.equal(readFileSync(lock, "utf8").trim(), String(process.pid));
});

// ---- Plan 21-03 Task 2: recompute helpers ----

const T0 = Date.parse("2026-11-14T00:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;

function line(p: BudgetLine["p"], over: Partial<BudgetLine> = {}): BudgetLine {
  const base: BudgetLine = { p, ok: 1, ms: 100, cpuMs: 50, n: 1, bytes: 1000, rcW: 1, rcR: 0, kvCmd: 0 };
  if (p === "ssvc") base.st = "assessed";
  return { ...base, ...over };
}

function brow(p: BudgetLine["p"], atMin: number, rid: string, over: Partial<BudgetLine> = {}): BudgetRow {
  return { k: "budget", ts: iso(T0 + atMin * MIN), rid, path: "/", dep: "d", line: line(p, over) };
}

function pollRow(fromMs: number, toMs: number, ok = true): PollRow {
  return { k: "poll", at: iso(toMs), from: iso(fromMs), to: iso(toMs), ok, runtime: 0, requests: 0, cli: "65.16.0" };
}

test("writeUnits follows rcW * max(1, ceil(bytes / rcW / 8192)) and is 0 for rcW 0", () => {
  assert.equal(writeUnits(line("edition", { bytes: 8192, rcW: 1 })), 1);
  assert.equal(writeUnits(line("edition", { bytes: 8193, rcW: 1 })), 2);
  assert.equal(writeUnits(line("edition", { bytes: 205367, rcW: 1 })), 26);
  assert.equal(writeUnits(line("edition", { bytes: 205367, rcW: 0 })), 0);
  assert.equal(writeUnits(line("edition", { bytes: 0, rcW: 1 })), 1);
  assert.equal(writeUnits(line("epss", { bytes: 12000, rcW: 3 })), 3);
});

test("meterStatus is exact: 60% is OK, one unit more is OVER-60, strictly above 100% is OVER-100", () => {
  assert.equal(meterStatus(4000, 1440, 200000), "OK");
  assert.equal(meterStatus(4001, 1440, 200000), "OVER-60");
  assert.equal(meterStatus(6666, 1440, 200000), "OVER-60");
  assert.equal(meterStatus(6667, 1440, 200000), "OVER-100");
  assert.equal(meterStatus(0, 1440, 200000), "OK");
  // half a day covered: the same totals double
  assert.equal(meterStatus(2000, 720, 200000), "OK");
  assert.equal(meterStatus(2001, 720, 200000), "OVER-60");
});

test("coverage merges touching windows, counts a 1 ms hole as a gap and ignores failed polls", () => {
  const a = pollRow(T0, T0 + 25 * MIN);
  const b = pollRow(T0 + 25 * MIN, T0 + 50 * MIN);
  const period = { from: iso(T0), to: iso(T0 + 50 * MIN) };
  assert.deepEqual(coverage([a, b], period), { coveredMin: 50, periodMin: 50 });
  const holed = pollRow(T0 + 25 * MIN + 1, T0 + 50 * MIN);
  const c = coverage([a, holed], period);
  assert.ok(c.coveredMin < 50 && c.coveredMin > 49.99);
  const failed = pollRow(T0 + 25 * MIN, T0 + 50 * MIN, false);
  assert.equal(coverage([a, failed], period).coveredMin, 25);
  assert.deepEqual(coverage([], period), { coveredMin: 0, periodMin: 50 });
  assert.deepEqual(coverage([a]), { coveredMin: 25, periodMin: 25 });
  const clipped = coverage([a, b], { from: iso(T0 + 10 * MIN), to: iso(T0 + 40 * MIN) });
  assert.deepEqual(clipped, { coveredMin: 30, periodMin: 30 });
});

test("readUnits models one render as edition + kev + (rcR - 2) and feed STALE/MISS as an edition read", () => {
  const rows: Row[] = [
    brow("edition", 0, "e1", { bytes: 205367 }),
    brow("kev", 0, "k1", { bytes: 135000 }),
    brow("render", 1, "r1", { rcR: 19, bytes: 0, rcW: 0 }),
    { k: "req", ts: iso(T0), rid: "q1", path: "/feed.json", route: "/feed.json", status: 200, cache: "STALE", dep: "d" },
    { k: "req", ts: iso(T0), rid: "q2", path: "/feed.xml", route: "/feed.xml", status: 200, cache: "miss", dep: "d" },
    { k: "req", ts: iso(T0), rid: "q3", path: "/feed.json", route: "/feed.json", status: 200, cache: "HIT", dep: "d" },
    { k: "req", ts: iso(T0), rid: "q4", path: "/", route: "/", status: 200, cache: "MISS", dep: "d" },
  ];
  assert.deepEqual(readUnits(rows), { units: 60 + 26 + 26, known: true });
  assert.deepEqual(readUnits([brow("render", 1, "r1", { rcR: 19, rcW: 0 })]), { units: 0, known: false });
});

function fullDay(extra: Row[]): Row[] {
  return [pollRow(T0, T0 + 1440 * MIN), ...extra];
}

test("renderTable gives a byte-identical string for shuffled rows", () => {
  const rows = fullDay([
    brow("edition", 0, "e1", { bytes: 205367, cpuMs: 300 }),
    brow("edition", 15, "e2", { bytes: 205367, cpuMs: 310 }),
    brow("kev", 0, "k1", { bytes: 135000 }),
    brow("ssvc", 5, "s1"),
    brow("epss", 5, "p1", { rcW: 3, bytes: 12000 }),
    brow("render", 5, "r1", { rcR: 19, rcW: 0, bytes: 0 }),
  ]);
  const opts = { allot: { rcWrites: 200000, rcReads: 1000000, kv: 500000, cpuS: 14400 } };
  const first = renderTable(rows, opts);
  const shuffled = [...rows].reverse();
  shuffled.push(shuffled.shift() as Row);
  assert.equal(renderTable(shuffled, opts), first);
  assert.equal(renderTable(rows, opts), first);
  assert.match(first, /^coverage: 1440\/1440 min \(100\.0%\)/);
});

test("the Upstash row is NOT-MEASURED while every kvCmd is 0 and never reads OK", () => {
  const rows = fullDay([brow("edition", 0, "e1"), brow("kev", 0, "k1")]);
  const opts = { allot: { rcWrites: 200000, rcReads: 1000000, kv: 500000, cpuS: 14400 } };
  const upstash = renderTable(rows, opts).split("\n").find((l) => l.includes("Upstash commands"));
  assert.ok(upstash);
  assert.ok(upstash.includes("not measured in product (kvCmd 0 by design)"));
  assert.ok(upstash.includes("NOT-MEASURED"));
  assert.ok(upstash.includes("none in product"));
  assert.ok(!upstash.includes("| OK |"));
  const withKv = fullDay([brow("edition", 0, "e1", { kvCmd: 4 })]);
  const measured = renderTable(withKv, opts).split("\n").find((l) => l.includes("Upstash commands"));
  assert.ok(measured && !measured.includes("not measured in product") && !measured.includes("NOT-MEASURED"));
});

const RECOMPUTE = new URL("./budget-recompute.ts", import.meta.url).pathname;

function recompute(content: string, extra: string[] = []) {
  const dir = mkdtempSync(path.join(tmpdir(), "budget-recompute-"));
  const file = path.join(dir, "in.jsonl");
  writeFileSync(file, content);
  return spawnSync(process.execPath, ["--experimental-strip-types", RECOMPUTE, "--in", file, ...extra], {
    encoding: "utf8",
  });
}

test("recompute prints INSUFFICIENT_COVERAGE and exits 3 for an empty file and for budget rows without a poll", () => {
  const empty = recompute("");
  assert.equal(empty.status, 3);
  assert.match(empty.stdout, /INSUFFICIENT_COVERAGE/);
  const noPoll = recompute(`${JSON.stringify(brow("edition", 0, "e1"))}\n`);
  assert.equal(noPoll.status, 3);
  assert.match(noPoll.stdout, /INSUFFICIENT_COVERAGE/);
  assert.ok(!noPoll.stdout.includes("RECOMPUTE_OK"));
});

test("recompute with enough coverage ends in RECOMPUTE_OK and below --min-coverage exits 3", () => {
  const rows = [pollRow(T0, T0 + 120 * MIN), brow("edition", 0, "e1")].map((r) => JSON.stringify(r)).join("\n");
  const thin = recompute(`${rows}\n`);
  assert.equal(thin.status, 3, "two hours of a 24 h period is below 90%");
  const forced = recompute(`${rows}\n`, ["--min-coverage", "0"]);
  assert.equal(forced.status, 0);
  assert.equal(forced.stdout.trim().split("\n").pop(), "RECOMPUTE_OK");
  const bad = spawnSync(process.execPath, ["--experimental-strip-types", RECOMPUTE], { encoding: "utf8" });
  assert.equal(bad.status, 2);
});
