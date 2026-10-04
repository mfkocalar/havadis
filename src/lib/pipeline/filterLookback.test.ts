import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { filterLookback } from "./filterLookback.ts";
import { makeArticle } from "../../../test/fixtures/makeArticle.ts";
import type { Article } from "../types.ts";

/**
 * Unit tests for filterLookback.ts (INGEST-04, PLAT-03): the cutoff is
 * computed once from an explicit `now`, and the wall clock is never read.
 */

const NOW = Date.parse("2026-09-23T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function hoursAgo(h: number): string {
  return new Date(NOW - h * HOUR).toISOString();
}

function article(publishedAt: string): Article {
  return makeArticle({
    title: "t",
    url: "https://krebsonsecurity.com/x",
    source: "Krebs on Security",
    sourceTier: "Security Research",
    publishedAt,
    summary: "",
  });
}

test("never reads the wall clock", () => {
  const spy = mock.method(Date, "now", () => {
    throw new Error("Date.now must not be called");
  });
  try {
    const result = filterLookback(
      [article(hoursAgo(1)), article(hoursAgo(2)), article(hoursAgo(3))],
      24,
      NOW
    );
    assert.equal(result.length, 3);
    assert.equal(spy.mock.callCount(), 0);
  } finally {
    spy.mock.restore();
  }
});

test("keeps articles within the lookback window and drops older ones", () => {
  const recent = article(hoursAgo(2));
  const stale = article(hoursAgo(30));
  assert.deepEqual(filterLookback([recent, stale], 24, NOW), [recent]);
});

test("respects a custom hours parameter", () => {
  const withinOneHour = article(new Date(NOW - 30 * 60 * 1000).toISOString());
  const overOneHour = article(new Date(NOW - 90 * 60 * 1000).toISOString());
  assert.deepEqual(filterLookback([withinOneHour, overOneHour], 1, NOW), [withinOneHour]);
});

test("a batch straddling the 23h/25h boundary is partitioned by one cutoff, in either order", () => {
  const justInside = article(hoursAgo(23));
  const justOutside = article(hoursAgo(25));
  assert.deepEqual(filterLookback([justOutside, justInside], 24, NOW), [justInside]);
  assert.deepEqual(filterLookback([justInside, justOutside], 24, NOW), [justInside]);
});

test("a 48h-old article is dropped at 24h but kept at 72h", () => {
  const old = article(hoursAgo(48));
  assert.deepEqual(filterLookback([old], 24, NOW), []);
  assert.deepEqual(filterLookback([old], 72, NOW), [old]);
});

test("returns an empty array when given zero articles", () => {
  assert.deepEqual(filterLookback([], 24, NOW), []);
});

test("an article with an unparseable publishedAt is dropped", () => {
  assert.deepEqual(filterLookback([article("not a date")], 24, NOW), []);
});
