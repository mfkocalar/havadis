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
