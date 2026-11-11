import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { startEnrichmentServer, type EnrichmentServer } from "../../../test/fixtures/enrichmentServer.ts";
import { makeLoopbackFetch } from "../../../test/fixtures/loopbackFetch.ts";
import { EgressDenied, RedirectError } from "../egress/errors.ts";
import { boundedFetchJson } from "./boundedFetch.ts";

/**
 * `boundedFetchJson` against real sockets (Phase 7.2, Plan 02): the
 * `acceptStatuses` option reads and parses the body of a listed non-2xx status
 * under the same byte cap and time budget, and leaves every other status as it
 * was, so EPSS and KEV behave exactly as before.
 */

let server: EnrichmentServer;
before(async () => {
  server = await startEnrichmentServer();
});
after(async () => {
  await server.close();
});

const OPTS = { maxBytes: 64 * 1024, timeoutMs: 1_000 };
const DEPS = { fetcher: makeLoopbackFetch() };
const DNE_URL = () => `${server.baseUrl}/ssvc-dne/CVE-2024-43001`;

test("without acceptStatuses a 500 is still ok false with reason status 500", async () => {
  const res = await boundedFetchJson(`${server.baseUrl}/status-500`, OPTS, DEPS);
  assert.deepStrictEqual(res, { ok: false, reason: "status 500", code: "http_error" });
});

test("without acceptStatuses a 200 is ok true and carries its status", async () => {
  const res = await boundedFetchJson(`${server.baseUrl}/epss-ok?cve=CVE-2024-10000&limit=100`, OPTS, DEPS);
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.status, 200);
});

test("without acceptStatuses a 404 is ok false with reason status 404", async () => {
  const res = await boundedFetchJson(DNE_URL(), OPTS, DEPS);
  assert.deepStrictEqual(res, { ok: false, reason: "status 404", code: "http_error" });
});

test("with acceptStatuses [404] a 404 body is read and parsed, ok true with status 404", async () => {
  const res = await boundedFetchJson(DNE_URL(), { ...OPTS, acceptStatuses: [404] }, DEPS);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.status, 404);
    assert.deepStrictEqual(res.json, {
      error: "CVE_RECORD_DNE",
      message: "The cve record for the cve id does not exist.",
    });
  }
});

test("acceptStatuses lists only what it names: a 500 is still rejected", async () => {
  const res = await boundedFetchJson(`${server.baseUrl}/status-500`, { ...OPTS, acceptStatuses: [404] }, DEPS);
  assert.deepStrictEqual(res, { ok: false, reason: "status 500", code: "http_error" });
});

test("an accepted 404 with a malformed body is ok false invalid JSON", async () => {
  const res = await boundedFetchJson(`${server.baseUrl}/nowhere-at-all`, { ...OPTS, acceptStatuses: [404] }, DEPS);
  assert.equal(res.ok, false);
});

test("an accepted status does not lift the byte cap: /oversize is still rejected", async () => {
  const res = await boundedFetchJson(`${server.baseUrl}/oversize`, {
    maxBytes: 16_384,
    timeoutMs: 1_000,
    acceptStatuses: [404, 200],
  }, DEPS);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.match(res.reason, /byte cap/);
    assert.equal(res.code, "body_too_large");
  }
});

test("an accepted status does not lift the time budget: /hang is still rejected", async () => {
  const res = await boundedFetchJson(`${server.baseUrl}/hang`, {
    maxBytes: 16_384,
    timeoutMs: 200,
    acceptStatuses: [404],
  }, DEPS);
  assert.deepStrictEqual(res, { ok: false, reason: "timeout after 200 ms", code: "timeout" });
});

/** A throwaway server whose `/json/<n>` route answers a valid JSON string of exactly n bytes. */
async function withSizedServer<T>(body: (baseUrl: string) => Promise<T>): Promise<T> {
  const sized = http.createServer((req, res) => {
    const n = Number(/^\/json\/(\d+)$/.exec(req.url ?? "")?.[1] ?? 0);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(`"${"a".repeat(n - 2)}"`);
  });
  await new Promise<void>((resolve) => sized.listen(0, "127.0.0.1", resolve));
  try {
    return await body(`http://127.0.0.1:${(sized.address() as AddressInfo).port}`);
  } finally {
    sized.closeAllConnections();
    await new Promise<void>((resolve) => sized.close(() => resolve()));
  }
}

test("SAFE-01/boundary: a body of exactly maxBytes is accepted", async () => {
  await withSizedServer(async (baseUrl) => {
    const res = await boundedFetchJson(`${baseUrl}/json/1024`, { maxBytes: 1024, timeoutMs: 1_000 }, DEPS);
    assert.equal(res.ok, true);
    if (res.ok) assert.equal((res.json as string).length, 1022);
  });
});

test("SAFE-01/boundary: a body of maxBytes + 1 is refused with code body_too_large", async () => {
  await withSizedServer(async (baseUrl) => {
    const res = await boundedFetchJson(`${baseUrl}/json/1025`, { maxBytes: 1024, timeoutMs: 1_000 }, DEPS);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.code, "body_too_large");
  });
});

test("every failure class maps to its fixed code and never carries body text", async () => {
  const cases: Array<[string, () => Promise<Response>, string]> = [
    ["egress denial keeps its code", async () => { throw new EgressDenied("egress_denied_private"); }, "egress_denied_private"],
    ["a redirect failure", async () => { throw new RedirectError(); }, "redirect_error"],
    ["any other throw", async () => { throw new Error("socket exploded"); }, "network_error"],
    ["invalid JSON", async () => new Response("secret upstream text"), "parse_error"],
  ];
  for (const [label, fetcher, code] of cases) {
    const res = await boundedFetchJson("https://example.test/x", OPTS, { fetcher });
    assert.equal(res.ok, false, label);
    if (!res.ok) {
      assert.equal(res.code, code, label);
      assert.doesNotMatch(res.reason, /secret upstream text/, label);
    }
  }
});
