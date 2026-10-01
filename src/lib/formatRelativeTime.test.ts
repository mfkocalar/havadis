import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRelativeTime } from "./formatRelativeTime.ts";

/**
 * Unit tests for formatRelativeTime.ts (UI-02): the 24h lookback window
 * collapses relative time to exactly three cases — "just now", "Nm ago",
 * "Nh ago" — plus a future-timestamp clock-skew guard. Every case below
 * injects a timestamp computed relative to the moment of assertion rather
 * than a hardcoded date, since the function reads the current time itself.
 */

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

test("a timestamp less than 60 seconds old returns 'just now'", () => {
  assert.equal(formatRelativeTime(isoAgo(30 * 1000)), "just now");
});

test("a timestamp 1 minute old returns '1m ago'", () => {
  assert.equal(formatRelativeTime(isoAgo(1 * 60 * 1000)), "1m ago");
});

test("a timestamp 59 minutes old returns '59m ago'", () => {
  assert.equal(formatRelativeTime(isoAgo(59 * 60 * 1000)), "59m ago");
});

test("a timestamp exactly 60 minutes old crosses to the hours case ('1h ago', not '60m ago')", () => {
  assert.equal(formatRelativeTime(isoAgo(60 * 60 * 1000)), "1h ago");
});

test("a timestamp 23 hours old returns '23h ago'", () => {
  assert.equal(formatRelativeTime(isoAgo(23 * 60 * 60 * 1000)), "23h ago");
});

test("a future timestamp (clock skew) returns 'just now', never a negative value", () => {
  const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  assert.equal(formatRelativeTime(future), "just now");
});

// Explicit-`now` form (Phase 4 D-13): the "Updated" text passes the client
// clock's minute snapshot in, so these cases use fixed timestamps only.

test("with an explicit now, 4m30s after the timestamp returns '4m ago'", () => {
  assert.equal(
    formatRelativeTime("2026-09-30T12:00:00.000Z", Date.parse("2026-09-30T12:04:30.000Z")),
    "4m ago"
  );
});

test("with an explicit now earlier than the timestamp returns 'just now', never negative", () => {
  assert.equal(
    formatRelativeTime("2026-09-30T12:00:00.000Z", Date.parse("2026-09-30T11:59:00.000Z")),
    "just now"
  );
});

test("with an explicit now 72 hours later returns '72h ago' (honest age of a long-idle cached page)", () => {
  assert.equal(
    formatRelativeTime("2026-09-27T12:00:00.000Z", Date.parse("2026-09-30T12:00:00.000Z")),
    "72h ago"
  );
});
