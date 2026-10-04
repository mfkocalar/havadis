import { test } from "node:test";
import assert from "node:assert/strict";
import { rankScore, rankWithinSection } from "./rank.ts";
import { TIER_WEIGHT } from "../config/ranking.ts";
import { makeArticle } from "../../../test/fixtures/makeArticle.ts";
import type { Article, SourceTier } from "../types.ts";

/**
 * Hermetic unit tests for rank.ts / ranking.ts (CLASSIFY-02, D-09/D-10/D-11).
 * A fixed NOW constant stands in for the wall clock throughout — `now` is
 * always passed as an argument, the live clock is never read here, per
 * D-09's testability requirement.
 */

const NOW = Date.parse("2026-09-23T12:00:00.000Z");

let urlCounter = 0;
function article(title: string, sourceTier: SourceTier, publishedAt: string): Article {
  urlCounter += 1;
  return makeArticle({
    title,
    url: `urn:test:${urlCounter}`,
    source: "Test Source",
    sourceTier,
    publishedAt,
    summary: "",
  });
}

function hoursAgo(hours: number): string {
  return new Date(NOW - hours * 3_600_000).toISOString();
}

test("a Government article 3 hours old outranks a Tech & General article 5 minutes old (D-09 crossover)", () => {
  const gov = article("Gov 3h", "Government", hoursAgo(3));
  const tech = article("Tech 5m", "Tech & General", hoursAgo(5 / 60));
  const result = rankWithinSection([tech, gov], NOW);
  assert.deepEqual(result.map((a) => a.title), ["Gov 3h", "Tech 5m"]);
});

test("a Government article 20 hours old ranks below a Tech & General article 1 hour old (old items sink)", () => {
  const gov = article("Gov 20h", "Government", hoursAgo(20));
  const tech = article("Tech 1h", "Tech & General", hoursAgo(1));
  const result = rankWithinSection([gov, tech], NOW);
  assert.deepEqual(result.map((a) => a.title), ["Tech 1h", "Gov 20h"]);
});

test("an article dated 71 days in the future scores exactly equal to a same-tier article dated at now, never larger, and is finite", () => {
  const future = article("Future 71d", "Enterprise Security", hoursAgo(-71 * 24));
  const atNow = article("Now", "Enterprise Security", hoursAgo(0));
  const futureScore = rankScore(future, NOW);
  const nowScore = rankScore(atNow, NOW);
  assert.ok(Number.isFinite(futureScore), "expected a future-dated article's score to be finite");
  assert.equal(futureScore, nowScore, "expected a future-dated article's age to clamp to zero");
});

test("two same-tier, same-publishedAt articles keep their incoming order, identically across two calls on separately built but equal inputs", () => {
  const publishedAt = hoursAgo(2);
  const buildInputs = () => [
    article("First", "Threat Intelligence", publishedAt),
    article("Second", "Threat Intelligence", publishedAt),
  ];
  const resultA = rankWithinSection(buildInputs(), NOW);
  const resultB = rankWithinSection(buildInputs(), NOW);
  assert.deepEqual(resultA.map((a) => a.title), ["First", "Second"]);
  assert.deepEqual(resultB.map((a) => a.title), ["First", "Second"]);
});

test("rankWithinSection of an empty list returns an empty list", () => {
  assert.deepEqual(rankWithinSection([], NOW), []);
});

test("rankWithinSection of a one-article list returns that article unchanged", () => {
  const only = article("Only", "Government", hoursAgo(1));
  assert.deepEqual(rankWithinSection([only], NOW), [only]);
});

test("rankWithinSection never mutates its input array", () => {
  const input = [
    article("A", "Government", hoursAgo(10)),
    article("B", "Tech & General", hoursAgo(0.1)),
  ];
  const inputCopy = [...input];
  rankWithinSection(input, NOW);
  assert.deepEqual(input, inputCopy, "expected the input array's contents to be unchanged");
});

test("an article whose publishedAt does not parse scores 0 and sinks to the bottom without throwing", () => {
  const malformed = article("Malformed date", "Government", "not-a-date");
  const healthy = article("Healthy", "Tech & General", hoursAgo(23));
  assert.doesNotThrow(() => rankWithinSection([malformed, healthy], NOW));
  const result = rankWithinSection([malformed, healthy], NOW);
  assert.deepEqual(result.map((a) => a.title), ["Healthy", "Malformed date"]);
  assert.equal(rankScore(malformed, NOW), 0);
});

test("TIER_WEIGHT satisfies D-10's ordering and has an entry for every SourceTier", () => {
  assert.ok(TIER_WEIGHT.Government > TIER_WEIGHT["Security Research"]);
  assert.equal(TIER_WEIGHT["Security Research"], TIER_WEIGHT["Threat Intelligence"]);
  assert.ok(TIER_WEIGHT["Security Research"] > TIER_WEIGHT["Enterprise Security"]);
  assert.equal(TIER_WEIGHT["Enterprise Security"], TIER_WEIGHT["Executive News"]);
  assert.ok(TIER_WEIGHT["Enterprise Security"] > TIER_WEIGHT["Tech & General"]);
  assert.ok(TIER_WEIGHT["Tech & General"] > 0);

  const allTiers: SourceTier[] = [
    "Government",
    "Security Research",
    "Enterprise Security",
    "Threat Intelligence",
    "Tech & General",
    "Executive News",
  ];
  for (const tier of allTiers) {
    assert.equal(typeof TIER_WEIGHT[tier], "number", `expected a numeric weight for ${tier}`);
  }
});
