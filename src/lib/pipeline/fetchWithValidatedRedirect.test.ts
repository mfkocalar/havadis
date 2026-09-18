import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchWithValidatedRedirect } from "./fetchWithValidatedRedirect.ts";

/**
 * Deterministic unit tests for the redirect-rejection branches.
 *
 * RESEARCH.md Pitfall P1-3 notes that nothing in production traffic
 * exercises "reject an invalid redirect" — Krebs's own real redirect is
 * same-host + HTTPS, so it only proves the "follow a valid redirect"
 * path. These tests mock `globalThis.fetch` (no real network, no TLS
 * fixture server needed) to deterministically exercise the reject
 * branches and the exact 5-hop / 6th-hop boundary.
 */

function mockFetchSequence(handlers: Array<() => Response>) {
  let call = 0;
  return (async () => {
    const handler = handlers[Math.min(call, handlers.length - 1)];
    call++;
    return handler();
  }) as typeof fetch;
}

async function withMockFetch(mock: typeof fetch, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("rejects a redirect whose target host differs from the original host", async () => {
  await withMockFetch(
    mockFetchSequence([
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example.com/" },
        }),
    ]),
    async () => {
      await assert.rejects(
        () => fetchWithValidatedRedirect("https://original.test/feed"),
        /host mismatch/
      );
    }
  );
});

test("rejects a redirect whose target protocol is not https", async () => {
  await withMockFetch(
    mockFetchSequence([
      () =>
        new Response(null, {
          status: 302,
          // Same host as the original request, but not HTTPS.
          headers: { location: "http://original.test/feed" },
        }),
    ]),
    async () => {
      await assert.rejects(
        () => fetchWithValidatedRedirect("https://original.test/feed"),
        /non-HTTPS/
      );
    }
  );
});

test("rejects a 3xx response carrying no Location header", async () => {
  await withMockFetch(
    mockFetchSequence([() => new Response(null, { status: 302 })]),
    async () => {
      await assert.rejects(
        () => fetchWithValidatedRedirect("https://original.test/feed"),
        /no Location header/
      );
    }
  );
});

test("follows a chain of exactly 5 valid same-host HTTPS redirects to completion", async () => {
  let calls = 0;
  const mock = (async () => {
    calls++;
    if (calls <= 5) {
      return new Response(null, {
        status: 302,
        headers: { location: `https://original.test/hop-${calls}` },
      });
    }
    return new Response("ok", { status: 200 });
  }) as typeof fetch;

  await withMockFetch(mock, async () => {
    const res = await fetchWithValidatedRedirect("https://original.test/feed");
    assert.equal(res.status, 200);
    assert.equal(calls, 6, "expected the initial request plus exactly 5 redirect hops");
  });
});

test("rejects a 6th redirect hop as too many redirects", async () => {
  let calls = 0;
  const mock = (async () => {
    calls++;
    // Every response is a valid (same-host, HTTPS) redirect — the chain
    // never resolves, so hop 6 must be rejected rather than followed.
    return new Response(null, {
      status: 302,
      headers: { location: `https://original.test/hop-${calls}` },
    });
  }) as typeof fetch;

  await withMockFetch(mock, async () => {
    await assert.rejects(
      () => fetchWithValidatedRedirect("https://original.test/feed"),
      /Too many redirects/
    );
    assert.equal(calls, 6, "expected exactly 6 requests (5 followed hops + the rejected 6th)");
  });
});
