import { test } from "node:test";
import assert from "node:assert/strict";
import { sortByRecencyDesc } from "./sortByRecencyDesc.ts";
import type { Article } from "../types.ts";

/**
 * Unit tests for sortByRecencyDesc.ts, following filterLookback.test.ts's
 * established hermetic pure-transform test shape: node:test +
 * node:assert/strict, synthetic Article literals, no network. Uses fixed
 * ISO 8601 literal timestamps only — never a wall-clock-derived value —
 * so this test is time-independent and can never go flaky.
 */

function makeArticle(title: string, publishedAt: string, source = "Krebs on Security"): Article {
  return {
    title,
    url: "urn:test:article/x",
    source,
    sourceTier: "Security Research",
    publishedAt,
    summary: "",
  };
}

test("returns articles newest-first regardless of input order", () => {
  const oldest = makeArticle("oldest", "2026-09-19T12:00:00.000Z");
  const middle = makeArticle("middle", "2026-09-20T12:00:00.000Z");
  const newest = makeArticle("newest", "2026-09-21T12:00:00.000Z");

  const result = sortByRecencyDesc([middle, oldest, newest]);

  assert.deepEqual(result.map((a) => a.title), ["newest", "middle", "oldest"]);
});

test("does not mutate the input array", () => {
  const oldest = makeArticle("oldest", "2026-09-19T12:00:00.000Z");
  const newest = makeArticle("newest", "2026-09-21T12:00:00.000Z");
  const input = [oldest, newest];
  const before = input.map((a) => a.title);

  sortByRecencyDesc(input);

  assert.deepEqual(input.map((a) => a.title), before);
});

test("tie stability: equal publishedAt entries keep their original relative order across repeated calls", () => {
  const a = makeArticle("a", "2026-09-21T12:00:00.000Z", "Krebs on Security");
  const b = makeArticle("b", "2026-09-21T12:00:00.000Z", "CISA Alerts");
  const c = makeArticle("c", "2026-09-20T12:00:00.000Z", "Krebs on Security");
  const d = makeArticle("d", "2026-09-19T12:00:00.000Z", "CISA Alerts");

  const input1 = [a, b, c, d];
  const input2 = [
    makeArticle("a", "2026-09-21T12:00:00.000Z", "Krebs on Security"),
    makeArticle("b", "2026-09-21T12:00:00.000Z", "CISA Alerts"),
    makeArticle("c", "2026-09-20T12:00:00.000Z", "Krebs on Security"),
    makeArticle("d", "2026-09-19T12:00:00.000Z", "CISA Alerts"),
  ];

  const result1 = sortByRecencyDesc(input1).map((x) => x.title);
  const result2 = sortByRecencyDesc(input2).map((x) => x.title);

  const expected = ["a", "b", "c", "d"];
  assert.deepEqual(result1, expected);
  assert.deepEqual(result2, expected);
  assert.deepEqual(result1, result2);
});

test("source-iteration tie order: source A's article stays before source B's article when timestamps are equal", () => {
  const fromA = makeArticle("fromA", "2026-09-21T12:00:00.000Z", "Source A");
  const fromB = makeArticle("fromB", "2026-09-21T12:00:00.000Z", "Source B");

  const result = sortByRecencyDesc([fromA, fromB]);

  assert.deepEqual(result.map((a) => a.title), ["fromA", "fromB"]);
});

test("empty and single-element inputs are handled correctly", () => {
  assert.deepEqual(sortByRecencyDesc([]), []);

  const only = makeArticle("only", "2026-09-21T12:00:00.000Z");
  assert.deepEqual(sortByRecencyDesc([only]), [only]);
});
