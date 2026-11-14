import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseBudgetLine } from "../src/lib/budgetLine.ts";
import {
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
