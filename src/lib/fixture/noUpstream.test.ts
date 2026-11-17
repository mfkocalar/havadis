import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fetchEpss } from "../enrichment/epss.ts";
import { produceKev } from "../enrichment/kev.ts";
import { produceSsvc } from "../enrichment/ssvc.ts";
import { getFrontPage } from "../pipeline/getFrontPage.ts";
import { FIXTURE_MARKER_TITLE } from "./edition.ts";

/**
 * With the fixture switch on, the four cut points make zero outbound requests,
 * and an injected fetcher still wins at each producer (D-01, D-02, MOB-01).
 *
 * The switch is set here at file top, in this file's own process only:
 * node:test runs each test file in its own child process, so it cannot leak into
 * other files (fixtureMode.test.ts checks the npm test process stays clean).
 * Both env values and globalThis.fetch are restored in `after`.
 */

process.env.HAVADIS_FIXTURE_EDITION = "1";
process.env.HAVADIS_FIXTURE_LOCAL = "1";

const NOW = Date.parse("2099-06-01T12:00:00.000Z");
const realFetch = globalThis.fetch;
const fetchCalls: string[] = [];

before(() => {
  globalThis.fetch = (async (input: unknown) => {
    fetchCalls.push(String(input));
    throw new Error("outbound request attempted in fixture mode");
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
  delete process.env.HAVADIS_FIXTURE_EDITION;
  delete process.env.HAVADIS_FIXTURE_LOCAL;
});

/** A stub fetcher that records each call and answers 500, so a producer rejects or degrades without a network. */
function recordingFetcher() {
  const calls: string[] = [];
  const fetcher = async (url: string): Promise<Response> => {
    calls.push(url);
    return new Response("nope", { status: 500 });
  };
  return { calls, fetcher: fetcher as never };
}

test("getFrontPage composes the fixture edition with no request", async () => {
  const result = await getFrontPage(NOW);
  assert.equal(result.status, "ok");
  assert.ok(result.status === "ok" && result.articles.some((a) => a.title === FIXTURE_MARKER_TITLE));
  assert.equal(fetchCalls.length, 0);
});

test("produceKev returns the fixture map with no request", async () => {
  const map = await produceKev(NOW);
  assert.equal(map.catalogVersion, "fixture");
  assert.equal(fetchCalls.length, 0);
});

test("fetchEpss answers every valid ID from the fixture with no request", async () => {
  const ids = ["CVE-2099-10002", "CVE-2099-10004", "CVE-2099-10005"];
  const out = await fetchEpss(ids);
  for (const id of ids) assert.ok(Object.hasOwn(out, id), id);
  assert.equal(fetchCalls.length, 0);
});

test("produceSsvc answers from the fixture with no request, and still rejects an invalid ID", async () => {
  const state = await produceSsvc("CVE-2099-10002");
  assert.equal(state.state, "assessed");
  assert.ok(state.state === "assessed" && state.exploitation === "active");
  await assert.rejects(produceSsvc("not-a-cve"), /ssvc: invalid id/);
  assert.equal(fetchCalls.length, 0);
});

test("no producer touched globalThis.fetch across the whole file", () => {
  assert.deepEqual(fetchCalls, []);
});

test("an injected fetcher still wins in produceKev with the switch on", async () => {
  const { calls, fetcher } = recordingFetcher();
  await produceKev(NOW, { fetcher }).catch(() => undefined);
  assert.ok(calls.length >= 1);
});

test("an injected fetcher still wins in fetchEpss with the switch on", async () => {
  const { calls, fetcher } = recordingFetcher();
  await fetchEpss(["CVE-2099-10002"], { fetcher });
  assert.ok(calls.length >= 1);
});

test("an injected fetcher still wins in produceSsvc with the switch on", async () => {
  const { calls, fetcher } = recordingFetcher();
  await produceSsvc("CVE-2099-10002", { fetcher }).catch(() => undefined);
  assert.ok(calls.length >= 1);
});
