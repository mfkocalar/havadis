import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseBudgetLine } from "../src/lib/budgetLine.ts";
import {
  acquireLock,
  dedupeKey,
  keysFromText,
  outPathProblem,
  readRows,
  takeNew,
  validateWindow,
  type BudgetRow,
  type RequestRow,
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
