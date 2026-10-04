import { test } from "node:test";
import assert from "node:assert/strict";
import Parser from "rss-parser";
import { normalize } from "./normalize.ts";
import { applySourceWindow } from "./applySourceWindow.ts";
import { makeSource } from "../../../test/fixtures/makeArticle.ts";

/**
 * Hermetic proof of the EU CERT root cause (SRC-02, SRC-03, D-10): a feed
 * shaped like the live CERT-EU advisories feed, with CEST/CET pubDates that
 * V8 cannot parse (so rss-parser sets no isoDate) and newline-padded links,
 * parsed by the real rss-parser with no network, then normalized and windowed.
 */

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>CERT-EU Security Advisories</title>
    <link>https://cert.europa.eu/publications/security-advisories</link>
    <description>Security advisories</description>
    <item>
      <title>2026-014 - Critical Vulnerabilities in Citrix NetScaler</title>
      <link>
        https://cert.europa.eu/publications/security-advisories/2026-014/
      </link>
      <pubDate>Sun, 27 Sep 2026 19:40:52 CEST</pubDate>
      <description>Citrix has released security updates.</description>
    </item>
    <item>
      <title>2026-001 - Vulnerabilities in a widely used product</title>
      <link>
        https://cert.europa.eu/publications/security-advisories/2026-001/
      </link>
      <pubDate>Mon, 05 Jan 2026 10:00:00 CET</pubDate>
      <description>An older advisory.</description>
    </item>
  </channel>
</rss>`;

const certSource = makeSource({
  id: "cert-eu",
  name: "CERT-EU Security Advisories",
  tier: "Government",
  sourceType: "cert",
  url: "https://www.cert.europa.eu/publications/security-advisories-rss",
});

test("CERT-EU-shaped items have no isoDate from rss-parser, yet normalize keeps every one", async () => {
  const feed = await new Parser().parseString(FEED);
  assert.equal(feed.items.length, 2);
  for (const item of feed.items) {
    assert.equal(item.isoDate, undefined, "rss-parser must not set isoDate for CEST/CET");
  }
  const articles = feed.items.map((item) => normalize(item, certSource));
  for (const [i, article] of articles.entries()) {
    assert.ok(article !== null, `item ${i} must survive normalize`);
    assert.match(article.publishedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(article.url, article.url.trim());
    assert.match(article.url, /^https:\/\/cert\.europa\.eu\//);
  }
});

test("a 48h-old CERT-EU advisory survives a cert window and is dropped by a news window", async () => {
  const feed = await new Parser().parseString(FEED);
  const articles = feed.items.map((item) => normalize(item, certSource));
  const newer = articles[0];
  assert.ok(newer !== null);
  const now = Date.parse(newer.publishedAt) + 48 * 60 * 60 * 1000;

  const certKept = applySourceWindow([newer], certSource, now);
  assert.deepEqual(certKept, [newer]);

  const newsSource = makeSource({ sourceType: "news" });
  assert.deepEqual(applySourceWindow([newer], newsSource, now), []);
});
