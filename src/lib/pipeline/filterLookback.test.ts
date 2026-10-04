import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { filterLookback } from "./filterLookback.ts";
import { makeArticle } from "../../../test/fixtures/makeArticle.ts";
import type { Article } from "../types.ts";

/**
 * Unit tests for filterLookback.ts (INGEST-04 concurrency edge, owned by
 * this plan): the cutoff must be sampled exactly once per call, so every
 * article is compared against one consistent instant.
 */

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

test("an article published a few minutes ago survives the 24h window", () => {
  const fewMinutesAgo = article(new Date(Date.now() - 5 * 60 * 1000).toISOString());
  assert.deepEqual(filterLookback([fewMinutesAgo]), [fewMinutesAgo]);
});

test("an article exactly 23 hours old survives (inside the boundary)", () => {
  const twentyThreeHoursAgo = article(
    new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString()
  );
  assert.deepEqual(filterLookback([twentyThreeHoursAgo]), [twentyThreeHoursAgo]);
});

test("an article exactly 25 hours old is dropped (outside the boundary)", () => {
  const twentyFiveHoursAgo = article(
    new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
  );
  assert.deepEqual(filterLookback([twentyFiveHoursAgo]), []);
});

test("a single-element array survives when within the window", () => {
  const recent = article(new Date(Date.now() - 60 * 60 * 1000).toISOString());
  assert.deepEqual(filterLookback([recent]), [recent]);
});

test("a single-element array is dropped when outside the window", () => {
  const stale = article(new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());
  assert.deepEqual(filterLookback([stale]), []);
});

test("a batch straddling the 23h/25h boundary is partitioned by one consistent cutoff instant", () => {
  const now = Date.now();
  const justInside = article(new Date(now - 23 * 60 * 60 * 1000).toISOString());
  const justOutside = article(new Date(now - 25 * 60 * 60 * 1000).toISOString());
  const result = filterLookback([justOutside, justInside]);
  assert.deepEqual(
    result,
    [justInside],
    "a single sampled cutoff must consistently keep the 23h article and drop the 25h one, in either input order"
  );
});
