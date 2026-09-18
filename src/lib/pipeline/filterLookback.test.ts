import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { filterLookback } from "./filterLookback.ts";
import type { Article } from "../types.ts";

/**
 * Unit tests for filterLookback.ts (INGEST-04 concurrency edge, owned by
 * this plan): the cutoff must be sampled exactly once per call, so every
 * article is compared against one consistent instant.
 */

function article(publishedAt: string): Article {
  return {
    title: "t",
    url: "https://krebsonsecurity.com/x",
    source: "Krebs on Security",
    sourceTier: "Security Research",
    publishedAt,
    summary: "",
  };
}

test("Date.now is sampled exactly once per call, regardless of array length", () => {
  const realNow = Date.now;
  const spy = mock.fn(realNow);
  Date.now = spy;
  try {
    filterLookback([article("2026-01-01T00:00:00.000Z"), article("2026-01-02T00:00:00.000Z"), article("2026-01-03T00:00:00.000Z")]);
  } finally {
    Date.now = realNow;
  }
  assert.equal(spy.mock.callCount(), 1, "cutoff must be computed once, not per-item");
});

test("keeps articles within the lookback window and drops older ones", () => {
  const now = Date.now();
  const recent = article(new Date(now - 2 * 60 * 60 * 1000).toISOString()); // 2h ago
  const stale = article(new Date(now - 30 * 60 * 60 * 1000).toISOString()); // 30h ago
  const result = filterLookback([recent, stale], 24);
  assert.deepEqual(result, [recent]);
});

test("returns an empty array when given zero articles", () => {
  assert.deepEqual(filterLookback([]), []);
});

test("respects a custom hours parameter", () => {
  const now = Date.now();
  const withinOneHour = article(new Date(now - 30 * 60 * 1000).toISOString());
  const overOneHour = article(new Date(now - 90 * 60 * 1000).toISOString());
  const result = filterLookback([withinOneHour, overOneHour], 1);
  assert.deepEqual(result, [withinOneHour]);
});
