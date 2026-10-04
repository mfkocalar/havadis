import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CRAWLER_CONTACT_URL,
  CRAWLER_CONTACT_CHANNEL_URL,
  USER_AGENT,
} from "./crawler.ts";
import { SOURCES } from "./sources.ts";
import { fetchSource } from "../pipeline/fetchSource.ts";

/**
 * Hermetic tests for the crawler's public identity (D-12, PLAT-04, threat
 * T-05-02). No network: the outgoing request is captured with a mocked
 * global fetch.
 */

test("CRAWLER_CONTACT_URL is an https /about URL on a non-placeholder host", () => {
  const url = new URL(CRAWLER_CONTACT_URL);
  assert.equal(url.protocol, "https:");
  assert.equal(url.pathname, "/about");
  assert.notEqual(url.hostname, "havadis.app");
  assert.ok(!url.hostname.endsWith(".havadis.app"));
});

test("USER_AGENT keeps the browser-compatible shape and embeds the contact URL", () => {
  assert.ok(USER_AGENT.startsWith("Mozilla/5.0 (compatible; HavadisBot/"));
  assert.ok(USER_AGENT.includes(`+${CRAWLER_CONTACT_URL})`));
  assert.equal(USER_AGENT, USER_AGENT.trim());
});

test("CRAWLER_CONTACT_CHANNEL_URL is an https or mailto URL", () => {
  const url = new URL(CRAWLER_CONTACT_CHANNEL_URL);
  assert.ok(url.protocol === "https:" || url.protocol === "mailto:");
});

test("fetchSource sends exactly USER_AGENT on the outgoing request", async () => {
  const rss =
    '<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>' +
    "<item><title>Probe item</title><link>https://fixture.test/a</link>" +
    "<pubDate>Sun, 04 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>";
  let seen: string | null = null;
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async (_input: unknown, init?: RequestInit) => {
      seen = new Headers(init?.headers).get("User-Agent");
      return new Response(rss, {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
      });
    }
  );
  try {
    const result = await fetchSource({
      ...SOURCES[0],
      url: "https://fixture.test/ua-probe.xml",
    });
    assert.equal(result.status, "ok");
    assert.equal(seen, USER_AGENT);
  } finally {
    fetchMock.mock.restore();
  }
});

test("fetchSource.ts imports USER_AGENT from config/crawler.ts and has no placeholder host", () => {
  const src = readFileSync(
    new URL("../pipeline/fetchSource.ts", import.meta.url),
    "utf-8"
  );
  assert.ok(!src.includes("havadis.app"));
  assert.ok(src.includes('import { USER_AGENT } from "../config/crawler.ts";'));
});
