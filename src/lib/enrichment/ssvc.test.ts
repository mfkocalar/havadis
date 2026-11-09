import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import http from "node:http";
import { USER_AGENT } from "../config/crawler.ts";
import type { CacheableSsvcState, EpssState, KevState } from "../types.ts";
import { CISA_ADP_ORG_ID, SSVC_RECORD_URL_BASE } from "./config.ts";
import {
  SSVC_ACTIVE_IDS,
  SSVC_DNE_IDS,
  SSVC_NONE_IDS,
  SSVC_POC_IDS,
  ssvcRecord,
  startEnrichmentServer,
  type EnrichmentServer,
} from "../../../test/fixtures/enrichmentServer.ts";
import {
  cveRecordUrl,
  fetchSsvc,
  isCacheableSsvc,
  isDneBody,
  parseSsvcRecord,
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

// ---- Task 3: the fail-closed parser table, the DNE rule and the fixture routes ----

type Content = { id: unknown; version: unknown; options: unknown };
type Container = { providerMetadata: { orgId: unknown }; metrics: unknown };
type Rec = { cveMetadata: unknown; containers: unknown };

/** A fresh deep copy of the assessed-active fixture record, safe to mutate. */
const fresh = (): Rec => JSON.parse(JSON.stringify(ssvcRecord(ID, "active"))) as Rec;
const adpOf = (r: Rec): Container[] => (r.containers as { adp: Container[] }).adp;
const metricsOf = (r: Rec) => adpOf(r)[0].metrics as Array<{ other: { type: string; content: Content } }>;
const contentOf = (r: Rec): Content => metricsOf(r)[0].other.content;
const optionsOf = (r: Rec): unknown[] => contentOf(r).options as unknown[];

const UNAVAILABLE = { state: "unavailable" };
const unavailable = (r: unknown) => assert.deepStrictEqual(parseSsvcRecord(r, ID), UNAVAILABLE);

test("parseSsvcRecord: a non-object body is unavailable", () => {
  for (const body of [null, undefined, "x", 7, true, []]) unavailable(body);
});

test("parseSsvcRecord: a missing cveMetadata is unavailable", () => {
  const r = fresh() as Partial<Rec>;
  delete r.cveMetadata;
  unavailable(r);
});

test("parseSsvcRecord: a wrong cveMetadata.cveId is unavailable", () => {
  const r = fresh();
  r.cveMetadata = { cveId: "CVE-2024-9999" };
  unavailable(r);
});

test("parseSsvcRecord: containers that are not an object are unavailable", () => {
  for (const containers of ["x", 1, null, []]) {
    const r = fresh();
    r.containers = containers;
    unavailable(r);
  }
});

test("parseSsvcRecord: adp that is not an array is unavailable", () => {
  const r = fresh();
  (r.containers as { adp: unknown }).adp = { providerMetadata: { orgId: CISA_ADP_ORG_ID } };
  unavailable(r);
});

test("parseSsvcRecord: two CISA-ADP containers are unavailable", () => {
  const r = fresh();
  adpOf(r).push(JSON.parse(JSON.stringify(adpOf(r)[0])) as Container);
  unavailable(r);
});

test("parseSsvcRecord: a CISA-ADP container without a metrics array is unavailable", () => {
  const r = fresh();
  adpOf(r)[0].metrics = "x";
  unavailable(r);
});

test("parseSsvcRecord: a CISA-ADP container with no ssvc metric is unavailable", () => {
  const r = fresh();
  adpOf(r)[0].metrics = [{ other: { type: "kev", content: { dateAdded: "2024-04-12" } } }];
  unavailable(r);
});

test("parseSsvcRecord: two ssvc metrics are unavailable", () => {
  const r = fresh();
  const metrics = metricsOf(r);
  metrics.push(JSON.parse(JSON.stringify(metrics[0])) as (typeof metrics)[number]);
  unavailable(r);
});

test("parseSsvcRecord: an ssvc content.id that differs from the requested ID is unavailable", () => {
  const r = fresh();
  contentOf(r).id = "CVE-2024-9999";
  unavailable(r);
});

test("parseSsvcRecord: version 3.0.0 is unavailable", () => {
  const r = fresh();
  contentOf(r).version = "3.0.0";
  unavailable(r);
});

test("parseSsvcRecord: a version that is not a string, or has no patch, is unavailable", () => {
  for (const version of [2, null, undefined, "2.0", "v2.0.3", "2.0.3-beta"]) {
    const r = fresh();
    contentOf(r).version = version;
    unavailable(r);
  }
});

test("parseSsvcRecord: options that are not an array are unavailable", () => {
  const r = fresh();
  contentOf(r).options = { Exploitation: "active", Automatable: "yes", "Technical Impact": "total" };
  unavailable(r);
});

test("parseSsvcRecord: an option with two keys is unavailable", () => {
  const r = fresh();
  optionsOf(r)[0] = { Exploitation: "active", Automatable: "yes" };
  unavailable(r);
});

test("parseSsvcRecord: a non-string option value is unavailable", () => {
  for (const value of [1, null, true, ["active"], { v: "active" }]) {
    const r = fresh();
    optionsOf(r)[0] = { Exploitation: value };
    unavailable(r);
  }
});

test("parseSsvcRecord: a duplicate Exploitation option is unavailable", () => {
  const r = fresh();
  optionsOf(r).push({ Exploitation: "none" });
  unavailable(r);
});

test("parseSsvcRecord: an extra option key is unavailable", () => {
  const r = fresh();
  optionsOf(r).push({ Mission: "essential" });
  unavailable(r);
});

test("parseSsvcRecord: a missing Technical Impact option is unavailable", () => {
  const renamed = fresh();
  optionsOf(renamed)[2] = { "Mission Prevalence": "minimal" };
  unavailable(renamed);
  const two = fresh();
  optionsOf(two).pop();
  unavailable(two);
});

test("parseSsvcRecord: an unknown Exploitation word is unavailable and never none", () => {
  for (const word of ["widespread", "ACTIVE", "None", "", "unknown"]) {
    const r = fresh();
    optionsOf(r)[0] = { Exploitation: word };
    unavailable(r);
  }
});

test("parseSsvcRecord: an unknown Automatable or Technical Impact word is unavailable", () => {
  const a = fresh();
  optionsOf(a)[1] = { Automatable: "maybe" };
  unavailable(a);
  const t = fresh();
  optionsOf(t)[2] = { "Technical Impact": "huge" };
  unavailable(t);
});

test("parseSsvcRecord: a __proto__ option key is unavailable and leaves Object.prototype untouched", () => {
  const extra = fresh();
  optionsOf(extra).push(JSON.parse('{"__proto__":"none"}'));
  unavailable(extra);

  const replaced = fresh();
  optionsOf(replaced)[0] = JSON.parse('{"__proto__":"none"}');
  unavailable(replaced);

  const nested = fresh();
  optionsOf(nested)[0] = JSON.parse('{"__proto__":{"polluted":true}}');
  unavailable(nested);

  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(({} as Record<string, unknown>).Exploitation, undefined);
  assert.deepStrictEqual(Object.keys(Object.prototype), []);
});

test("parseSsvcRecord: an assessed record is a fresh literal on Object.prototype with the scalars copied", () => {
  const r = fresh();
  const result = parseSsvcRecord(r, ID);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.deepStrictEqual(Object.keys(result).sort(), ["automatable", "exploitation", "state", "technicalImpact"]);
  optionsOf(r)[0] = { Exploitation: "none" };
  assert.equal((result as { exploitation: string }).exploitation, "active", "the result shares nothing with the record");
});

test("parseSsvcRecord: active, poc and none are assessed with automatable and technicalImpact copied", () => {
  for (const exploitation of ["active", "poc", "none"] as const) {
    assert.deepStrictEqual(parseSsvcRecord(ssvcRecord(ID, exploitation), ID), {
      state: "assessed",
      exploitation,
      automatable: "yes",
      technicalImpact: "total",
    });
  }
  const r = fresh();
  optionsOf(r)[1] = { Automatable: "no" };
  optionsOf(r)[2] = { "Technical Impact": "partial" };
  assert.deepStrictEqual(parseSsvcRecord(r, ID), {
    state: "assessed",
    exploitation: "active",
    automatable: "no",
    technicalImpact: "partial",
  });
});

test("parseSsvcRecord: option order does not matter", () => {
  const r = fresh();
  const [e, a, t] = optionsOf(r);
  contentOf(r).options = [t, e, a];
  assert.equal((parseSsvcRecord(r, ID) as { state: string }).state, "assessed");
});

test("parseSsvcRecord: a record with no adp key is not-assessed", () => {
  assert.deepStrictEqual(parseSsvcRecord(ssvcRecord(ID, null), ID), { state: "not-assessed" });
});

test("parseSsvcRecord: an adp array without the CISA org id is not-assessed, whatever the display name", () => {
  const r = fresh();
  adpOf(r).shift();
  assert.deepStrictEqual(parseSsvcRecord(r, ID), { state: "not-assessed" });
  const lookalike = fresh();
  adpOf(lookalike)[0].providerMetadata.orgId = "00000000-0000-0000-0000-000000000000";
  assert.deepStrictEqual(parseSsvcRecord(lookalike, ID), { state: "not-assessed" });
});

test("parseSsvcRecord: a REJECTED record without adp is not-assessed", () => {
  const rejected = { dataType: "CVE_RECORD", cveMetadata: { cveId: ID, state: "REJECTED" }, containers: { cna: {} } };
  assert.deepStrictEqual(parseSsvcRecord(rejected, ID), { state: "not-assessed" });
});

test("isDneBody: only an object whose own error field is CVE_RECORD_DNE", () => {
  assert.equal(isDneBody({ error: "CVE_RECORD_DNE", message: "x" }), true);
  assert.equal(isDneBody({ error: "NOT_FOUND" }), false);
  assert.equal(isDneBody({ message: "CVE_RECORD_DNE" }), false);
  assert.equal(isDneBody(["CVE_RECORD_DNE"]), false);
  assert.equal(isDneBody("CVE_RECORD_DNE"), false);
  assert.equal(isDneBody(null), false);
  assert.equal(isDneBody(Object.create({ error: "CVE_RECORD_DNE" })), false);
});

test("produceSsvc: a 404 whose body error is CVE_RECORD_DNE answers not-assessed", async () => {
  const body = { error: "CVE_RECORD_DNE", message: "The cve record for the cve id does not exist." };
  const { fetcher } = fakeFetcher(() => json(body, 404));
  assert.deepStrictEqual(await produceSsvc(ID, { fetcher }), { state: "not-assessed" });
});

test("produceSsvc: any other 404 body throws ssvc: unexpected 404", async () => {
  for (const body of [{ error: "NOT_FOUND" }, ["CVE_RECORD_DNE"], "CVE_RECORD_DNE", null, {}]) {
    const { fetcher } = fakeFetcher(() => json(body, 404));
    await assert.rejects(produceSsvc(ID, { fetcher }), /^Error: ssvc: unexpected 404$/);
  }
});

test("produceSsvc: sends the crawler User-Agent and Accept application/json, and no next option", async () => {
  const { fetcher, calls } = fakeFetcher(() => json(activeRecord()));
  await produceSsvc(ID, { fetcher });
  assert.deepStrictEqual(calls[0].init.headers, { "User-Agent": USER_AGENT, Accept: "application/json" });
  assert.equal(Object.hasOwn(calls[0].init, "next"), false);
});

// Real sockets: the fixture server answers /ssvc-MODE/ID.

let server: EnrichmentServer;
before(async () => {
  server = await startEnrichmentServer();
});
after(async () => {
  await server.close();
});

const FAST = { timeoutMs: 1_000, maxBytes: 64 * 1024 };
const at = (mode: string) => ({ url: `${server.baseUrl}/ssvc-${mode}`, ...FAST });
const ssvcRequests = () => server.requests.filter((r) => r.startsWith("/ssvc-"));

test("produceSsvc against /ssvc-ok: each ID set gets its state and exactly one request", async () => {
  server.requests.length = 0;
  for (const id of SSVC_ACTIVE_IDS) {
    assert.deepStrictEqual(await produceSsvc(id, at("ok")), {
      state: "assessed",
      exploitation: "active",
      automatable: "yes",
      technicalImpact: "total",
    });
  }
  for (const id of SSVC_POC_IDS) {
    assert.equal(((await produceSsvc(id, at("ok"))) as { exploitation: string }).exploitation, "poc");
  }
  for (const id of SSVC_NONE_IDS) {
    assert.equal(((await produceSsvc(id, at("ok"))) as { exploitation: string }).exploitation, "none");
  }
  for (const id of SSVC_DNE_IDS) {
    assert.deepStrictEqual(await produceSsvc(id, at("ok")), { state: "not-assessed" });
  }
  assert.deepStrictEqual(await produceSsvc("CVE-2024-44001", at("ok")), { state: "not-assessed" });
  assert.equal(ssvcRequests().length, 3 + 3 + 3 + 2 + 1);
  assert.ok(server.requests.includes(`/ssvc-ok/${SSVC_ACTIVE_IDS[0]}`));
});

test("produceSsvc against /ssvc-active, /ssvc-no-adp and /ssvc-dne", async () => {
  assert.equal(((await produceSsvc("CVE-2024-44002", at("active"))) as { exploitation: string }).exploitation, "active");
  assert.deepStrictEqual(await produceSsvc("CVE-2024-44002", at("no-adp")), { state: "not-assessed" });
  assert.deepStrictEqual(await produceSsvc("CVE-2024-44002", at("dne")), { state: "not-assessed" });
});

test("produceSsvc against /ssvc-wrong-404 throws ssvc: unexpected 404", async () => {
  await assert.rejects(produceSsvc("CVE-2024-44003", at("wrong-404")), /^Error: ssvc: unexpected 404$/);
});

test("produceSsvc against 500, 429, malformed JSON and an HTML page throws an ssvc: message", async () => {
  for (const mode of ["status-500", "429", "malformed", "html"]) {
    await assert.rejects(produceSsvc("CVE-2024-44004", at(mode)), (err: Error) => {
      assert.match(err.message, /^ssvc: /, mode);
      assert.doesNotMatch(err.message, /INTERNAL_SERVER_ERROR|RATE_LIMITED|Service notice/, mode);
      return true;
    });
  }
});

test("produceSsvc against every hostile record variant throws ssvc: unusable record", async () => {
  for (let digit = 0; digit < 10; digit++) {
    await assert.rejects(
      produceSsvc(`CVE-2024-4500${digit}`, at("hostile")),
      /^Error: ssvc: unusable record$/,
      `hostile variant ${digit}`
    );
  }
});

test("produceSsvc against a closed port throws an ssvc: message", async () => {
  const closed = http.createServer();
  await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const port = (closed.address() as AddressInfo).port;
  await new Promise<void>((resolve) => closed.close(() => resolve()));
  await assert.rejects(
    produceSsvc("CVE-2024-44005", { url: `http://127.0.0.1:${port}/ssvc-ok`, ...FAST }),
    /^Error: ssvc: lookup failed$/
  );
});

test("produceSsvc rejects a lowercase ID, a path-traversal string and a too-short number with zero fixture requests", async () => {
  server.requests.length = 0;
  for (const bad of ["cve-2024-3400", "../../etc/passwd", "CVE-2024-12", "CVE-2024-3400?x=1", "CVE-2024-3400/../x"]) {
    await assert.rejects(produceSsvc(bad, at("ok")), /^Error: ssvc: invalid id$/);
  }
  assert.equal(server.requests.length, 0);
});

test("fetchSsvc with produceSsvc against /ssvc-ok gives the expected state per ID set, one request per ID", async () => {
  server.requests.length = 0;
  const others = ["CVE-2024-44010", "CVE-2024-44011"];
  const ids = [...SSVC_ACTIVE_IDS, ...SSVC_POC_IDS, ...SSVC_NONE_IDS, ...SSVC_DNE_IDS, ...others];
  const out = await fetchSsvc(ids, { lookup: (id) => produceSsvc(id, at("ok")), concurrency: 4 });
  assert.deepStrictEqual(Object.keys(out).sort(), [...ids].sort());
  for (const id of SSVC_ACTIVE_IDS) assert.equal((out[id] as { exploitation: string }).exploitation, "active", id);
  for (const id of SSVC_POC_IDS) assert.equal((out[id] as { exploitation: string }).exploitation, "poc", id);
  for (const id of SSVC_NONE_IDS) assert.equal((out[id] as { exploitation: string }).exploitation, "none", id);
  for (const id of [...SSVC_DNE_IDS, ...others]) assert.deepStrictEqual(out[id], { state: "not-assessed" }, id);
  assert.equal(ssvcRequests().length, ids.length);
  for (const id of ids) assert.equal(ssvcRequests().filter((r) => r === `/ssvc-ok/${id}`).length, 1, id);
});

test("fetchSsvc with produceSsvc against failing routes gives unavailable for every ID, never not-assessed", async () => {
  const ids = ["CVE-2024-44020", "CVE-2024-44021"];
  for (const mode of ["status-500", "429", "malformed", "html", "wrong-404", "hostile"]) {
    const out = await fetchSsvc(ids, { lookup: (id) => produceSsvc(id, at(mode)) });
    for (const id of ids) assert.deepStrictEqual(out[id], { state: "unavailable" }, `${mode} ${id}`);
  }
});
