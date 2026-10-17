import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { USER_AGENT } from "../config/crawler.ts";
import type { EpssState, KevMap } from "../types.ts";
import { enrichCves } from "./enrich.ts";
import { fetchEpss, epssUrl, parseEpssChunk, selectEpssIds, sortedBatches } from "./epss.ts";
import {
  EPSS_FAIL_IDS,
  EPSS_NO_ROW_IDS,
  epssFixtureScore,
  startEnrichmentServer,
  type EnrichmentServer,
} from "../../../test/fixtures/enrichmentServer.ts";

/**
 * Hermetic tests for the EPSS batcher, URL builder and row validator (ENR-02,
 * ENR-03, D-19): no network, no clock. Fetchers are injected and built from
 * `new Response(...)`.
 */

const BASE = "https://epss.test/api";

function id(i: number): string {
  return `CVE-2024-${String(10000 + i)}`;
}

function ids(n: number, start = 0): string[] {
  return Array.from({ length: n }, (_, i) => id(start + i));
}

type Recorded = { url: string; init: RequestInit & { next?: { revalidate?: number } } };

/** A fetcher that answers every batch with a consistent OK body, skipping `noRow`, and records each request. */
function okFetcher(noRow: ReadonlySet<string> = new Set()) {
  const requests: Recorded[] = [];
  const fetcher = async (url: string, init: Recorded["init"] = {}): Promise<Response> => {
    requests.push({ url, init });
    const requested = new URL(url).searchParams.get("cve")?.split(",") ?? [];
    const data = requested
      .filter((c) => !noRow.has(c))
      .map((c) => ({ cve: c, epss: "0.910000000", percentile: "0.99", date: "2026-10-09" }));
    return new Response(JSON.stringify({ status: "OK", total: data.length, data }));
  };
  return { requests, fetcher };
}

const scored = (score: number): EpssState => ({ state: "scored", score, date: "2026-10-09" });

function body(rows: unknown[], extra: Record<string, unknown> = {}): unknown {
  return { status: "OK", total: rows.length, data: rows, ...extra };
}

const row = (cve: string, epss: unknown = "0.5", date: unknown = "2026-10-09") => ({
  cve,
  epss,
  percentile: "0.9",
  date,
});

test("selectEpssIds de-duplicates, drops bad shapes, keeps first-appearance order and splits at the cap", () => {
  const out = selectEpssIds(
    ["CVE-2024-0003", "CVE-2024-0001", "nope", "cve-2024-0002", "CVE-2024-0003", "CVE-2024-0002", "CVE-2024-0004"],
    2
  );
  assert.deepStrictEqual(out.kept, ["CVE-2024-0003", "CVE-2024-0001"]);
  assert.deepStrictEqual(out.overflow, ["CVE-2024-0002", "CVE-2024-0004"]);
  assert.deepStrictEqual(selectEpssIds([], 5), { kept: [], overflow: [] });
});

test("sortedBatches chunks sorted IDs: 0, 1, 50, 51 and 500 IDs", () => {
  assert.deepStrictEqual(sortedBatches([], 50), []);
  assert.deepStrictEqual(sortedBatches([id(0)], 50), [[id(0)]]);
  assert.deepStrictEqual(sortedBatches(ids(50), 50).map((b) => b.length), [50]);
  assert.deepStrictEqual(sortedBatches(ids(51), 50).map((b) => b.length), [50, 1]);
  const five = sortedBatches(ids(500), 50);
  assert.equal(five.length, 10);
  for (const batch of five) {
    assert.deepStrictEqual(batch, [...batch].sort());
  }
  const reversed = sortedBatches([...ids(120)].reverse(), 50);
  assert.deepStrictEqual(reversed, sortedBatches(ids(120), 50));
});

test("epssUrl joins with literal commas, and 50 sixteen-character IDs stay under 900 characters", () => {
  assert.equal(epssUrl(["CVE-2024-0001", "CVE-2024-0002"], BASE), `${BASE}?cve=CVE-2024-0001,CVE-2024-0002&limit=100`);
  const longest = Array.from({ length: 50 }, (_, i) => `CVE-2024-${String(1000000 + i)}`);
  assert.ok(longest.every((c) => c.length === 16));
  const url = epssUrl(longest, "https://api.first.org/data/v1/epss");
  assert.ok(url.length <= 900, `url is ${url.length} characters`);
  assert.ok(!url.includes("%2C"));
});

test("no IDs make no request", async () => {
  const { requests, fetcher } = okFetcher();
  const out = await fetchEpss([], { url: BASE, fetcher });
  assert.deepStrictEqual(out, {});
  assert.equal(requests.length, 0);
});

test("one ID makes exactly one request for that one ID", async () => {
  const { requests, fetcher } = okFetcher();
  const out = await fetchEpss([id(7)], { url: BASE, fetcher });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `${BASE}?cve=${id(7)}&limit=100`);
  assert.deepStrictEqual(out, { [id(7)]: scored(0.91) });
});

test("120 IDs in two input orders make the same 3 URLs byte for byte", async () => {
  const forward = okFetcher();
  const backward = okFetcher();
  await fetchEpss(ids(120), { url: BASE, fetcher: forward.fetcher });
  await fetchEpss([...ids(120)].reverse(), { url: BASE, fetcher: backward.fetcher });
  assert.equal(forward.requests.length, 3);
  const a = forward.requests.map((r) => r.url).sort();
  const b = backward.requests.map((r) => r.url).sort();
  assert.deepStrictEqual(a, b);
});

test("duplicates collapse: 60 IDs listed twice make 2 requests", async () => {
  const { requests, fetcher } = okFetcher();
  const out = await fetchEpss([...ids(60), ...ids(60)], { url: BASE, fetcher });
  assert.equal(requests.length, 2);
  assert.equal(Object.keys(out).length, 60);
});

test("501 IDs make 10 requests and the 501st input ID is unavailable even when it sorts first", async () => {
  const { requests, fetcher } = okFetcher();
  const input = [...ids(500, 1), id(0)];
  assert.equal(input.length, 501);
  assert.ok([...input].sort()[0] === id(0), "the 501st input ID sorts first");
  const out = await fetchEpss(input, { url: BASE, fetcher });
  assert.equal(requests.length, 10);
  assert.deepStrictEqual(out[id(0)], { state: "unavailable" });
  assert.equal(Object.keys(out).length, 501);
  assert.equal(out[id(1)].state, "scored");
  assert.ok(requests.every((r) => !r.url.includes(id(0))));
});

test("exactly 500 IDs make 10 requests and exactly 51 make 2", async () => {
  const a = okFetcher();
  await fetchEpss(ids(500), { url: BASE, fetcher: a.fetcher });
  assert.equal(a.requests.length, 10);
  const b = okFetcher();
  await fetchEpss(ids(51), { url: BASE, fetcher: b.fetcher });
  assert.equal(b.requests.length, 2);
  const c = okFetcher();
  await fetchEpss(ids(50), { url: BASE, fetcher: c.fetcher });
  assert.equal(c.requests.length, 1);
});

test("every request carries the crawler User-Agent and next.revalidate 3600", async () => {
  const { requests, fetcher } = okFetcher();
  await fetchEpss(ids(60), { url: BASE, fetcher });
  assert.equal(requests.length, 2);
  for (const r of requests) {
    const headers = r.init.headers as Record<string, string>;
    assert.equal(headers["User-Agent"], USER_AGENT);
    assert.deepStrictEqual(r.init.next, { revalidate: 3600 });
    assert.equal(Object.hasOwn(r.init, "cache"), false);
  }
});

test("a consistent answer maps listed IDs to scored and requested IDs without a row to no-row", async () => {
  const { fetcher } = okFetcher(new Set([id(1)]));
  const out = await fetchEpss([id(0), id(1)], { url: BASE, fetcher });
  assert.deepStrictEqual(out[id(0)], scored(0.91));
  assert.deepStrictEqual(out[id(1)], { state: "no-row" });
});

test("a 500 or a thrown fetcher makes only that batch unavailable", async () => {
  const input = ids(60);
  const batches = sortedBatches(input, 50);
  const failing = new Set(batches[0]);
  const fetcher = async (url: string): Promise<Response> => {
    const requested = new URL(url).searchParams.get("cve")?.split(",") ?? [];
    if (requested.length === 50) throw new Error("connection refused");
    const data = requested.map((c) => row(c));
    return new Response(JSON.stringify(body(data)));
  };
  const out = await fetchEpss(input, { url: BASE, fetcher });
  for (const c of failing) assert.deepStrictEqual(out[c], { state: "unavailable" });
  for (const c of batches[1]) assert.equal(out[c].state, "scored");

  const refuse = async (url: string): Promise<Response> =>
    new URL(url).searchParams.get("cve")?.includes(batches[1][0])
      ? new Response("boom", { status: 500 })
      : new Response(JSON.stringify(body(batches[0].map((c) => row(c)))));
  const out2 = await fetchEpss(input, { url: BASE, fetcher: refuse });
  for (const c of batches[1]) assert.deepStrictEqual(out2[c], { state: "unavailable" });
  for (const c of batches[0]) assert.equal(out2[c].state, "scored");
});

test("an inconsistent answer makes the whole batch unavailable, never no-row", () => {
  const batch = ["CVE-2024-0001", "CVE-2024-0002"];
  const r = row("CVE-2024-0001");
  assert.deepStrictEqual(parseEpssChunk(body([r], { total: 2 }), batch), { ok: false });
  assert.deepStrictEqual(parseEpssChunk(body([r], { status: "ERROR" }), batch), { ok: false });
  assert.deepStrictEqual(parseEpssChunk(body([r], { total: "1" }), batch), { ok: false });
  assert.deepStrictEqual(parseEpssChunk({ status: "OK", total: 0, data: "no" }, batch), { ok: false });
  assert.deepStrictEqual(parseEpssChunk({ status: "OK", total: 0 }, batch), { ok: false });
  assert.deepStrictEqual(parseEpssChunk([], batch), { ok: false });
  assert.deepStrictEqual(parseEpssChunk(null, batch), { ok: false });
  assert.deepStrictEqual(parseEpssChunk("OK", batch), { ok: false });
  const tooMany = body([row("CVE-2024-0001"), row("CVE-2024-0002"), row("CVE-2024-0003")]);
  assert.deepStrictEqual(parseEpssChunk(tooMany, batch), { ok: false });
});

test("parseEpssChunk: NaN, exponent, negative values and a bad date make that CVE unavailable", () => {
  const batch = ["CVE-2024-0001", "CVE-2024-0002", "CVE-2024-0003", "CVE-2024-0004", "CVE-2024-0005"];
  const chunk = parseEpssChunk(
    body([
      row("CVE-2024-0001", "NaN"),
      row("CVE-2024-0002", "1e999"),
      row("CVE-2024-0003", "-1"),
      row("CVE-2024-0004", "0.5", "10/09/2026"),
      row("CVE-2024-0005", "0.5"),
    ]),
    batch
  );
  assert.ok(chunk.ok);
  if (!chunk.ok) return;
  for (const c of batch.slice(0, 4)) assert.deepStrictEqual(chunk.states[c], { state: "unavailable" });
  assert.deepStrictEqual(chunk.states["CVE-2024-0005"], scored(0.5));
});

test("parseEpssChunk: a value above 1 is clamped, and an uppercased lowercase cve is accepted", () => {
  const batch = ["CVE-2024-0001", "CVE-2024-0002"];
  const chunk = parseEpssChunk(body([row("CVE-2024-0001", "2"), row("cve-2024-0002", "0.0049")]), batch);
  assert.ok(chunk.ok);
  if (!chunk.ok) return;
  assert.deepStrictEqual(chunk.states["CVE-2024-0001"], scored(1));
  assert.deepStrictEqual(chunk.states["CVE-2024-0002"], scored(0.0049));
});

test("parseEpssChunk: unrequested, __proto__ and markup cve rows add no key", () => {
  const batch = ["CVE-2024-0001", "CVE-2024-0002", "CVE-2024-0003", "CVE-2024-0004"];
  const chunk = parseEpssChunk(
    body([
      row("CVE-2024-0001", "0.3"),
      row("CVE-2099-9999"),
      row("__proto__"),
      row("<b>CVE-2024-0001</b>"),
    ]),
    batch
  );
  assert.ok(chunk.ok);
  if (!chunk.ok) return;
  assert.deepStrictEqual(Object.keys(chunk.states).sort(), batch);
  assert.equal(Object.getPrototypeOf(chunk.states), Object.prototype);
  assert.deepStrictEqual(chunk.states["CVE-2024-0001"], scored(0.3));
  assert.deepStrictEqual(chunk.states["CVE-2024-0002"], { state: "no-row" });
});

test("parseEpssChunk: the first valid row wins, and a CVE with only invalid rows is unavailable", () => {
  const batch = ["CVE-2024-0001", "CVE-2024-0002", "CVE-2024-0003", "CVE-2024-0004", "CVE-2024-0005"];
  const chunk = parseEpssChunk(
    body([
      row("CVE-2024-0001", "oops"),
      row("CVE-2024-0001", "0.25"),
      row("CVE-2024-0001", "0.75"),
      row("CVE-2024-0002", "x"),
      row("CVE-2024-0002", "y"),
    ]),
    batch
  );
  assert.ok(chunk.ok);
  if (!chunk.ok) return;
  assert.deepStrictEqual(chunk.states["CVE-2024-0001"], scored(0.25));
  assert.deepStrictEqual(chunk.states["CVE-2024-0002"], { state: "unavailable" });
});

test("parseEpssChunk ignores non-object rows and a missing epss", () => {
  const batch = ["CVE-2024-0001", "CVE-2024-0002", "CVE-2024-0003", "CVE-2024-0004", "CVE-2024-0005"];
  const chunk = parseEpssChunk(body([null, "row", [1], { cve: 5 }, { cve: "CVE-2024-0001" }]), batch);
  assert.ok(chunk.ok);
  if (!chunk.ok) return;
  assert.deepStrictEqual(chunk.states["CVE-2024-0001"], { state: "unavailable" });
  assert.deepStrictEqual(chunk.states["CVE-2024-0002"], { state: "no-row" });
});

test("fetchEpss never throws on a hostile fetcher or hostile input", async () => {
  const throwing = async (): Promise<Response> => {
    throw new Error("boom");
  };
  const out = await fetchEpss([id(0), "junk", id(1)], { url: BASE, fetcher: throwing });
  assert.deepStrictEqual(out, {
    [id(0)]: { state: "unavailable" },
    [id(1)]: { state: "unavailable" },
  });
  const hostile = { get length(): never { throw new Error("boom"); } } as unknown as string[];
  assert.deepStrictEqual(await fetchEpss(hostile, { url: BASE }), {});
});

/**
 * Failure isolation against real sockets (ROADMAP SC2, ENR-03, D-11, D-18).
 * One fixture server backs this block; every case asserts bands and
 * properties (counts, set membership, elapsed bounds), never raw scores.
 */

let server: EnrichmentServer;
before(async () => {
  server = await startEnrichmentServer();
});
after(async () => {
  await server.close();
});

const FAST = { timeoutMs: 300, maxBytes: 256 * 1024 };
const fixtureIds = (n: number) => Array.from({ length: n }, (_, i) => `CVE-2024-${String(10000 + i)}`);

function allUnavailable(out: Record<string, EpssState>, input: readonly string[]) {
  assert.deepStrictEqual(Object.keys(out).sort(), [...input].sort());
  for (const c of input) assert.deepStrictEqual(out[c], { state: "unavailable" }, c);
}

test("/epss-ok with 120 IDs: exactly 3 sorted, de-duplicated requests under 900 characters", async () => {
  const input = fixtureIds(120);
  server.requests.length = 0;
  const out = await fetchEpss([...input].reverse(), { url: `${server.baseUrl}/epss-ok`, ...FAST });
  assert.equal(server.requests.length, 3);
  for (const line of server.requests) {
    assert.ok(line.length < 900, `request line is ${line.length} characters`);
    const m = line.match(/^\/epss-ok\?cve=([^&]*)&limit=100$/);
    assert.ok(m, line);
    const list = (m as RegExpMatchArray)[1].split(",");
    assert.ok(list.length <= 50);
    assert.deepStrictEqual(list, [...new Set(list)].sort());
  }
  assert.deepStrictEqual(Object.keys(out).sort(), input);
  for (const c of input) {
    if (EPSS_NO_ROW_IDS.has(c)) {
      assert.deepStrictEqual(out[c], { state: "no-row" }, c);
    } else {
      const e = out[c];
      assert.equal(e.state, "scored", c);
      if (e.state === "scored") {
        assert.ok(Math.abs(e.score - Number(epssFixtureScore(c))) < 1e-9, c);
        assert.equal(e.date, "2026-10-09");
      }
    }
  }
});

test("/epss-partial: only the batch holding a failing ID is unavailable, health is partial", async () => {
  const input = fixtureIds(120);
  const deps = { url: `${server.baseUrl}/epss-partial`, ...FAST };
  const out = await fetchEpss(input, deps);
  const failingBatch = sortedBatches(input, 50).find((b) => b.some((c) => EPSS_FAIL_IDS.has(c))) as string[];
  assert.ok(failingBatch.length > 0 && failingBatch.length < input.length);
  for (const c of input) {
    if (failingBatch.includes(c)) {
      assert.deepStrictEqual(out[c], { state: "unavailable" }, c);
    } else {
      assert.notEqual(out[c].state, "unavailable", c);
    }
  }
  const kev: KevMap = { version: 1, fetchedAt: new Date().toISOString(), catalogVersion: "x", entries: {} };
  const snap = await enrichCves(input, { kev: { status: "ok", map: kev } }, Date.now(), { epss: deps });
  assert.deepStrictEqual(snap.health.epss, {
    status: "partial",
    requested: 120,
    unavailable: failingBatch.length,
  });
});

test("/epss-inconsistent: every ID unavailable, never no-row", async () => {
  const input = fixtureIds(5);
  allUnavailable(await fetchEpss(input, { url: `${server.baseUrl}/epss-inconsistent`, ...FAST }), input);
});

test("/epss-hostile: no key outside the requested IDs, clamped and invalid rows handled", async () => {
  const input = fixtureIds(12);
  const out = await fetchEpss(input, { url: `${server.baseUrl}/epss-hostile`, ...FAST });
  assert.deepStrictEqual(Object.keys(out).sort(), input);
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  for (const bad of input.slice(0, 3)) assert.deepStrictEqual(out[bad], { state: "unavailable" }, bad);
  assert.deepStrictEqual(out[input[3]], { state: "scored", score: 1, date: "2026-10-09" });
  assert.deepStrictEqual(out[input[4]], { state: "scored", score: 0.4, date: "2026-10-09" });
  for (const c of input.slice(5)) assert.deepStrictEqual(out[c], { state: "no-row" }, c);
});

test("/hang with a 300 ms budget resolves quickly with every ID unavailable", async (t) => {
  const input = fixtureIds(60);
  const start = Date.now();
  const out = await fetchEpss(input, { url: `${server.baseUrl}/hang`, ...FAST });
  const elapsed = Date.now() - start;
  t.diagnostic(`/hang elapsed ${elapsed} ms`);
  assert.ok(elapsed < 2000, `took ${elapsed} ms`);
  allUnavailable(out, input);
});

test("/slow-body with a 300 ms budget resolves quickly with every ID unavailable", async (t) => {
  const input = fixtureIds(60);
  const start = Date.now();
  const out = await fetchEpss(input, { url: `${server.baseUrl}/slow-body`, ...FAST });
  const elapsed = Date.now() - start;
  t.diagnostic(`/slow-body elapsed ${elapsed} ms`);
  assert.ok(elapsed < 2000, `took ${elapsed} ms`);
  allUnavailable(out, input);
});

test("/oversize with a 16 KiB cap resolves with every ID unavailable", async (t) => {
  const input = fixtureIds(5);
  const start = Date.now();
  const out = await fetchEpss(input, { url: `${server.baseUrl}/oversize`, timeoutMs: 5000, maxBytes: 16_384 });
  t.diagnostic(`/oversize elapsed ${Date.now() - start} ms`);
  allUnavailable(out, input);
});

test("/status-500, /malformed and /html: every ID unavailable", async () => {
  const input = fixtureIds(5);
  for (const route of ["/status-500", "/malformed", "/html", "/missing"]) {
    allUnavailable(await fetchEpss(input, { url: `${server.baseUrl}${route}`, ...FAST }), input);
  }
});

test("a refused connection leaves every ID unavailable", async () => {
  const closed = await startEnrichmentServer();
  const dead = closed.baseUrl;
  await closed.close();
  const input = fixtureIds(5);
  allUnavailable(await fetchEpss(input, { url: `${dead}/epss-ok`, ...FAST }), input);
});

test("every failure route resolves with a state per ID and never no-row", async () => {
  const input = fixtureIds(8);
  for (const route of ["/hang", "/slow-body", "/oversize", "/status-500", "/malformed", "/html", "/epss-inconsistent"]) {
    const out = await fetchEpss(input, { url: `${server.baseUrl}${route}`, timeoutMs: 300, maxBytes: 16_384 });
    assert.deepStrictEqual(Object.keys(out).sort(), input, route);
    for (const c of input) assert.notEqual(out[c].state, "no-row", `${route} ${c}`);
  }
});

test("enrichCves against /hang resolves with EPSS unavailable and the KEV states untouched", async () => {
  const kev: KevMap = {
    version: 1,
    fetchedAt: new Date().toISOString(),
    catalogVersion: "x",
    entries: { "CVE-2024-10000": { added: "2026-10-03", due: "2026-10-24", ransomware: false } },
  };
  const input = fixtureIds(3);
  const snap = await enrichCves(input, { kev: { status: "ok", map: kev } }, Date.now(), {
    epss: { url: `${server.baseUrl}/hang`, ...FAST },
  });
  assert.deepStrictEqual(snap.health.epss, { status: "unavailable", requested: 3, unavailable: 3 });
  assert.equal(snap.health.kev.status, "ok");
  assert.equal(snap.byCve["CVE-2024-10000"].kev.state, "listed");
  assert.equal(snap.byCve["CVE-2024-10001"].kev.state, "not-listed");
  for (const c of input) assert.deepStrictEqual(snap.byCve[c].epss, { state: "unavailable" });
});
