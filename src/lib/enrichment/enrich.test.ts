import { test } from "node:test";
import assert from "node:assert/strict";
import type { KevMap, KevRead } from "../types.ts";
import { enrichCves, kevHealth, uniqueCves } from "./enrich.ts";

/**
 * Hermetic tests for the render-time join (ENR-03, D-09, D-10): no network,
 * no clock; `now` is always passed in.
 */

const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function mapFetchedAt(ms: number, ids: string[] = ["CVE-2024-0001"]): KevMap {
  const entries: KevMap["entries"] = {};
  for (const id of ids) {
    entries[id] = { added: "2026-10-03", due: "2026-10-24", ransomware: true };
  }
  return { version: 1, fetchedAt: new Date(ms).toISOString(), catalogVersion: "2026.10.08", entries };
}

const okRead = (map: KevMap): KevRead => ({ status: "ok", map });

test("uniqueCves returns valid IDs once each in first-appearance order", () => {
  const out = uniqueCves([
    { cves: ["CVE-2024-0001", "CVE-2024-0002", "not-a-cve", "cve-2024-0003"] },
    { cves: ["CVE-2024-0002", "CVE-2024-0004", "CVE-2024-0001 extra"] },
  ]);
  assert.deepStrictEqual(out, ["CVE-2024-0001", "CVE-2024-0002", "CVE-2024-0004"]);
  assert.deepStrictEqual(uniqueCves([]), []);
});

test("kevHealth: a map aged exactly 72 hours is ok, one millisecond more is stale", () => {
  const fetched = NOW - 72 * HOUR;
  const ok = kevHealth(okRead(mapFetchedAt(fetched)), NOW);
  assert.deepStrictEqual(ok, { status: "ok", fetchedAt: new Date(fetched).toISOString() });

  const stale = kevHealth(okRead(mapFetchedAt(fetched)), NOW + 1);
  assert.deepStrictEqual(stale, { status: "stale", fetchedAt: new Date(fetched).toISOString() });
});

test("kevHealth: a fetchedAt in the future counts as age 0", () => {
  const future = NOW + HOUR;
  assert.deepStrictEqual(kevHealth(okRead(mapFetchedAt(future)), NOW), {
    status: "ok",
    fetchedAt: new Date(future).toISOString(),
  });
});

test("kevHealth: unavailable with a null fetchedAt for any unusable read", () => {
  const unavailable = { status: "unavailable", fetchedAt: null };
  assert.deepStrictEqual(kevHealth({ status: "unavailable" }, NOW), unavailable);

  const wrongVersion = { ...mapFetchedAt(NOW), version: 2 } as unknown as KevMap;
  assert.deepStrictEqual(kevHealth(okRead(wrongVersion), NOW), unavailable);

  const noEntries = { ...mapFetchedAt(NOW), entries: null } as unknown as KevMap;
  assert.deepStrictEqual(kevHealth(okRead(noEntries), NOW), unavailable);

  const badDate = { ...mapFetchedAt(NOW), fetchedAt: "yesterday" };
  assert.deepStrictEqual(kevHealth(okRead(badDate), NOW), unavailable);

  assert.deepStrictEqual(kevHealth({ status: "ok", map: null } as unknown as KevRead, NOW), unavailable);
});

test("enrichCves marks a listed ID listed and another not-listed (ok map)", async () => {
  const map = mapFetchedAt(NOW - HOUR);
  const snap = await enrichCves(["CVE-2024-0001", "CVE-2024-0002"], { kev: okRead(map) }, NOW);
  assert.deepStrictEqual(snap.byCve["CVE-2024-0001"].kev, {
    state: "listed",
    added: "2026-10-03",
    due: "2026-10-24",
    ransomware: true,
  });
  assert.deepStrictEqual(snap.byCve["CVE-2024-0002"].kev, { state: "not-listed" });
  assert.deepStrictEqual(snap.health.kev, { status: "ok", fetchedAt: map.fetchedAt });
});

test("enrichCves keeps using a stale map: listed stays listed, health is stale", async () => {
  const map = mapFetchedAt(NOW - 100 * HOUR);
  const snap = await enrichCves(["CVE-2024-0001", "CVE-2024-0002"], { kev: okRead(map) }, NOW);
  assert.equal(snap.byCve["CVE-2024-0001"].kev.state, "listed");
  assert.equal(snap.byCve["CVE-2024-0002"].kev.state, "not-listed");
  assert.deepStrictEqual(snap.health.kev, { status: "stale", fetchedAt: map.fetchedAt });
});

test("enrichCves with KEV unavailable never produces not-listed", async () => {
  const ids = Array.from({ length: 20 }, (_, i) => `CVE-2024-${String(2000 + i)}`);
  const snap = await enrichCves(ids, { kev: { status: "unavailable" } }, NOW);
  assert.equal(Object.keys(snap.byCve).length, 20);
  for (const id of ids) {
    assert.equal(snap.byCve[id].kev.state, "unavailable");
  }
  assert.ok(!JSON.stringify(snap).includes("not-listed"));
  assert.deepStrictEqual(snap.health.kev, { status: "unavailable", fetchedAt: null });
});

test("enrichCves on an empty CVE list gives an empty byCve and EPSS health ok", async () => {
  const snap = await enrichCves([], { kev: okRead(mapFetchedAt(NOW)) }, NOW);
  assert.deepStrictEqual(snap.byCve, {});
  assert.deepStrictEqual(snap.health.epss, { status: "ok", requested: 0, unavailable: 0 });
});

test("enrichCves resolves on a malformed read, with every ID unavailable", async () => {
  const bad = { status: "ok", map: null } as unknown as KevRead;
  const snap = await enrichCves(["CVE-2024-0001", "CVE-2024-0002"], { kev: bad }, NOW);
  assert.equal(snap.byCve["CVE-2024-0001"].kev.state, "unavailable");
  assert.equal(snap.byCve["CVE-2024-0002"].kev.state, "unavailable");
  assert.equal(snap.health.kev.status, "unavailable");
});

test("enrichCves never throws, even when the input is hostile", async () => {
  const hostile = { get status(): never { throw new Error("boom"); } } as unknown as KevRead;
  const snap = await enrichCves(["CVE-2024-0001"], { kev: hostile }, NOW);
  assert.equal(snap.byCve["CVE-2024-0001"].kev.state, "unavailable");
  assert.equal(snap.byCve["CVE-2024-0001"].epss.state, "unavailable");
  assert.deepStrictEqual(snap.health.kev, { status: "unavailable", fetchedAt: null });
  assert.deepStrictEqual(snap.health.epss, { status: "unavailable", requested: 1, unavailable: 1 });
});

test("every EPSS state is unavailable in this plan, and the snapshot survives a JSON round trip", async () => {
  const snap = await enrichCves(
    ["CVE-2024-0001", "CVE-2024-0002"],
    { kev: okRead(mapFetchedAt(NOW)) },
    NOW
  );
  for (const e of Object.values(snap.byCve)) {
    assert.deepStrictEqual(e.epss, { state: "unavailable" });
  }
  assert.deepStrictEqual(snap.health.epss, { status: "unavailable", requested: 2, unavailable: 2 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(snap)), snap);
});

test("prototype-named and malformed IDs are dropped, never joined", async () => {
  const snap = await enrichCves(
    ["__proto__", "constructor", "toString", "CVE-2024-0001"],
    { kev: okRead(mapFetchedAt(NOW, [])) },
    NOW
  );
  assert.deepStrictEqual(Object.keys(snap.byCve), ["CVE-2024-0001"]);
  assert.deepStrictEqual(snap.byCve["CVE-2024-0001"].kev, { state: "not-listed" });
  assert.equal(Object.getPrototypeOf(snap.byCve), Object.prototype);
});
