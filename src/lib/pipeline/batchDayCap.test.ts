import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Parser from "rss-parser";
import { normalize } from "./normalize.ts";
import { applySourceWindow } from "./applySourceWindow.ts";
import { SOURCES } from "../config/sources.ts";
import { LOOKBACK_HOURS, SOURCE_TYPES } from "../config/sourceTypes.ts";
import { makeArticle, makeSource } from "../../../test/fixtures/makeArticle.ts";
import type { Article } from "../types.ts";

/**
 * SC3 proof for flood feeds (Phase 7.1 D-12, D-13, SRC-07): a trimmed real
 * Palo Alto advisory batch day, parsed by the real rss-parser, normalized and
 * windowed with no network and an explicit `now` (never the wall clock). Plus
 * the window, cap and tie edges, and a property over every configured source
 * that sets `maxItems`, so flood feeds added later are covered automatically.
 */

const HOUR_MS = 60 * 60 * 1000;
const CAP = 5;

const iso = (ms: number) => new Date(ms).toISOString();

const FIXTURE = readFileSync(
  new URL("../../../test/fixtures/feeds/advisory-batch-day.xml", import.meta.url),
  "utf8"
);

const floodSource = makeSource({
  name: "Palo Alto Security Advisories",
  tier: "Enterprise Security",
  sourceType: "advisory",
  maxItems: CAP,
});
const uncappedSource = { ...floodSource, maxItems: undefined };

async function loadFixtureArticles(): Promise<{ articles: Article[]; now: number }> {
  const feed = await new Parser().parseString(FIXTURE);
  const articles = feed.items
    .map((item) => normalize(item, floodSource))
    .filter((a): a is Article => a !== null);
  const newest = Math.max(...articles.map((a) => Date.parse(a.publishedAt)));
  return { articles, now: newest + 2 * HOUR_MS };
}

test("the fixture is a real batch day: at least 6 articles survive the window without a cap", async () => {
  const { articles, now } = await loadFixtureArticles();
  const survivors = applySourceWindow(articles, uncappedSource, now);
  assert.ok(survivors.length >= 6, `expected at least 6 in-window articles, got ${survivors.length}`);
});

test("maxItems 5 keeps exactly 5, all in-window, each at least as new as every dropped in-window item (SC3)", async () => {
  const { articles, now } = await loadFixtureArticles();
  const inWindow = applySourceWindow(articles, uncappedSource, now);
  const kept = applySourceWindow(articles, floodSource, now);
  assert.equal(kept.length, CAP);
  const inWindowUrls = new Set(inWindow.map((a) => a.url));
  for (const a of kept) assert.ok(inWindowUrls.has(a.url), `${a.url} must be an in-window article`);
  const keptUrls = new Set(kept.map((a) => a.url));
  const dropped = inWindow.filter((a) => !keptUrls.has(a.url));
  assert.ok(dropped.length > 0, "a batch day must drop at least one in-window article");
  const oldestKept = Math.min(...kept.map((a) => Date.parse(a.publishedAt)));
  for (const a of dropped) {
    assert.ok(
      oldestKept >= Date.parse(a.publishedAt),
      `kept item at ${new Date(oldestKept).toISOString()} is older than dropped ${a.publishedAt}`
    );
  }
});

test("8 items with an identical publishedAt, capped at 5, keep the first 5 in input order", () => {
  const publishedAt = "2026-10-14T16:00:00.000Z";
  const now = Date.parse(publishedAt) + HOUR_MS;
  const tied = Array.from({ length: 8 }, () => makeArticle({ sourceType: "advisory", publishedAt }));
  const kept = applySourceWindow(tied, floodSource, now);
  assert.deepEqual(kept, tied.slice(0, CAP));
});

for (const type of SOURCE_TYPES) {
  test(`${type}: an item exactly LOOKBACK_HOURS old is kept and one 1 ms older is dropped`, () => {
    const source = makeSource({ sourceType: type });
    const now = Date.parse("2026-10-20T12:00:00.000Z");
    const cutoff = now - LOOKBACK_HOURS[type] * HOUR_MS;
    const onEdge = makeArticle({ sourceType: type, publishedAt: iso(cutoff) });
    const justOutside = makeArticle({ sourceType: type, publishedAt: iso(cutoff - 1) });
    assert.deepEqual(applySourceWindow([onEdge, justOutside], source, now), [onEdge]);
  });
}

test("a capped source yields [] for no items and the single item for one in-window item", () => {
  const now = Date.parse("2026-10-20T12:00:00.000Z");
  assert.deepEqual(applySourceWindow([], floodSource, now), []);
  const one = makeArticle({ sourceType: "advisory", publishedAt: iso(now - HOUR_MS) });
  assert.deepEqual(applySourceWindow([one], floodSource, now), [one]);
});

test("every configured source with maxItems keeps exactly maxItems, the newest ones, from 20 in-window items", () => {
  const capped = SOURCES.filter((s) => s.maxItems !== undefined);
  assert.ok(capped.length > 0, "at least one configured source must set maxItems");
  const now = Date.parse("2026-10-20T12:00:00.000Z");
  for (const source of capped) {
    const maxItems = source.maxItems as number;
    // Oldest first in input order; one minute apart, all well inside every window.
    const items = Array.from({ length: 20 }, (_, i) =>
      makeArticle({
        sourceType: source.sourceType,
        publishedAt: iso(now - (20 - i) * 60_000),
      })
    );
    const kept = applySourceWindow(items, source, now);
    assert.equal(kept.length, maxItems, `${source.id}: must keep exactly maxItems`);
    const newest = [...items].reverse().slice(0, maxItems);
    assert.deepEqual(kept, newest, `${source.id}: must keep the newest maxItems items`);
  }
});
