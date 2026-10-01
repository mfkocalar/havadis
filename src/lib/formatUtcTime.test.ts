import { test } from "node:test";
import assert from "node:assert/strict";
import { formatUtcDateTime, formatUtcTime } from "./formatUtcTime.ts";

/**
 * Unit tests for formatUtcTime.ts (D-13): deterministic, locale-free UTC
 * formatters for the server-rendered "Updated" text. Fixed ISO strings only.
 */

test("formatUtcTime renders HH:MM UTC from a Z timestamp", () => {
  assert.equal(formatUtcTime("2026-09-30T14:32:10.000Z"), "14:32 UTC");
});

test("formatUtcTime keeps the leading zero at midnight", () => {
  assert.equal(formatUtcTime("2026-09-30T00:05:00.000Z"), "00:05 UTC");
});

test("formatUtcTime normalises an offset timestamp to UTC", () => {
  assert.equal(formatUtcTime("2026-09-30T16:32:00+02:00"), "14:32 UTC");
});

test("formatUtcDateTime renders YYYY-MM-DD HH:MM UTC", () => {
  assert.equal(formatUtcDateTime("2026-09-30T14:32:10.000Z"), "2026-09-30 14:32 UTC");
});

test("both formatters return 'unknown time' for an unparseable string and never throw", () => {
  assert.equal(formatUtcTime("not a date"), "unknown time");
  assert.equal(formatUtcDateTime("not a date"), "unknown time");
});

test("both formatters return 'unknown time' for an empty string and never throw", () => {
  assert.equal(formatUtcTime(""), "unknown time");
  assert.equal(formatUtcDateTime(""), "unknown time");
});
