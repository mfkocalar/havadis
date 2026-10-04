import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { applySourceWindow, withSourceWindow } from "./applySourceWindow.ts";
import { fanOut } from "./fanOut.ts";
import { composeFrontPage } from "./getFrontPage.ts";
import { LOOKBACK_HOURS, SOURCE_TYPES } from "../config/sourceTypes.ts";
import { makeArticle, makeSource } from "../../../test/fixtures/makeArticle.ts";
import type { Article, FrontPageResult, SourceConfig } from "../types.ts";

/**
 * Tests for applySourceWindow / withSourceWindow (SRC-04, D-05, PLAT-03).
 */

const NOW = Date.parse("2026-09-23T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function hoursAgo(h: number): string {
  return new Date(NOW - h * HOUR).toISOString();
}

function articleFor(source: SourceConfig, publishedAt: string, title: string): Article {
  return makeArticle({
    title,
    url: `https://fixture.test/${title.replace(/\s+/g, "-").toLowerCase()}`,
    source: source.name,
    sourceTier: source.tier,
    sourceType: source.sourceType,
    publishedAt,
  });
}

test("a 48h-old cert item reaches the composed front page and a 48h-old news item does not", async () => {
  const certSrc = makeSource({
    id: "cert-src",
    name: "Cert Src",
    tier: "Government",
    sourceType: "cert",
  });
  const newsSrc = makeSource({ id: "news-src", name: "News Src", sourceType: "news" });
  const certArticle = articleFor(certSrc, hoursAgo(48), "Cert advisory");
  const newsArticle = articleFor(newsSrc, hoursAgo(48), "News story");
  const fetcher = async (source: SourceConfig): Promise<FrontPageResult> => ({
    status: "ok",
    articles: [source.id === "cert-src" ? certArticle : newsArticle],
  });

  const result = composeFrontPage(
    await fanOut([certSrc, newsSrc], withSourceWindow(fetcher, NOW)),
    NOW
  );
  const urls = result.articles.map((a) => a.url);
  assert.ok(urls.includes(certArticle.url), "48h-old cert item must survive");
  assert.ok(!urls.includes(newsArticle.url), "48h-old news item must be dropped");
});

for (const type of SOURCE_TYPES) {
  test(`window band for sourceType ${type}`, () => {
    const source = makeSource({ sourceType: type });
    const fresh = articleFor(source, hoursAgo(1), `fresh ${type}`);
    const ancient = articleFor(source, hoursAgo(200), `ancient ${type}`);
    const mid = articleFor(source, hoursAgo(48), `mid ${type}`);
    const kept = applySourceWindow([fresh, ancient, mid], source, NOW);
    assert.ok(kept.includes(fresh));
    assert.ok(!kept.includes(ancient));
    assert.equal(kept.includes(mid), LOOKBACK_HOURS[type] > 48);
  });
}

test("withSourceWindow returns an error-variant result unchanged", async () => {
  const errorResult: FrontPageResult = { status: "error", reason: "boom" };
  const wrapped = withSourceWindow(async () => errorResult, NOW);
  assert.deepEqual(await wrapped(makeSource()), errorResult);
});

test("applySourceWindow and withSourceWindow never read the wall clock", async () => {
  const source = makeSource({ sourceType: "cert" });
  const articles = [articleFor(source, hoursAgo(1), "a"), articleFor(source, hoursAgo(100), "b")];
  const spy = mock.method(Date, "now", () => {
    throw new Error("Date.now must not be called");
  });
  try {
    applySourceWindow(articles, source, NOW);
    await withSourceWindow(async () => ({ status: "ok", articles }), NOW)(source);
    assert.equal(spy.mock.callCount(), 0);
  } finally {
    spy.mock.restore();
  }
});

// ---- maxItems cap (D-07, T-05-12) ----

function eightInWindow(source: SourceConfig): Article[] {
  // Hours ago 1..8, deliberately shuffled so input order is not newest-first.
  return [5, 2, 8, 1, 6, 3, 7, 4].map((h) => articleFor(source, hoursAgo(h), `cap story ${h}h`));
}

for (const k of [1, 2, 5]) {
  test(`maxItems ${k} keeps exactly the ${k} newest in-window articles`, () => {
    const source = makeSource({ sourceType: "news", maxItems: k });
    const input = eightInWindow(source);
    const kept = applySourceWindow(input, source, NOW);
    assert.equal(kept.length, k);
    const expected = new Set(
      [...input]
        .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
        .slice(0, k)
        .map((a) => a.url)
    );
    assert.deepEqual(new Set(kept.map((a) => a.url)), expected);
  });
}

test("maxItems larger than the in-window count returns every in-window article", () => {
  const source = makeSource({ sourceType: "news", maxItems: 50 });
  assert.equal(applySourceWindow(eightInWindow(source), source, NOW).length, 8);
});

test("out-of-window stragglers never use up the cap (lookback runs before the cap)", () => {
  const source = makeSource({ sourceType: "news", maxItems: 3 });
  const inWindow = [1, 2, 3].map((h) => articleFor(source, hoursAgo(h), `in ${h}h`));
  const stale = [30, 40, 50, 60, 70].map((h) => articleFor(source, hoursAgo(h), `stale ${h}h`));
  const kept = applySourceWindow([...stale, ...inWindow], source, NOW);
  assert.deepEqual(new Set(kept.map((a) => a.url)), new Set(inWindow.map((a) => a.url)));
});

test("applySourceWindow does not mutate its input array", () => {
  const source = makeSource({ sourceType: "news", maxItems: 2 });
  const input = eightInWindow(source);
  const before = input.map((a) => a.url);
  applySourceWindow(input, source, NOW);
  assert.deepEqual(input.map((a) => a.url), before);
});

test("a maxItems that is not a positive integer applies no cap and does not throw", () => {
  for (const bad of [0, -1, 2.5]) {
    const source = makeSource({ sourceType: "news", maxItems: bad });
    assert.equal(applySourceWindow(eightInWindow(source), source, NOW).length, 8, `maxItems ${bad}`);
  }
});
