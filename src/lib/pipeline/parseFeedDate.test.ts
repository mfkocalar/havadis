import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeedDate } from "./parseFeedDate.ts";

/**
 * Tests for parseFeedDate (SRC-03, D-10, T-05-09, T-05-11): a pure, bounded
 * fallback for RFC-822 dates whose zone abbreviation V8 cannot parse.
 * Assertions are relational (equal to the numeric-offset form), not epochs.
 */

function ms(iso: string | null): number {
  assert.ok(iso !== null, "expected a non-null ISO string");
  return Date.parse(iso);
}

test("CEST equals the same wall time written with a +0200 offset", () => {
  const cest = parseFeedDate("Sun, 27 Sep 2026 19:40:52 CEST");
  assert.ok(cest !== null);
  assert.equal(cest, parseFeedDate("Sun, 27 Sep 2026 19:40:52 +0200"));
});

test("CET is exactly one hour later in UTC than CEST for the same wall time", () => {
  const cet = ms(parseFeedDate("Sun, 27 Sep 2026 19:40:52 CET"));
  const cest = ms(parseFeedDate("Sun, 27 Sep 2026 19:40:52 CEST"));
  assert.equal(cet - cest, 60 * 60 * 1000);
});

test("EET is exactly one hour later in UTC than EEST for the same wall time", () => {
  const eet = ms(parseFeedDate("Sun, 27 Sep 2026 19:40:52 EET"));
  const eest = ms(parseFeedDate("Sun, 27 Sep 2026 19:40:52 EEST"));
  assert.equal(eet - eest, 60 * 60 * 1000);
});

test("BST (British Summer Time) equals the +0100 form", () => {
  assert.equal(
    parseFeedDate("Sun, 27 Sep 2026 19:40:52 BST"),
    parseFeedDate("Sun, 27 Sep 2026 19:40:52 +0100")
  );
});

test("every supported abbreviation yields an ISO string, case-insensitively", () => {
  for (const zone of ["CET", "CEST", "EET", "EEST", "BST", "WET", "WEST", "MSK"]) {
    const upper = parseFeedDate(`Sun, 27 Sep 2026 19:40:52 ${zone}`);
    assert.match(upper ?? "", /^\d{4}-\d{2}-\d{2}T/, zone);
    assert.equal(parseFeedDate(`Sun, 27 Sep 2026 19:40:52 ${zone.toLowerCase()}`), upper, zone);
  }
});

test("GMT and +0000 give the same instant (GMT is left to V8)", () => {
  const gmt = parseFeedDate("Mon, 05 Jan 2026 10:00:00 GMT");
  assert.ok(gmt !== null);
  assert.equal(gmt, parseFeedDate("Mon, 05 Jan 2026 10:00:00 +0000"));
});

test("ambiguous IST returns null rather than a guessed time", () => {
  assert.equal(parseFeedDate("Sun, 27 Sep 2026 19:40:52 IST"), null);
});

test("garbage, undefined, empty and whitespace-only input return null", () => {
  assert.equal(parseFeedDate("not a date"), null);
  assert.equal(parseFeedDate(undefined), null);
  assert.equal(parseFeedDate(""), null);
  assert.equal(parseFeedDate("   \n\t "), null);
});

test("a 100,000-character hostile input returns null quickly without throwing", () => {
  const hostile = "a" + " ".repeat(100_000) + "b";
  const start = performance.now();
  assert.equal(parseFeedDate(hostile), null);
  assert.ok(performance.now() - start < 1000, "must finish well under one second");
});
