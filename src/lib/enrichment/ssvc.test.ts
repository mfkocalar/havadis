import { test } from "node:test";
import assert from "node:assert/strict";
import type { CacheableSsvcState, EpssState, KevState } from "../types.ts";
import { CISA_ADP_ORG_ID, SSVC_RECORD_URL_BASE } from "./config.ts";
import {
  cveRecordUrl,
  fetchSsvc,
  isCacheableSsvc,
  produceSsvc,
  selectSsvcIds,
} from "./ssvc.ts";

/**
 * Hermetic tests for the SSVC reader (ENR-06, ENR-07, D-10): injected fetchers
 * and lookups only, no network, no clock.
 */

const ID = "CVE-2024-3400";

/** A CVE JSON 5 record shaped like the live one, with one CISA-ADP container. */
function activeRecord(id: string = ID): Record<string, unknown> {
  return {
    dataType: "CVE_RECORD",
    dataVersion: "5.1",
    cveMetadata: { cveId: id, state: "PUBLISHED" },
    containers: {
      cna: {},
      adp: [
        {
          providerMetadata: { orgId: CISA_ADP_ORG_ID, shortName: "CISA-ADP" },
          metrics: [
            {
              other: {
                type: "ssvc",
                content: {
                  id,
                  role: "CISA Coordinator",
                  version: "2.0.3",
                  timestamp: "2024-04-17T04:00:13.543064Z",
                  options: [
                    { Exploitation: "active" },
                    { Automatable: "yes" },
                    { "Technical Impact": "total" },
                  ],
                },
              },
            },
          ],
        },
        { providerMetadata: { shortName: "CVE", orgId: "af854a3a-2127-422b-91ae-364da2661108" } },
      ],
    },
  };
}

function noAdpRecord(id: string = ID): Record<string, unknown> {
  return {
    dataType: "CVE_RECORD",
    dataVersion: "5.1",
    cveMetadata: { cveId: id, state: "PUBLISHED" },
    containers: { cna: {} },
  };
}

type Call = { url: string; init: RequestInit & { next?: unknown } };

/** A fetcher that records every call and answers with `answer`. */
function fakeFetcher(answer: () => Response): {
  fetcher: (url: string, init?: RequestInit & { next?: unknown }) => Promise<Response>;
  calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    fetcher: async (url, init = {}) => {
      calls.push({ url, init });
      return answer();
    },
  };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

test("produceSsvc: an active CISA record resolves assessed active with both other fields", async () => {
  const { fetcher } = fakeFetcher(() => json(activeRecord()));
  const state = await produceSsvc(ID, { fetcher });
  assert.deepStrictEqual(state, {
    state: "assessed",
    exploitation: "active",
    automatable: "yes",
    technicalImpact: "total",
  });
});

test("fetchSsvc: a lookup built from produceSsvc returns the same assessed state for the ID", async () => {
  const { fetcher } = fakeFetcher(() => json(activeRecord()));
  const out = await fetchSsvc([ID], { lookup: (id) => produceSsvc(id, { fetcher }) });
  assert.deepStrictEqual(out, {
    [ID]: { state: "assessed", exploitation: "active", automatable: "yes", technicalImpact: "total" },
  });
});

test("produceSsvc: a published record without a CISA-ADP container resolves not-assessed", async () => {
  const { fetcher } = fakeFetcher(() => json(noAdpRecord()));
  assert.deepStrictEqual(await produceSsvc(ID, { fetcher }), { state: "not-assessed" });
});

test("produceSsvc: a 503 answer rejects with a fixed ssvc: message", async () => {
  const { fetcher } = fakeFetcher(() => new Response("upstream text", { status: 503 }));
  await assert.rejects(produceSsvc(ID, { fetcher }), (err: Error) => {
    assert.match(err.message, /^ssvc: /);
    assert.doesNotMatch(err.message, /upstream text/);
    return true;
  });
});

test("produceSsvc: a record whose cveId differs rejects with an ssvc: message", async () => {
  const { fetcher } = fakeFetcher(() => json(activeRecord("CVE-2024-9999")));
  await assert.rejects(produceSsvc(ID, { fetcher }), /^Error: ssvc: /);
});

test("produceSsvc: a malformed body rejects with an ssvc: message", async () => {
  const { fetcher } = fakeFetcher(() => new Response("{not json", { status: 200 }));
  await assert.rejects(produceSsvc(ID, { fetcher }), /^Error: ssvc: /);
});

test("produceSsvc: a lowercase ID, a path-traversal string and a too-short number never reach the fetcher", async () => {
  const { fetcher, calls } = fakeFetcher(() => json(activeRecord()));
  for (const bad of ["cve-2024-3400", "../../etc/passwd", "CVE-2024-12", "CVE-2024-3400/../x", ""]) {
    await assert.rejects(produceSsvc(bad, { fetcher }), /^Error: ssvc: invalid id$/);
  }
  assert.equal(calls.length, 0);
});

test("produceSsvc: requests exactly cveRecordUrl(id) and passes no next option", async () => {
  const { fetcher, calls } = fakeFetcher(() => json(activeRecord()));
  await produceSsvc(ID, { fetcher });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, cveRecordUrl(ID));
  assert.equal(calls[0].url, `${SSVC_RECORD_URL_BASE}/${ID}`);
  assert.equal(Object.hasOwn(calls[0].init, "next"), false);
});

test("cveRecordUrl: joins an injected base, a slash and the ID", () => {
  assert.equal(cveRecordUrl(ID, "http://127.0.0.1:1/ssvc-ok"), `http://127.0.0.1:1/ssvc-ok/${ID}`);
});

const kevListed: KevState = { state: "listed", added: "2026-10-03", due: "2026-10-24", ransomware: false };
const notListed: KevState = { state: "not-listed" };
const unavailableKev: KevState = { state: "unavailable" };
const noRow: EpssState = { state: "no-row" };

test("selectSsvcIds: KEV-listed IDs are skipped only when KEV is known", () => {
  const ids = ["CVE-2024-0001", "CVE-2024-0002", "CVE-2024-0003"];
  const pre = {
    "CVE-2024-0001": { kev: notListed, epss: noRow },
    "CVE-2024-0002": { kev: kevListed, epss: noRow },
    "CVE-2024-0003": { kev: notListed, epss: noRow },
  };
  const known = selectSsvcIds(ids, pre, { kevKnown: true, cap: 10 });
  assert.deepStrictEqual(known, {
    lookups: ["CVE-2024-0001", "CVE-2024-0003"],
    skipped: ["CVE-2024-0002"],
    overflow: [],
  });
  const unknown = selectSsvcIds(ids, pre, { kevKnown: false, cap: 10 });
  assert.deepStrictEqual(unknown, { lookups: ids, skipped: [], overflow: [] });
});

test("selectSsvcIds: keeps input order, drops duplicates and invalid IDs, and moves candidates past the cap to overflow", () => {
  const ids = ["CVE-2024-0003", "not-a-cve", "CVE-2024-0001", "CVE-2024-0003", "CVE-2024-0002", "CVE-2024-0004"];
  const pre = Object.fromEntries(
    ids.map((id) => [id, { kev: unavailableKev, epss: noRow }])
  );
  const out = selectSsvcIds(ids, pre, { kevKnown: false, cap: 2 });
  assert.deepStrictEqual(out, {
    lookups: ["CVE-2024-0003", "CVE-2024-0001"],
    skipped: [],
    overflow: ["CVE-2024-0002", "CVE-2024-0004"],
  });
});

test("fetchSsvc: without a lookup every ID is unavailable and nothing is called", async () => {
  const out = await fetchSsvc(["CVE-2024-0001", "CVE-2024-0002"]);
  assert.deepStrictEqual(out, {
    "CVE-2024-0001": { state: "unavailable" },
    "CVE-2024-0002": { state: "unavailable" },
  });
});

test("fetchSsvc: never has more lookups in flight than the concurrency", async () => {
  const ids = Array.from({ length: 20 }, (_, i) => `CVE-2024-${String(1000 + i)}`);
  let inFlight = 0;
  let peak = 0;
  let calls = 0;
  const out = await fetchSsvc(ids, {
    concurrency: 3,
    lookup: async () => {
      calls += 1;
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return { state: "not-assessed" };
    },
  });
  assert.equal(calls, 20);
  assert.ok(peak <= 3, `peak ${peak}`);
  assert.ok(peak >= 2, "the pool ran in parallel");
  assert.equal(Object.keys(out).length, 20);
});

test("fetchSsvc: a throwing lookup or an invalid value gives unavailable for that ID only", async () => {
  const good: CacheableSsvcState = {
    state: "assessed",
    exploitation: "poc",
    automatable: "no",
    technicalImpact: "partial",
  };
  const out = await fetchSsvc(
    ["CVE-2024-0001", "CVE-2024-0002", "CVE-2024-0003", "CVE-2024-0004"],
    {
      lookup: async (id) => {
        if (id === "CVE-2024-0001") throw new Error("boom");
        if (id === "CVE-2024-0002") return { state: "unavailable" } as unknown as CacheableSsvcState;
        if (id === "CVE-2024-0003") return good;
        return { state: "assessed", exploitation: "widespread" } as unknown as CacheableSsvcState;
      },
    }
  );
  assert.deepStrictEqual(out, {
    "CVE-2024-0001": { state: "unavailable" },
    "CVE-2024-0002": { state: "unavailable" },
    "CVE-2024-0003": good,
    "CVE-2024-0004": { state: "unavailable" },
  });
});

test("isCacheableSsvc: accepts only not-assessed and a fully valid assessed object", () => {
  assert.equal(isCacheableSsvc({ state: "not-assessed" }), true);
  assert.equal(
    isCacheableSsvc({ state: "assessed", exploitation: "none", automatable: "yes", technicalImpact: "total" }),
    true
  );
  for (const bad of [
    null,
    undefined,
    "assessed",
    [],
    { state: "skipped" },
    { state: "unavailable" },
    { state: "assessed" },
    { state: "assessed", exploitation: "widespread", automatable: "yes", technicalImpact: "total" },
    { state: "assessed", exploitation: "none", automatable: "maybe", technicalImpact: "total" },
    { state: "assessed", exploitation: "none", automatable: "yes", technicalImpact: "huge" },
  ]) {
    assert.equal(isCacheableSsvc(bad), false);
  }
});
