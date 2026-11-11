import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CRAWLER_CONTACT_URL,
  CRAWLER_CONTACT_CHANNEL_URL,
  USER_AGENT,
} from "./crawler.ts";
import { HAVADIS_VERSION } from "./version.ts";
import { SOURCES } from "./sources.ts";
import { fetchFeed } from "../pipeline/fetchSource.ts";

/**
 * Hermetic tests for the crawler's public identity (D-12, PLAT-04, SAFE-03, threats T-05-02 and
 * T-14-19). No network: the outgoing request is captured with a recording fetcher injected through
 * fetchFeed's options.
 */

test("CRAWLER_CONTACT_URL is the public project repository", () => {
  assert.equal(CRAWLER_CONTACT_URL, "https://github.com/mfkocalar/havadis");
});

test("USER_AGENT names HavadisBot, its package.json version and the repository", () => {
  assert.ok(USER_AGENT.includes(`HavadisBot/${HAVADIS_VERSION}`));
  assert.ok(USER_AGENT.includes("+https://github.com/mfkocalar/havadis"));
  assert.ok(USER_AGENT.endsWith(") automated cybersecurity news aggregator"));
});

test("USER_AGENT keeps the browser-compatible prefix and is printable ASCII", () => {
  assert.ok(USER_AGENT.startsWith("Mozilla/5.0 (compatible; "));
  assert.match(USER_AGENT, /^[\x20-\x7E]+$/);
  assert.equal(USER_AGENT, USER_AGENT.trim());
});

test("CRAWLER_CONTACT_CHANNEL_URL is an https or mailto URL", () => {
  const url = new URL(CRAWLER_CONTACT_CHANNEL_URL);
  assert.ok(url.protocol === "https:" || url.protocol === "mailto:");
});

test("fetchFeed sends exactly USER_AGENT on the outgoing request", async () => {
  const rss =
    '<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>' +
    "<item><title>Probe item</title><link>https://fixture.test/a</link>" +
    "<pubDate>Sun, 04 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>";
  let seen: string | null = null;
  const fetcher = async (_url: string, init?: RequestInit) => {
    seen = new Headers(init?.headers).get("User-Agent");
    return new Response(rss, {
      status: 200,
      headers: { "content-type": "application/rss+xml" },
    });
  };
  const result = await fetchFeed(
    { ...SOURCES[0], url: "https://fixture.test/ua-probe.xml" },
    { fetcher }
  );
  assert.equal(result.status, "ok");
  assert.equal(seen, USER_AGENT);
});

test("fetchSource.ts imports USER_AGENT from config/crawler.ts and has no placeholder host", () => {
  const src = readFileSync(
    new URL("../pipeline/fetchSource.ts", import.meta.url),
    "utf-8"
  );
  assert.ok(!src.includes("havadis.app"));
  assert.ok(src.includes('import { USER_AGENT } from "../config/crawler.ts";'));
});
