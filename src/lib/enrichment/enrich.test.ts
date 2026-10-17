import { test } from "node:test";
import assert from "node:assert/strict";
import type { EnrichmentHealth, KevMap, KevRead } from "../types.ts";
import { enrichCves, enrichmentNotice, kevHealth, uniqueCves, type EnrichDeps } from "./enrich.ts";

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

/**
 * enrichCves reaches FIRST by default, so every call with a CVE list passes an
 * injected EPSS fetcher: no test here may make a live request (D-18). The
 * default answers every requested ID with a consistent score row.
 */
function epssDeps(
  answer: (ids: string[]) => Response = (ids) =>
    new Response(
      JSON.stringify({
        status: "OK",
        total: ids.length,
        data: ids.map((cve) => ({ cve, epss: "0.910000000", percentile: "0.99", date: "2026-10-09" })),
      })
    )
): EnrichDeps {
  return {
    epss: {
      url: "https://epss.test/api",
      fetcher: async (url: string) =>
        answer(new URL(url).searchParams.get("cve")?.split(",") ?? []),
    },
  };
}

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
  const snap = await enrichCves(["CVE-2024-0001", "CVE-2024-0002"], { kev: okRead(map) }, NOW, epssDeps());
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
  const snap = await enrichCves(["CVE-2024-0001", "CVE-2024-0002"], { kev: okRead(map) }, NOW, epssDeps());
  assert.equal(snap.byCve["CVE-2024-0001"].kev.state, "listed");
  assert.equal(snap.byCve["CVE-2024-0002"].kev.state, "not-listed");
  assert.deepStrictEqual(snap.health.kev, { status: "stale", fetchedAt: map.fetchedAt });
});

test("enrichCves with KEV unavailable never produces not-listed", async () => {
  const ids = Array.from({ length: 20 }, (_, i) => `CVE-2024-${String(2000 + i)}`);
  const snap = await enrichCves(ids, { kev: { status: "unavailable" } }, NOW, epssDeps());
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
  const snap = await enrichCves(["CVE-2024-0001", "CVE-2024-0002"], { kev: bad }, NOW, epssDeps());
  assert.equal(snap.byCve["CVE-2024-0001"].kev.state, "unavailable");
  assert.equal(snap.byCve["CVE-2024-0002"].kev.state, "unavailable");
  assert.equal(snap.health.kev.status, "unavailable");
});

test("enrichCves never throws, even when the input is hostile", async () => {
  const hostile = { get status(): never { throw new Error("boom"); } } as unknown as KevRead;
  const snap = await enrichCves(["CVE-2024-0001"], { kev: hostile }, NOW, epssDeps());
  assert.equal(snap.byCve["CVE-2024-0001"].kev.state, "unavailable");
  assert.equal(snap.byCve["CVE-2024-0001"].epss.state, "unavailable");
  assert.deepStrictEqual(snap.health.kev, { status: "unavailable", fetchedAt: null });
  assert.deepStrictEqual(snap.health.epss, { status: "unavailable", requested: 1, unavailable: 1 });
});

test("enrichCves maps scored, no-row and unavailable EPSS states into byCve, health partial", async () => {
  // 51 IDs make two batches: 50 sorted first, and the last sorted ID alone, whose batch fails.
  const ids = Array.from({ length: 51 }, (_, i) => `CVE-2024-${String(3000 + i)}`);
  const answer = (requested: string[]): Response => {
    if (requested.length === 1) return new Response("boom", { status: 500 });
    const data = requested
      .filter((c) => c !== ids[1])
      .map((cve) => ({ cve, epss: "0.5", percentile: "0.5", date: "2026-10-09" }));
    return new Response(JSON.stringify({ status: "OK", total: data.length, data }));
  };
  const snap = await enrichCves(ids, { kev: okRead(mapFetchedAt(NOW)) }, NOW, epssDeps(answer));
  const sorted = [...ids].sort();
  const lonely = sorted[50];
  assert.deepStrictEqual(snap.byCve[lonely].epss, { state: "unavailable" });
  assert.deepStrictEqual(snap.byCve[ids[1]].epss, { state: "no-row" });
  const other = sorted.find((c) => c !== lonely && c !== ids[1]) as string;
  assert.deepStrictEqual(snap.byCve[other].epss, { state: "scored", score: 0.5, date: "2026-10-09" });
  assert.deepStrictEqual(snap.health.epss, { status: "partial", requested: 51, unavailable: 1 });
  assert.equal(snap.health.kev.status, "ok");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(snap)), snap);
});

test("health.epss is ok when nothing is unavailable and unavailable when everything is", async () => {
  const ok = await enrichCves(
    ["CVE-2024-0001", "CVE-2024-0002"],
    { kev: okRead(mapFetchedAt(NOW)) },
    NOW,
    epssDeps()
  );
  assert.deepStrictEqual(ok.health.epss, { status: "ok", requested: 2, unavailable: 0 });
  for (const e of Object.values(ok.byCve)) assert.equal(e.epss.state, "scored");

  const down = await enrichCves(
    ["CVE-2024-0001", "CVE-2024-0002"],
    { kev: okRead(mapFetchedAt(NOW)) },
    NOW,
    epssDeps(() => new Response("down", { status: 503 }))
  );
  assert.deepStrictEqual(down.health.epss, { status: "unavailable", requested: 2, unavailable: 2 });
  for (const e of Object.values(down.byCve)) assert.deepStrictEqual(e.epss, { state: "unavailable" });
  assert.equal(down.byCve["CVE-2024-0001"].kev.state, "listed");
  assert.equal(down.byCve["CVE-2024-0002"].kev.state, "not-listed");
});

test("an empty CVE list makes no EPSS request and reports EPSS ok with 0 requested", async () => {
  let calls = 0;
  const snap = await enrichCves([], { kev: okRead(mapFetchedAt(NOW)) }, NOW, {
    epss: {
      fetcher: async () => {
        calls++;
        return new Response("{}");
      },
    },
  });
  assert.equal(calls, 0);
  assert.deepStrictEqual(snap.health.epss, { status: "ok", requested: 0, unavailable: 0 });
});

test("prototype-named and malformed IDs are dropped, never joined", async () => {
  const snap = await enrichCves(
    ["__proto__", "constructor", "toString", "CVE-2024-0001"],
    { kev: okRead(mapFetchedAt(NOW, [])) },
    NOW,
    epssDeps()
  );
  assert.deepStrictEqual(Object.keys(snap.byCve), ["CVE-2024-0001"]);
  assert.deepStrictEqual(snap.byCve["CVE-2024-0001"].kev, { state: "not-listed" });
  assert.equal(Object.getPrototypeOf(snap.byCve), Object.prototype);
});

function healthOf(
  kev: EnrichmentHealth["kev"]["status"],
  epss: EnrichmentHealth["epss"]["status"]
): EnrichmentHealth {
  return {
    kev:
      kev === "unavailable"
        ? { status: kev, fetchedAt: null }
        : { status: kev, fetchedAt: "2026-10-06T08:00:00.000Z" },
    epss: { status: epss, requested: 4, unavailable: epss === "ok" ? 0 : epss === "partial" ? 1 : 4 },
  };
}

test("enrichmentNotice is null when KEV and EPSS are ok, including nothing requested", () => {
  assert.equal(enrichmentNotice(healthOf("ok", "ok")), null);
  const none = healthOf("ok", "ok");
  none.epss = { status: "ok", requested: 0, unavailable: 0 };
  assert.equal(enrichmentNotice(none), null);
});

test("enrichmentNotice names each single-provider state with the fixed wording", () => {
  assert.equal(enrichmentNotice(healthOf("unavailable", "ok")), "KEV data unavailable");
  assert.equal(enrichmentNotice(healthOf("stale", "ok")), "KEV data from 2026-10-06");
  assert.equal(enrichmentNotice(healthOf("ok", "unavailable")), "EPSS data unavailable");
  assert.equal(enrichmentNotice(healthOf("ok", "partial")), "EPSS partially unavailable");
});

test("enrichmentNotice joins the KEV part before the EPSS part with a middle dot", () => {
  assert.equal(
    enrichmentNotice(healthOf("unavailable", "unavailable")),
    "KEV data unavailable · EPSS data unavailable"
  );
  assert.equal(
    enrichmentNotice(healthOf("stale", "partial")),
    "KEV data from 2026-10-06 · EPSS partially unavailable"
  );
});

test("enrichmentNotice falls back to unavailable for an unparseable stale date", () => {
  const h = healthOf("stale", "ok");
  h.kev = { status: "stale", fetchedAt: "not a date <b>x</b>" };
  assert.equal(enrichmentNotice(h), "KEV data unavailable");
  h.kev = { status: "stale", fetchedAt: null };
  assert.equal(enrichmentNotice(h), "KEV data unavailable");
});

test("enrichmentNotice output is null or fixed vocabulary for every status combination, never false assurance", () => {
  const fixed = /^(KEV data unavailable|KEV data from \d{4}-\d{2}-\d{2})?( · )?(EPSS data unavailable|EPSS partially unavailable)?$/;
  for (const kev of ["ok", "stale", "unavailable"] as const) {
    for (const epss of ["ok", "partial", "unavailable"] as const) {
      const out = enrichmentNotice(healthOf(kev, epss));
      if (out === null) {
        assert.equal(kev === "ok" && epss === "ok", true);
        continue;
      }
      assert.match(out, fixed);
      assert.doesNotMatch(out, /not (?:in|listed in) kev|not exploited|safe/i);
      assert.equal(out.includes(" · "), kev !== "ok" && epss !== "ok");
    }
  }
});
