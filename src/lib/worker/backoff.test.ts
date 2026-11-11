import { test } from "node:test";
import assert from "node:assert/strict";
import { BACKOFF_BASE_MS, BACKOFF_JITTER_RATIO, BACKOFF_MAX_MS, backoffDelayMs, hostKey } from "./backoff.ts";

/** Pure arithmetic tests for the per-host back-off (SAFE-03, T-14-16, T-14-17). */

const MIN = 60_000;
const HOUR = 3_600_000;

test("the constants are 15 minutes, 6 hours and plus or minus 10%", () => {
  assert.equal(BACKOFF_BASE_MS, 15 * MIN);
  assert.equal(BACKOFF_MAX_MS, 6 * HOUR);
  assert.equal(BACKOFF_JITTER_RATIO, 0.1);
});

test("the delay doubles per consecutive failure from 15 minutes", () => {
  const mid = () => 0.5;
  assert.equal(backoffDelayMs(1, mid, null), 900_000);
  assert.equal(backoffDelayMs(2, mid, null), 1_800_000);
  assert.equal(backoffDelayMs(3, mid, null), 3_600_000);
  assert.equal(backoffDelayMs(4, mid, null), 7_200_000);
});

test("the delay never exceeds six hours for any failure count, jitter included", () => {
  for (const failures of [1, 5, 6, 7, 10, 40, 1000, 100_000]) {
    for (const random of [0, 0.5, 1]) {
      const delay = backoffDelayMs(failures, () => random, null);
      assert.ok(delay <= 21_600_000, `failures ${failures}, random ${random}: ${delay}`);
      assert.ok(delay > 0 && Number.isFinite(delay));
    }
  }
});

test("random 0 and 1 keep the delay within plus or minus 10% of the base", () => {
  for (const failures of [1, 2, 3, 4]) {
    const base = BACKOFF_BASE_MS * 2 ** (failures - 1);
    assert.equal(backoffDelayMs(failures, () => 0, null), Math.round(base * 0.9));
    assert.equal(backoffDelayMs(failures, () => 1, null), Math.round(base * 1.1));
  }
});

test("a Retry-After larger than the computed delay wins, capped at six hours", () => {
  const mid = () => 0.5;
  assert.equal(backoffDelayMs(1, mid, 2 * HOUR), 2 * HOUR);
  assert.equal(backoffDelayMs(1, mid, 10 * HOUR), 6 * HOUR);
  assert.equal(backoffDelayMs(3, mid, 5 * MIN), 3_600_000, "a smaller Retry-After never shortens the back-off");
  assert.equal(backoffDelayMs(1, mid, 0), 900_000);
});

test("hostKey is the lower-cased host with its port", () => {
  assert.equal(hostKey("https://Feeds.Example.com:8443/rss"), "feeds.example.com:8443");
  assert.equal(hostKey("https://feeds.example.com/rss"), "feeds.example.com");
});
