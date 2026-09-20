import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchWithValidatedRedirect } from "./fetchWithValidatedRedirect.ts";
import { fetchSource } from "./fetchSource.ts";
import { startHostileServer } from "../../../test/fixtures/hostileRedirectServer.ts";
import type { SourceConfig } from "../types.ts";

/**
 * Reject-path, timeout, and follow-path tests for `fetchWithValidatedRedirect`.
 *
 * RESEARCH.md Pitfall P1-3 notes that nothing in production traffic
 * exercises "reject an invalid redirect" or "abort a hanging origin" —
 * Krebs's own real redirect is same-host + HTTPS, so it only proves the
 * "follow a valid redirect" path. The reject-path and timeout tests below
 * start a hermetic local HTTP fixture (`startHostileServer`) and point the
 * function under test at its ephemeral URL, so those branches are proven
 * against a real socket rather than assumed from reading the code.
 *
 * The follow-path tests (exactly-5-hop success, 6th-hop rejection, and the
 * single-hop follow) use a mocked `fetch` instead of the fixture: a
 * legitimate redirect chain must be HTTPS per `fetchWithValidatedRedirect`'s
 * own protocol guard, and this fixture is deliberately plain HTTP (no
 * dependency-free way to serve a locally-trusted TLS certificate without
 * either adding a new dependency or globally disabling certificate
 * verification for the test process — both rejected as worse trade-offs
 * than a deterministic mock for these three hop-counting cases). The mock
 * proves the same loop-boundary logic exactly, with no flakiness risk.
 *
 * The "subdomain label prepended" suffix-lookalike test also uses a mocked
 * `fetch` rather than the fixture, for a narrower reason: the fixture binds
 * a raw dotted-quad IPv4 address (127.0.0.1), and the WHATWG URL host
 * parser treats any hostname ending in a numeric label (as any
 * "sub.127.0.0.1"-shaped string does) as an IPv4-parse candidate — parsing
 * then fails outright (a thrown "Invalid URL", not a controlled rejection)
 * because "sub" isn't numeric. A real domain name has no such trailing-digit
 * constraint, so the mock below reproduces the plan's literal
 * "sub.krebsonsecurity.com" example exactly, which the IP-bound fixture
 * structurally cannot.
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

// --- Reject-path tests, against the real hermetic fixture -----------------

test("rejects a redirect whose target host differs from the original host", async () => {
  const server = await startHostileServer();
  try {
    await assert.rejects(
      () => fetchWithValidatedRedirect(`${server.baseUrl}/cross-host`),
      /host mismatch/,
      "cross-host redirect must be rejected for host mismatch, not some other cause"
    );
  } finally {
    await server.close();
  }
});

test("rejects a redirect whose target protocol is not https, even when the host matches", async () => {
  const server = await startHostileServer();
  try {
    await assert.rejects(
      () => fetchWithValidatedRedirect(`${server.baseUrl}/non-https`),
      /non-HTTPS/,
      "a same-host but non-HTTPS target must be rejected for its protocol, not treated as a host mismatch"
    );
  } finally {
    await server.close();
  }
});

test("rejects a redirect target that is the original host with a subdomain label prepended", async () => {
  await withMockFetch(
    mockFetchSequence([
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://sub.original.test/" },
        }),
    ]),
    async () => {
      await assert.rejects(
        () => fetchWithValidatedRedirect("https://original.test/feed"),
        /host mismatch/,
        "a host that merely ends with the real host must still be rejected — comparison is exact equality, not a suffix match"
      );
    }
  );
});

test("rejects a redirect target with the original host as a prefix of a longer domain", async () => {
  const server = await startHostileServer();
  try {
    await assert.rejects(
      () => fetchWithValidatedRedirect(`${server.baseUrl}/prefix-lookalike`),
      /host mismatch/,
      "a host that merely starts with the real host must still be rejected — comparison is exact equality, not a substring match"
    );
  } finally {
    await server.close();
  }
});

test("rejects a 3xx response carrying no Location header", async () => {
  const server = await startHostileServer();
  try {
    await assert.rejects(
      () => fetchWithValidatedRedirect(`${server.baseUrl}/no-location`),
      /no Location header/,
      "a redirect status with no Location header must be its own distinct rejection cause"
    );
  } finally {
    await server.close();
  }
});

// --- Timeout tests, against the real hermetic fixture's hang endpoint -----
// These necessarily run for the full per-hop timeout (~8s of real wall
// time) — proving the abort fires requires letting it fire.

test("aborts a hanging origin at the per-hop timeout rather than hanging forever", async () => {
  const server = await startHostileServer();
  const start = Date.now();
  try {
    await assert.rejects(() => fetchWithValidatedRedirect(`${server.baseUrl}/hang`));
    const elapsedMs = Date.now() - start;
    assert.ok(
      elapsedMs >= 7_000,
      `expected the abort to fire near the 8s timeout, took only ${elapsedMs}ms`
    );
  } finally {
    await server.close();
  }
});

test("fetchSource resolves to the error variant on a hanging origin rather than rejecting or hanging the caller", async () => {
  const server = await startHostileServer();
  try {
    const source: SourceConfig = {
      id: "hostile-hang",
      name: "Hostile Hang Fixture",
      tier: "Security Research",
      url: `${server.baseUrl}/hang`,
    };
    const result = await fetchSource(source);
    assert.equal(
      result.status,
      "error",
      "a never-responding origin must surface as the never-throwing fetcher's error variant"
    );
  } finally {
    await server.close();
  }
});

// --- Stalled-body timeout test, against the real hermetic fixture --------
// This necessarily runs for the full per-source budget (~8s of real wall
// time) — proving an abort fires requires letting it fire.

test(
  "fetchSource aborts a headers-then-stalled body within the per-source budget",
  { timeout: 20_000 },
  async () => {
    const server = await startHostileServer();
    const start = Date.now();
    try {
      const source: SourceConfig = {
        id: "hostile-slow-body",
        name: "Hostile Slow Body Fixture",
        tier: "Security Research",
        url: `${server.baseUrl}/slow-body`,
      };
      const result = await fetchSource(source);
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

// --- Follow-path tests, via a deterministic mocked fetch -------------------

test("follows a single legitimate same-host HTTPS redirect to completion", async () => {
  await withMockFetch(
    mockFetchSequence([
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://original.test/feed/" },
        }),
      () => new Response("ok", { status: 200 }),
    ]),
    async () => {
      const res = await fetchWithValidatedRedirect("https://original.test/feed");
      assert.equal(res.status, 200);
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
