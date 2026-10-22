import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escapeXml,
  FEED_VARIANTS,
  feedPath,
  findFeedVariant,
  selectFeedArticles,
  toJsonFeed,
  toRss,
  type FeedContext,
} from "./buildFeed.ts";
import type { ClassifiedArticle, SectionedFrontPageResult } from "../types.ts";

/**
 * Unit tests for buildFeed.ts: hostile feed text can never break the XML,
 * scopes select the right items newest first, and both formats carry the
 * triage fields. Fixed fixtures only; no network.
 */

function article(overrides: Partial<ClassifiedArticle>): ClassifiedArticle {
  return {
    title: "Title",
    url: "https://example.com/a",
    source: "Krebs on Security",
    sourceTier: "Security Research",
    sourceType: "news",
    publishedAt: "2026-10-22T08:00:00.000Z",
    summary: "Summary",
    section: "Industry/Policy",
    cves: [],
    importance: "normal",
    importanceReason: null,
    id: "id",
    ...overrides,
  };
}

const CRIT = article({
  title: `Zero-day <script>alert("x")</script> & "quotes"\u0000\u0008`,
  url: "https://example.com/crit?a=1&b=2",
  publishedAt: "2026-10-22T07:00:00.000Z",
  section: "Vulnerabilities",
  cves: ["CVE-2026-1234"],
  importance: "critical",
  importanceReason: "Zero-day",
  id: "c",
});
const HIGH = article({ url: "https://example.com/high", importance: "high", importanceReason: "Breach", section: "Breaches", publishedAt: "2026-10-22T09:00:00.000Z", id: "h" });
const NORMAL = article({ url: "https://example.com/n", summary: "", source: "Not A Configured Source", id: "n" });

const RESULT: SectionedFrontPageResult = {
  status: "ok",
  articles: [CRIT, HIGH, NORMAL],
  sections: [],
  generatedAt: "2026-10-22T09:30:00.000Z",
};

function ctx(slug: string, articles: ClassifiedArticle[]): FeedContext {
  return {
    variant: findFeedVariant(slug)!,
    articles,
    generatedAt: RESULT.status === "ok" ? RESULT.generatedAt : "",
    siteUrl: "https://news.example",
    siteName: "Havadis",
    siteDescription: "Desc & more",
  };
}

test("escapeXml escapes markup and drops XML-forbidden control characters", () => {
  assert.equal(escapeXml(`<a href="x">&'</a>\u0000\u001F￾ ok`), "&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt; ok");
  assert.equal(escapeXml("emoji 🐛 stays"), "emoji 🐛 stays");
});

test("variants: 'all' lives at /feed.<format>, others at /feed/<slug>.<format>, slugs are unique", () => {
  assert.equal(feedPath(findFeedVariant("all")!, "xml"), "/feed.xml");
  assert.equal(feedPath(findFeedVariant("threat-intelligence")!, "json"), "/feed/threat-intelligence.json");
  assert.equal(findFeedVariant("tools-techniques")?.title, "Tools/Techniques");
  assert.equal(new Set(FEED_VARIANTS.map((v) => v.slug)).size, FEED_VARIANTS.length);
});

test("selectFeedArticles scopes by importance or section and sorts newest first", () => {
  assert.deepEqual(selectFeedArticles(RESULT, { kind: "all" }).map((a) => a.id), ["h", "n", "c"]);
  assert.deepEqual(selectFeedArticles(RESULT, { kind: "importance", min: "high" }).map((a) => a.id), ["h", "c"]);
  assert.deepEqual(selectFeedArticles(RESULT, { kind: "importance", min: "critical" }).map((a) => a.id), ["c"]);
  assert.deepEqual(selectFeedArticles(RESULT, { kind: "section", section: "Breaches" }).map((a) => a.id), ["h"]);
  assert.deepEqual(selectFeedArticles({ status: "error", reason: "x" }, { kind: "all" }), []);
});

test("RSS output is escaped, self-linked and carries the triage fields", () => {
  const xml = toRss(ctx("critical", [CRIT]));
  assert.ok(xml.startsWith(`<?xml version="1.0" encoding="UTF-8"?>`));
  assert.ok(xml.includes(`<atom:link href="https://news.example/feed/critical.xml" rel="self"`));
  assert.ok(xml.includes("<title>Havadis: Critical only</title>"));
  assert.ok(xml.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;quotes&quot;</title>"));
  assert.ok(!/[\u0000\u0008]/.test(xml), "control characters must be stripped");
  assert.ok(!xml.includes("<script>"));
  assert.ok(xml.includes("<link>https://example.com/crit?a=1&amp;b=2</link>"));
  assert.ok(xml.includes("<pubDate>Thu, 22 Oct 2026 07:00:00 GMT</pubDate>"));
  assert.ok(xml.includes(`<source url="https://krebsonsecurity.com/feed/">Krebs on Security</source>`));
  assert.ok(xml.includes("<havadis:importance>critical</havadis:importance>"));
  assert.ok(xml.includes("<havadis:reason>Zero-day</havadis:reason>"));
  assert.ok(xml.includes("<havadis:cve>CVE-2026-1234</havadis:cve>"));
  assert.ok(xml.includes("<description>Desc &amp; more</description>"));
});

test("RSS omits an empty description and falls back to havadis:source for an unknown source", () => {
  const xml = toRss(ctx("all", [NORMAL]));
  const item = xml.slice(xml.indexOf("<item>"));
  assert.ok(!item.includes("<description>"));
  assert.ok(item.includes("<havadis:source>Not A Configured Source</havadis:source>"));
  assert.ok(!item.includes("<havadis:reason>"));
});

test("JSON Feed is valid 1.1 shape with the _havadis extension", () => {
  const feed = JSON.parse(toJsonFeed(ctx("all", [CRIT, NORMAL])));
  assert.equal(feed.version, "https://jsonfeed.org/version/1.1");
  assert.equal(feed.feed_url, "https://news.example/feed.json");
  assert.equal(feed._havadis.generated_at, "2026-10-22T09:30:00.000Z");
  assert.equal(feed.items[0].id, CRIT.url);
  assert.equal(feed.items[0].title, CRIT.title, "JSON keeps the raw title; JSON.stringify handles escaping");
  assert.deepEqual(feed.items[0]._havadis, {
    source: "Krebs on Security",
    source_tier: "Security Research",
    source_type: "news",
    section: "Vulnerabilities",
    importance: "critical",
    importance_reason: "Zero-day",
    cves: ["CVE-2026-1234"],
  });
  assert.equal(feed.items[1].content_text, NORMAL.title, "an item with no summary still has content_text");
  assert.equal(feed.items[1].summary, undefined);
});
