import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCES } from "../config/sources.ts";
import { fetchFeed, fetchSource } from "./fetchSource.ts";
import { EgressDenied, RedirectError } from "../egress/errors.ts";
import type { SafeFetch } from "../egress/safeFetch.ts";
import { makeLoopbackFetch } from "../../../test/fixtures/loopbackFetch.ts";
import { startHostileServer } from "../../../test/fixtures/hostileRedirectServer.ts";
import { makeSource } from "../../../test/fixtures/makeArticle.ts";

/**
 * Hermetic tests for fetchFeed (conditional GET, fixed error codes, Retry-After) and for the
 * per-source body-size cap. No network: responses are served by a fetcher injected through the
 * options parameter, and no global fetch is mocked.
 */

const SOURCE = { ...SOURCES[0], url: "https://fixture.test/feed.xml" };

const RSS =
  '<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>' +
  "<item><title>Probe item</title><link>https://fixture.test/a</link>" +
  "<pubDate>Sun, 04 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>";

function rss(headers: Record<string, string> = {}): Response {
  return new Response(RSS, { status: 200, headers: { "content-type": "application/rss+xml", ...headers } });
}

/** A fetcher that records the request headers of every call and answers with `respond()`. */
function recording(respond: () => Response | Promise<Response>) {
  const seen: Headers[] = [];
  const fetcher: SafeFetch = async (_url, init) => {
    seen.push(new Headers(init?.headers));
    return respond();
  };
  return { fetcher, seen };
}

// --- Conditional GET -------------------------------------------------------------------------

test("no stored validators sends neither If-None-Match nor If-Modified-Since", async () => {
  for (const validators of [undefined, { etag: null, lastModified: null }]) {
    const { fetcher, seen } = recording(() => rss());
    await fetchFeed(SOURCE, { fetcher, validators });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].has("if-none-match"), false);
    assert.equal(seen[0].has("if-modified-since"), false);
  }
});

test("stored validators are replayed byte for byte, a weak ETag included", async () => {
  const validators = { etag: 'W/"abc"', lastModified: "Tue, 10 Nov 2026 10:00:00 GMT" };
  const { fetcher, seen } = recording(() => rss());
  await fetchFeed(SOURCE, { fetcher, validators });
  assert.equal(seen[0].get("if-none-match"), 'W/"abc"');
  assert.equal(seen[0].get("if-modified-since"), "Tue, 10 Nov 2026 10:00:00 GMT");
});

test("only the stored validator is sent when the other is null", async () => {
  const { fetcher, seen } = recording(() => rss());
  await fetchFeed(SOURCE, { fetcher, validators: { etag: '"only"', lastModified: null } });
  assert.equal(seen[0].get("if-none-match"), '"only"');
  assert.equal(seen[0].has("if-modified-since"), false);
});

test("a 200 with ETag and Last-Modified returns them as validators", async () => {
  const { fetcher } = recording(() => rss({ etag: 'W/"v2"', "last-modified": "Wed, 11 Nov 2026 08:00:00 GMT" }));
  const result = await fetchFeed(SOURCE, { fetcher });
  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.deepEqual(result.validators, { etag: 'W/"v2"', lastModified: "Wed, 11 Nov 2026 08:00:00 GMT" });
    assert.equal(result.httpStatus, 200);
    assert.equal(result.articles.length, 1);
  }
});

test("a 200 without ETag or Last-Modified returns null validators", async () => {
  const { fetcher } = recording(() => rss());
  const result = await fetchFeed(SOURCE, { fetcher });
  assert.equal(result.status, "ok");
  if (result.status === "ok") assert.deepEqual(result.validators, { etag: null, lastModified: null });
});

test("a 304 after sending validators is not-modified", async () => {
  const { fetcher } = recording(() => new Response(null, { status: 304 }));
  const result = await fetchFeed(SOURCE, { fetcher, validators: { etag: '"x"', lastModified: null } });
  assert.deepEqual(result, { status: "not-modified", httpStatus: 304 });
});

test("a 304 received when no validator was sent is http_error", async () => {
  const { fetcher } = recording(() => new Response(null, { status: 304 }));
  const result = await fetchFeed(SOURCE, { fetcher, validators: { etag: null, lastModified: null } });
  assert.deepEqual(result, { status: "error", code: "http_error", httpStatus: 304, retryAfterMs: null });
});

// --- Retry-After -----------------------------------------------------------------------------

test("429 with Retry-After in delta-seconds gives retryAfterMs in milliseconds", async () => {
  const { fetcher } = recording(() => new Response("slow down", { status: 429, headers: { "retry-after": "120" } }));
  const result = await fetchFeed(SOURCE, { fetcher });
  assert.deepEqual(result, { status: "error", code: "http_error", httpStatus: 429, retryAfterMs: 120_000 });
});

test("503 with a Retry-After HTTP-date gives the delta from the injected now", async () => {
  const now = Date.parse("2026-11-11T08:00:00.000Z");
  const { fetcher } = recording(
    () => new Response(null, { status: 503, headers: { "retry-after": "Wed, 11 Nov 2026 08:10:00 GMT" } }),
  );
  const result = await fetchFeed(SOURCE, { fetcher, now: () => now });
  assert.deepEqual(result, { status: "error", code: "http_error", httpStatus: 503, retryAfterMs: 600_000 });
});

test("a Retry-After date in the past is zero, never negative", async () => {
  const now = Date.parse("2026-11-11T08:00:00.000Z");
  const { fetcher } = recording(
    () => new Response(null, { status: 503, headers: { "retry-after": "Wed, 11 Nov 2026 07:00:00 GMT" } }),
  );
  const result = await fetchFeed(SOURCE, { fetcher, now: () => now });
  assert.equal(result.status === "error" ? result.retryAfterMs : "not an error", 0);
});

test("a missing or garbage Retry-After gives null", async () => {
  const variants: Array<Record<string, string>> = [{}, { "retry-after": "soon" }, { "retry-after": "-5" }, { "retry-after": "1.5" }];
  for (const headers of variants) {
    const { fetcher } = recording(() => new Response(null, { status: 429, headers }));
    const result = await fetchFeed(SOURCE, { fetcher });
    assert.equal(result.status === "error" ? result.retryAfterMs : "not an error", null, JSON.stringify(headers));
  }
});

test("Retry-After is clamped to six hours", async () => {
  const { fetcher } = recording(() => new Response(null, { status: 429, headers: { "retry-after": "999999999" } }));
  const result = await fetchFeed(SOURCE, { fetcher });
  assert.equal(result.status === "error" ? result.retryAfterMs : "not an error", 6 * 3_600_000);
});

test("Retry-After on a status other than 429 or 503 is ignored", async () => {
  const { fetcher } = recording(() => new Response(null, { status: 500, headers: { "retry-after": "60" } }));
  const result = await fetchFeed(SOURCE, { fetcher });
  assert.deepEqual(result, { status: "error", code: "http_error", httpStatus: 500, retryAfterMs: null });
});

// --- Fixed error codes -----------------------------------------------------------------------

function codeOf(result: Awaited<ReturnType<typeof fetchFeed>>): string {
  return result.status === "error" ? result.code : `not an error: ${result.status}`;
}

test("an HTML content-type is content_type", async () => {
  const { fetcher } = recording(() => new Response("<html>challenge</html>", { status: 200, headers: { "content-type": "text/html" } }));
  // SOURCES[0] may opt in to html content types; a plain fixture source never does.
  const plain = makeSource({ url: "https://fixture.test/plain.xml" });
  assert.equal(codeOf(await fetchFeed(plain, { fetcher })), "content_type");
});

test("malformed XML is parse_error", async () => {
  const { fetcher } = recording(() => new Response("<rss><channel><item>", { status: 200, headers: { "content-type": "application/xml" } }));
  assert.equal(codeOf(await fetchFeed(SOURCE, { fetcher })), "parse_error");
});

test("an EgressDenied keeps its code, a RedirectError is redirect_error, any other throw is network_error", async () => {
  const throwing = (error: Error): SafeFetch => async () => {
    throw error;
  };
  assert.equal(codeOf(await fetchFeed(SOURCE, { fetcher: throwing(new EgressDenied("egress_denied_private")) })), "egress_denied_private");
  assert.equal(codeOf(await fetchFeed(SOURCE, { fetcher: throwing(new RedirectError()) })), "redirect_error");
  assert.equal(codeOf(await fetchFeed(SOURCE, { fetcher: throwing(new Error("ECONNRESET")) })), "network_error");
});

test("no returned value contains upstream text", async () => {
  const secret = "UPSTREAM-SECRET-TEXT";
  const cases: SafeFetch[] = [
    async () => new Response(secret, { status: 500 }),
    async () => new Response(secret, { status: 200, headers: { "content-type": "text/html" } }),
    async () => new Response(secret, { status: 200, headers: { "content-type": "application/xml" } }),
    async () => {
      throw new Error(secret);
    },
  ];
  for (const fetcher of cases) {
    const result = await fetchFeed(SOURCE, { fetcher });
    assert.equal(result.status, "error");
    assert.ok(!JSON.stringify(result).includes(secret));
  }
});

// A valid one-item feed padded past the shared 2MB cap with an XML comment.
const BIG_RSS =
  '<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>' +
  "<item><title>Big item</title><link>https://fixture.test/a</link>" +
  "<pubDate>Sun, 04 Oct 2026 10:00:00 GMT</pubDate></item>" +
  `<!-- ${"x".repeat(3 * 1024 * 1024)} --></channel></rss>`;

async function fetchBig(maxBodyBytes?: number) {
  const fetcher = async () =>
    new Response(BIG_RSS, { status: 200, headers: { "content-type": "application/rss+xml" } });
  return fetchFeed({ ...SOURCES[0], url: "https://fixture.test/big.xml", maxBodyBytes }, { fetcher });
}

test("a body over the shared 2MB cap is body_too_large by default", async () => {
  assert.equal(codeOf(await fetchBig()), "body_too_large");
});

test("a source's maxBodyBytes admits a body over the shared cap", async () => {
  const result = await fetchBig(4 * 1024 * 1024);
  assert.equal(result.status, "ok");
});

// --- fetchSource stays a wrapper with the pinned FrontPageResult shape -------------------------

test("fetchSource still returns the FrontPageResult shape, with the reason carried as `<id>: <code>`", async () => {
  const ok = await fetchSource(SOURCE, { fetcher: recording(() => rss()).fetcher });
  assert.equal(ok.status, "ok");
  if (ok.status === "ok") assert.equal(ok.articles.length, 1);

  const failed = await fetchSource(SOURCE, { fetcher: recording(() => new Response("x", { status: 500 })).fetcher });
  assert.deepEqual(failed, { status: "error", reason: `${SOURCE.id}: http_error` });
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
  "fetchFeed aborts a headers-then-stalled body within the per-source budget with code timeout (through safeFetch)",
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
      const result = await fetchFeed(source, { fetcher: makeLoopbackFetch() });
      const elapsedMs = Date.now() - start;
      assert.equal(
        codeOf(result),
        "timeout",
        "an origin that sends headers instantly and then stalls the body must surface as a timeout, not hang indefinitely"
      );
      assert.ok(
        elapsedMs >= 7_000 && elapsedMs <= 11_000,
        `expected the abort to fire within the ~8s per-source budget, took ${elapsedMs}ms`
      );
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
