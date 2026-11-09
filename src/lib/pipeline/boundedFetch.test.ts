import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startEnrichmentServer, type EnrichmentServer } from "../../../test/fixtures/enrichmentServer.ts";
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
const DNE_URL = () => `${server.baseUrl}/ssvc-dne/CVE-2024-43001`;

test("without acceptStatuses a 500 is still ok false with reason status 500", async () => {
  const res = await boundedFetchJson(`${server.baseUrl}/status-500`, OPTS);
  assert.deepStrictEqual(res, { ok: false, reason: "status 500" });
});

test("without acceptStatuses a 200 is ok true and carries its status", async () => {
  const res = await boundedFetchJson(`${server.baseUrl}/epss-ok?cve=CVE-2024-10000&limit=100`, OPTS);
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.status, 200);
});

test("without acceptStatuses a 404 is ok false with reason status 404", async () => {
  const res = await boundedFetchJson(DNE_URL(), OPTS);
  assert.deepStrictEqual(res, { ok: false, reason: "status 404" });
});

test("with acceptStatuses [404] a 404 body is read and parsed, ok true with status 404", async () => {
  const res = await boundedFetchJson(DNE_URL(), { ...OPTS, acceptStatuses: [404] });
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
  const res = await boundedFetchJson(`${server.baseUrl}/status-500`, { ...OPTS, acceptStatuses: [404] });
  assert.deepStrictEqual(res, { ok: false, reason: "status 500" });
});

test("an accepted 404 with a malformed body is ok false invalid JSON", async () => {
  const res = await boundedFetchJson(`${server.baseUrl}/nowhere-at-all`, { ...OPTS, acceptStatuses: [404] });
  assert.equal(res.ok, false);
});

test("an accepted status does not lift the byte cap: /oversize is still rejected", async () => {
  const res = await boundedFetchJson(`${server.baseUrl}/oversize`, {
    maxBytes: 16_384,
    timeoutMs: 1_000,
    acceptStatuses: [404, 200],
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.reason, /byte cap/);
});

test("an accepted status does not lift the time budget: /hang is still rejected", async () => {
  const res = await boundedFetchJson(`${server.baseUrl}/hang`, {
    maxBytes: 16_384,
    timeoutMs: 200,
    acceptStatuses: [404],
  });
  assert.deepStrictEqual(res, { ok: false, reason: "timeout after 200 ms" });
});
