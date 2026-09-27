import { test } from "node:test";
import assert from "node:assert/strict";
import type { Article } from "../types.ts";
import { dedupe } from "./dedupe.ts";

/**
 * Hermetic fixture tests for dedupe() (NORM-02, D-01/D-02/D-03). One
 * test() per behavior bullet in 03-02-PLAN.md's Task 2 <behavior> block.
 * Fixtures are full six-field Article objects built by a local helper, with
 * fixed ISO timestamps and `.test` hostnames only — no clock, no network.
 */

let counter = 0;
function article(overrides: Partial<Article>): Article {
  counter += 1;
  return {
    title: `Fixture Article ${counter}`,
    url: `https://source${counter}.test/story-${counter}`,
    source: `Source ${counter}`,
    sourceTier: "Tech & General",
    publishedAt: "2026-01-01T00:00:00.000Z",
    summary: "A fixture summary.",
    ...overrides,
  };
}

test("same URL and same title from two sources collapse to one survivor", () => {
  const a = article({
    title: "Same Story",
    url: "https://news.test/a",
    publishedAt: "2026-01-01T00:00:00.000Z",
  });
  const b = article({
    title: "Same Story",
    url: "https://news.test/a",
    publishedAt: "2026-01-01T01:00:00.000Z",
  });
  const result = dedupe([a, b]);
  assert.equal(result.length, 1);
});

test("URL-only match collapses two articles with different titles", () => {
  const a = article({
    title: "Headline One",
    url: "https://news.test/a",
    publishedAt: "2026-01-01T00:00:00.000Z",
  });
  const b = article({
    title: "Headline Two",
    url: "http://NEWS.test/a/?utm_source=rss#x",
    publishedAt: "2026-01-01T01:00:00.000Z",
  });
  const result = dedupe([a, b]);
  assert.equal(result.length, 1);
});

test("title-only match collapses two articles with different URLs", () => {
  const a = article({
    title: "Foo Corp Confirms Data Breach",
    url: "https://outlet-one.test/foo-breach",
    publishedAt: "2026-01-01T00:00:00.000Z",
  });
  const b = article({
    title: "foo corp confirms data breach!",
    url: "https://outlet-two.test/other-path",
    publishedAt: "2026-01-01T01:00:00.000Z",
  });
  const result = dedupe([a, b]);
  assert.equal(result.length, 1);
});

test("transitive chain: A shares a URL with B, B shares a title with C, A and C share nothing directly", () => {
  const a = article({
    title: "A's Own Headline",
    url: "https://shared.test/story",
    publishedAt: "2026-01-01T00:00:00.000Z",
  });
  const b = article({
    title: "Chain Title",
    url: "https://shared.test/story",
    publishedAt: "2026-01-01T01:00:00.000Z",
  });
  const c = article({
    title: "Chain Title",
    url: "https://unrelated.test/c-story",
    publishedAt: "2026-01-01T02:00:00.000Z",
  });
  const result = dedupe([a, b, c]);
  assert.equal(result.length, 1, "A, B, C form one transitive group via B");
});

test("D-02: the survivor is the earliest publishedAt", () => {
  const early = article({
    title: "Same Story",
    url: "https://news.test/a",
    publishedAt: "2026-01-01T00:00:00.000Z",
  });
  const late = article({
    title: "Same Story",
    url: "https://news.test/a",
    publishedAt: "2026-01-02T00:00:00.000Z",
  });
  const result = dedupe([late, early]);
  assert.equal(result.length, 1);
  assert.equal(result[0].publishedAt, "2026-01-01T00:00:00.000Z");
});

test("D-02: a publishedAt tie goes to the higher TIER_WEIGHT (Government beats Tech & General), in either input order", () => {
  const gov = article({
    title: "Same Story",
    url: "https://news.test/a",
    sourceTier: "Government",
    publishedAt: "2026-01-01T00:00:00.000Z",
  });
  const tech = article({
    title: "Same Story",
    url: "https://news.test/a",
    sourceTier: "Tech & General",
    publishedAt: "2026-01-01T00:00:00.000Z",
  });

  const resultA = dedupe([tech, gov]);
  assert.equal(resultA.length, 1);
  assert.equal(resultA[0].sourceTier, "Government");

  const resultB = dedupe([gov, tech]);
  assert.equal(resultB.length, 1);
  assert.equal(resultB[0].sourceTier, "Government");
});

test("D-02: a double tie (same publishedAt, same tier) goes to the first in input order", () => {
  const first = article({
    title: "Same Story",
    url: "https://news.test/a",
    sourceTier: "Tech & General",
    publishedAt: "2026-01-01T00:00:00.000Z",
    source: "First Source",
  });
  const second = article({
    title: "Same Story",
    url: "https://news.test/a",
    sourceTier: "Tech & General",
    publishedAt: "2026-01-01T00:00:00.000Z",
    source: "Second Source",
  });
  const result = dedupe([first, second]);
  assert.equal(result.length, 1);
  assert.equal(result[0].source, "First Source");
});

test("survivors keep their original relative order", () => {
  const a = article({ title: "Alpha", url: "https://a.test/alpha" });
  const b = article({ title: "Bravo", url: "https://b.test/bravo" });
  const c = article({ title: "Charlie", url: "https://c.test/charlie" });
  const result = dedupe([a, b, c]);
  assert.deepEqual(
    result.map((r) => r.title),
    ["Alpha", "Bravo", "Charlie"]
  );
});

test("differently-worded ShinyHunters headlines with different URLs both survive (no fuzzy matching, Pitfall 4)", () => {
  const hackerNews = article({
    title: "ShinyHunters Claims FBI Breach, Says It Stole Data on Agents and Job Applicants",
    url: "https://thehackernews.test/shinyhunters-fbi-breach",
  });
  const techCrunch = article({
    title: "Hacking group ShinyHunters claims it breached the FBI, stole agents' and applicants' data",
    url: "https://techcrunch.test/shinyhunters-claims-fbi-breach",
  });
  const result = dedupe([hackerNews, techCrunch]);
  assert.equal(result.length, 2, "differently-worded coverage of the same event stays separate in v1");
});

test("empty array in, empty array out", () => {
  assert.deepEqual(dedupe([]), []);
});

test("a single article survives unchanged", () => {
  const a = article({ title: "Solo" });
  const result = dedupe([a]);
  assert.equal(result.length, 1);
  assert.strictEqual(result[0], a);
});

test("dedupe is idempotent: dedupe(dedupe(x)) deep-equals dedupe(x)", () => {
  const a = article({ title: "Same Story", url: "https://news.test/a" });
  const b = article({ title: "Same Story", url: "https://news.test/a" });
  const c = article({ title: "Unrelated", url: "https://other.test/x" });
  const once = dedupe([a, b, c]);
  const twice = dedupe(once);
  assert.deepEqual(twice, once);
});

test("survivors are the same object references as the inputs, with exactly six keys and an unchanged url", () => {
  const a = article({ title: "Solo Story", url: "https://solo.test/story" });
  const result = dedupe([a]);
  assert.strictEqual(result[0], a);
  assert.deepEqual(Object.keys(result[0]).sort(), [
    "publishedAt",
    "source",
    "sourceTier",
    "summary",
    "title",
    "url",
  ]);
  assert.equal(result[0].url, "https://solo.test/story");
});

test("two titles that normalize to an empty key (emoji-only) with different URLs both survive", () => {
  const a = article({ title: "\u{1F525}\u{1F525}", url: "https://a.test/fire-1" });
  const b = article({ title: "\u{1F525}\u{1F525}", url: "https://b.test/fire-2" });
  const result = dedupe([a, b]);
  assert.equal(result.length, 2, "an empty normalized title key must never participate in matching");
});

test("a copy whose publishedAt does not parse never wins over a copy with a valid date", () => {
  const bad = article({
    title: "Same Story",
    url: "https://news.test/a",
    publishedAt: "not-a-date",
  });
  const good = article({
    title: "Same Story",
    url: "https://news.test/a",
    publishedAt: "2026-01-05T00:00:00.000Z",
  });
  const resultA = dedupe([bad, good]);
  assert.equal(resultA.length, 1);
  assert.equal(resultA[0].publishedAt, "2026-01-05T00:00:00.000Z");

  const resultB = dedupe([good, bad]);
  assert.equal(resultB.length, 1);
  assert.equal(resultB[0].publishedAt, "2026-01-05T00:00:00.000Z");
});

test("the input array is not mutated", () => {
  const a = article({ title: "Same Story", url: "https://news.test/a" });
  const b = article({ title: "Same Story", url: "https://news.test/a" });
  const input = [a, b];
  const inputCopy = [...input];
  dedupe(input);
  assert.deepEqual(input, inputCopy);
  assert.equal(input.length, 2);
});
