import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { SOURCES } from "../config/sources.ts";
import { fetchSource } from "./fetchSource.ts";

/**
 * Hermetic tests for the per-source body-size cap. No network: the response
 * is served by a mocked global fetch.
 */

// A valid one-item feed padded past the shared 2MB cap with an XML comment.
const BIG_RSS =
  '<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>' +
  "<item><title>Big item</title><link>https://fixture.test/a</link>" +
  "<pubDate>Sun, 04 Oct 2026 10:00:00 GMT</pubDate></item>" +
  `<!-- ${"x".repeat(3 * 1024 * 1024)} --></channel></rss>`;

async function fetchBig(maxBodyBytes?: number) {
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    new Response(BIG_RSS, { status: 200, headers: { "content-type": "application/rss+xml" } })
  );
  try {
    return await fetchSource({ ...SOURCES[0], url: "https://fixture.test/big.xml", maxBodyBytes });
  } finally {
    fetchMock.mock.restore();
  }
}

test("a body over the shared 2MB cap is rejected by default", async () => {
  const result = await fetchBig();
  assert.equal(result.status, "error");
});

test("a source's maxBodyBytes admits a body over the shared cap", async () => {
  const result = await fetchBig(4 * 1024 * 1024);
  assert.equal(result.status, "ok");
});
