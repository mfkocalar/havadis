import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCES } from "../config/sources.ts";
import { fetchSource } from "./fetchSource.ts";
import { getFrontPage } from "./getFrontPage.ts";

/**
 * End-to-end test driving the whole traced path against the live Krebs on
 * Security feed — not a per-layer unit test. Under plain `node --test`
 * there is no Next.js runtime; native fetch simply ignores the
 * unrecognised `next` init property, so the pipeline runs unchanged.
 */

test("fetchSource(Krebs) yields at least one normalized article before lookback filtering", async () => {
  const result = await fetchSource(SOURCES[0]);
  assert.equal(result.status, "ok", "expected fetchSource to succeed against the live feed");
  if (result.status !== "ok") return;
  // The feed always carries roughly ten entries regardless of their age —
  // this asserts the raw parse worked, before any 24h trimming.
  assert.ok(
    result.articles.length >= 1,
    "expected at least one normalized article from the live Krebs feed"
  );
});

test("getFrontPage() resolves to the ok variant with well-formed, current Krebs articles", async () => {
  const result = await getFrontPage();
  assert.equal(result.status, "ok", "getFrontPage must never surface an error for a healthy source");
  if (result.status !== "ok") return;

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;

  for (const article of result.articles) {
    assert.equal(typeof article.title, "string");
    assert.ok(article.title.length > 0, "title must not be empty");

    assert.equal(typeof article.url, "string");
    assert.ok(
      article.url.startsWith("https://krebsonsecurity.com/"),
      `expected a krebsonsecurity.com URL, got ${article.url}`
    );

    assert.equal(article.source, "Krebs on Security");
    assert.equal(article.sourceTier, "Security Research");

    assert.equal(typeof article.publishedAt, "string");
    const publishedMs = new Date(article.publishedAt).getTime();
    assert.ok(Number.isFinite(publishedMs), "publishedAt must parse as a valid date");
    assert.ok(
      publishedMs >= cutoff,
      `article publishedAt ${article.publishedAt} should be within the last 24 hours`
    );

    assert.equal(typeof article.summary, "string");
  }

  // Deliberately no minimum-count assertion on the post-filter list: Krebs
  // publishes only a few times a week, so a genuinely empty 24h window is
  // a correct result, not a flaky test failure.
});
