import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCES } from "../config/sources.ts";
import { fetchSource } from "./fetchSource.ts";
import { makeLoopbackFetch } from "../../../test/fixtures/loopbackFetch.ts";
import { startHostileServer } from "../../../test/fixtures/hostileRedirectServer.ts";
import { makeSource } from "../../../test/fixtures/makeArticle.ts";

/**
 * Hermetic tests for the per-source body-size cap. No network: the response
 * is served by a fetcher injected through fetchSource's deps parameter.
 */

// A valid one-item feed padded past the shared 2MB cap with an XML comment.
const BIG_RSS =
  '<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>' +
  "<item><title>Big item</title><link>https://fixture.test/a</link>" +
  "<pubDate>Sun, 04 Oct 2026 10:00:00 GMT</pubDate></item>" +
  `<!-- ${"x".repeat(3 * 1024 * 1024)} --></channel></rss>`;

async function fetchBig(maxBodyBytes?: number) {
  const fetcher = async () =>
    new Response(BIG_RSS, { status: 200, headers: { "content-type": "application/rss+xml" } });
  return fetchSource({ ...SOURCES[0], url: "https://fixture.test/big.xml", maxBodyBytes }, { fetcher });
}

test("a body over the shared 2MB cap is rejected by default", async () => {
  const result = await fetchBig();
  assert.equal(result.status, "error");
});

test("a source's maxBodyBytes admits a body over the shared cap", async () => {
  const result = await fetchBig(4 * 1024 * 1024);
  assert.equal(result.status, "ok");
});

// --- The single continuous per-source budget, pinned through safeFetch ----------------------
// These run against the hermetic 127.0.0.1 fixture through a loopback-allowing safeFetch
// (injected per call; the default fetcher is never used). The budget (8 s) must bound the header
// phase and the body phase alike, so a hanging origin and a stalled body both end in the error
// variant, while a slow body that still finishes inside the budget succeeds.

test("fetchSource resolves to the error variant on a hanging origin rather than rejecting or hanging the caller", async () => {
  const server = await startHostileServer();
  try {
    const source = makeSource({
      id: "hostile-hang",
      name: "Hostile Hang Fixture",
      tier: "Security Research",
      url: `${server.baseUrl}/hang`,
    });
    const result = await fetchSource(source, { fetcher: makeLoopbackFetch() });
    assert.equal(
      result.status,
      "error",
      "a never-responding origin must surface as the never-throwing fetcher's error variant"
    );
  } finally {
    await server.close();
  }
});

// Runs for the full per-source budget (~8s of real wall time): proving an abort fires requires
// letting it fire.
test(
  "fetchSource aborts a headers-then-stalled body within the per-source budget (through safeFetch)",
  { timeout: 20_000 },
  async () => {
    const server = await startHostileServer();
    const start = Date.now();
    try {
      const source = makeSource({
        id: "hostile-slow-body",
        name: "Hostile Slow Body Fixture",
        tier: "Security Research",
        url: `${server.baseUrl}/slow-body`,
      });
      const result = await fetchSource(source, { fetcher: makeLoopbackFetch() });
      const elapsedMs = Date.now() - start;
      assert.equal(
        result.status,
        "error",
        "an origin that sends headers instantly and then stalls the body must surface as the error variant, not hang indefinitely"
      );
      assert.ok(
        elapsedMs >= 7_000 && elapsedMs <= 11_000,
        `expected the abort to fire within the ~8s per-source budget, took ${elapsedMs}ms`
      );
      if (result.status === "error") {
        assert.match(
          result.reason,
          /per-source timeout/,
          "the reason must name the timeout cause, not just any failure"
        );
      }
    } finally {
      await server.close();
    }
  }
);

// Positive control: proves the budget does not over-fire. A careless change that aborted every
// body read would still pass the negative cases above.
test("fetchSource succeeds when the origin drips its body but finishes inside the budget (through safeFetch)", async () => {
  const server = await startHostileServer();
  const start = Date.now();
  try {
    const source = makeSource({
      id: "hostile-drip-complete",
      name: "Hostile Drip-Then-Complete Fixture",
      tier: "Security Research",
      url: `${server.baseUrl}/drip-then-complete`,
    });
    const result = await fetchSource(source, { fetcher: makeLoopbackFetch() });
    const elapsedMs = Date.now() - start;
    assert.equal(
      result.status,
      "ok",
      "a slow-but-finishing body must still succeed rather than being aborted"
    );
    if (result.status === "ok") {
      assert.ok(
        result.articles.length >= 1,
        "expected at least one article from the fixture's minimal RSS feed"
      );
    }
    assert.ok(
      elapsedMs < 3_000,
      `expected the drip-then-complete fetch to finish well under the budget, took ${elapsedMs}ms`
    );
  } finally {
    await server.close();
  }
});
