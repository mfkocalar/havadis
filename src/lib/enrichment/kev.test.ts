import { test } from "node:test";
import assert from "node:assert/strict";
import { USER_AGENT } from "../config/crawler.ts";
import { KEV_CACHE_KEY, parseKev, produceKev } from "./kev.ts";

/**
 * Hermetic tests for the KEV validator and producer (ENR-01, D-19): no
 * network, no clock. Fetchers are injected and built from `new Response(...)`.
 */

const NOW = Date.parse("2026-10-09T12:00:00.000Z");

function raw(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cveID: id,
    vendorProject: "Vendor",
    product: "Product",
    vulnerabilityName: "Name",
    dateAdded: "2024-05-01",
    shortDescription: "text",
    requiredAction: "text",
    dueDate: "2024-05-22",
    knownRansomwareCampaignUse: "Unknown",
    notes: "",
    cwes: [],
    ...over,
  };
}

function validId(i: number): string {
  return `CVE-2024-${String(1000 + i)}`;
}

function validEntries(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => raw(validId(i)));
}

function feedOf(vulns: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "CISA Catalog of Known Exploited Vulnerabilities",
    catalogVersion: "2026.10.08",
    dateReleased: "2026-10-08T00:00:00.000Z",
    count: vulns.length,
    vulnerabilities: vulns,
    ...extra,
  };
}

const keys = (o: object): string[] => Object.keys(o).sort();

/**
 * Key sets of the cached KEV map, per KEV cache-key version. NEVER edit an
 * existing entry: a shape change adds a new entry under the next version
 * (havadis-kev-v2) and bumps KEV_CACHE_KEY in src/lib/enrichment/kev.ts in the
 * same commit, because Vercel's Data Cache persists across deployments and an
 * unchanged key would serve old-shape JSON to new code.
 */
const PINNED_KEV_SHAPES: Record<string, { map: string[]; entry: string[] }> = {
  "havadis-kev-v1": {
    map: ["catalogVersion", "entries", "fetchedAt", "version"],
    entry: ["added", "due", "ransomware"],
  },
};

test("parseKev slims a feed to added, due and ransomware per entry", () => {
  const feed = feedOf([
    raw("CVE-2024-0001", { knownRansomwareCampaignUse: "Known" }),
    raw("CVE-2024-0002", { knownRansomwareCampaignUse: "Unknown" }),
    raw("CVE-2024-0003", { knownRansomwareCampaignUse: "known" }),
    raw("CVE-2024-0004", { knownRansomwareCampaignUse: undefined, dueDate: "" }),
  ]);
  const map = parseKev(feed, NOW, { minEntries: 3 });
  assert.equal(map.version, 1);
  assert.equal(map.fetchedAt, new Date(NOW).toISOString());
  assert.equal(map.catalogVersion, "2026.10.08");
  assert.equal(Object.keys(map.entries).length, 4);
  for (const e of Object.values(map.entries)) {
    assert.deepStrictEqual(keys(e), ["added", "due", "ransomware"]);
  }
  assert.equal(map.entries["CVE-2024-0001"].ransomware, true);
  assert.equal(map.entries["CVE-2024-0002"].ransomware, false);
  assert.equal(map.entries["CVE-2024-0003"].ransomware, false);
  assert.equal(map.entries["CVE-2024-0004"].ransomware, false);
  assert.equal(map.entries["CVE-2024-0004"].due, "");
});

test("the parsed map survives a JSON round trip and matches its pinned shape", () => {
  const map = parseKev(feedOf(validEntries(4)), NOW, { minEntries: 3 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(map)), map);

  const pinned = PINNED_KEV_SHAPES[KEV_CACHE_KEY];
  assert.ok(pinned, `no pinned shape for ${KEV_CACHE_KEY}: add one when bumping the key`);
  assert.deepStrictEqual(keys(map), pinned.map);
  assert.ok(Object.keys(map.entries).length > 0);
  for (const entry of Object.values(map.entries)) {
    assert.deepStrictEqual(keys(entry), pinned.entry);
  }
});

test("parseKev rejects feeds that are not a usable catalog", () => {
  const limits = { minEntries: 50 };
  const rejects = (json: unknown, l: { minEntries?: number; maxSlimBytes?: number } = limits) =>
    assert.throws(() => parseKev(json, NOW, l), /kev rejected/);

  rejects(null);
  rejects([]);
  rejects("text");
  rejects({ title: "no list" });
  rejects({ vulnerabilities: "nope" });
  // count disagrees with the array length
  rejects(feedOf(validEntries(60), { count: 61 }));
  rejects(feedOf(validEntries(60), { count: "60" }));
  // zero valid entries is rejected even with a floor of zero
  rejects(feedOf([]), { minEntries: 0 });
  // valid entries below the floor
  rejects(feedOf(validEntries(4)), { minEntries: 5 });
  // schema drift: 2 invalid among 100 valid is above 1 percent
  rejects(feedOf([...validEntries(100), raw("bad"), raw("worse")]));
  // slim map over its byte cap
  rejects(feedOf(validEntries(200)), { minEntries: 100, maxSlimBytes: 1000 });
});

test("parseKev tolerates a single invalid entry among many (under 1 percent)", () => {
  const map = parseKev(feedOf([...validEntries(200), raw("not-a-cve")]), NOW, {
    minEntries: 100,
  });
  assert.equal(Object.keys(map.entries).length, 200);
});

test("parseKev skips entries with a malformed ID, date or due date, without failing", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["CVE-2025-0001", { cveID: "cve-2025-0001" }],
    ["CVE-2025-0002", { cveID: "CVE-2025-0002 trailing" }],
    ["__proto__", { cveID: "__proto__" }],
    ["CVE-2025-0004", { dateAdded: "2026-02-30" }],
    ["CVE-2025-0005", { dateAdded: "2021-11-02" }],
    ["CVE-2025-0006", { dateAdded: "2026-10-11" }], // two days after NOW
    ["CVE-2025-0007", { dueDate: "soon" }],
  ];
  for (const [id, over] of cases) {
    const map = parseKev(feedOf([...validEntries(200), raw(id, over)]), NOW, { minEntries: 100 });
    assert.equal(Object.keys(map.entries).length, 200, `${JSON.stringify(over)} should be skipped`);
    assert.equal(Object.hasOwn(map.entries, id), false);
    assert.equal(Object.hasOwn(map.entries, "__proto__"), false);
    assert.equal(Object.getPrototypeOf(map.entries), Object.prototype);
  }
});

test("parseKev accepts the boundary dates and a UTC date one day ahead", () => {
  const map = parseKev(
    feedOf([
      ...validEntries(200),
      raw("CVE-2025-0101", { dateAdded: "2021-11-03" }),
      raw("CVE-2025-0102", { dateAdded: "2026-10-10" }), // UTC date of NOW plus one day
    ]),
    NOW,
    { minEntries: 100 }
  );
  assert.equal(map.entries["CVE-2025-0101"].added, "2021-11-03");
  assert.equal(map.entries["CVE-2025-0102"].added, "2026-10-10");
});

test("parseKev builds fresh literals: a hostile __proto__ key on an entry is never copied", () => {
  const hostile = JSON.parse(
    '{"cveID":"CVE-2025-0200","dateAdded":"2025-01-01","dueDate":"2025-01-22",' +
      '"knownRansomwareCampaignUse":"Known","__proto__":{"added":"2099-01-01","polluted":true}}'
  ) as unknown;
  const map = parseKev(feedOf([...validEntries(200), hostile]), NOW, { minEntries: 100 });
  const entry = map.entries["CVE-2025-0200"];
  assert.deepStrictEqual(keys(entry), ["added", "due", "ransomware"]);
  assert.equal(entry.added, "2025-01-01");
  assert.equal(Object.getPrototypeOf(entry), Object.prototype);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("parseKev keeps the first valid entry of a duplicate cveID", () => {
  const map = parseKev(
    feedOf([
      ...validEntries(200),
      raw(validId(0), { dateAdded: "2025-09-09", knownRansomwareCampaignUse: "Known" }),
    ]),
    NOW,
    { minEntries: 100 }
  );
  assert.equal(Object.keys(map.entries).length, 200);
  assert.equal(map.entries[validId(0)].added, "2024-05-01");
  assert.equal(map.entries[validId(0)].ransomware, false);
});

test("parseKev replaces an unusable catalogVersion with 'unknown'", () => {
  const feed = feedOf(validEntries(4), { catalogVersion: "<script>alert(1)</script>" });
  assert.equal(parseKev(feed, NOW, { minEntries: 3 }).catalogVersion, "unknown");
  const noVersion = feedOf(validEntries(4), { catalogVersion: undefined });
  assert.equal(parseKev(noVersion, NOW, { minEntries: 3 }).catalogVersion, "unknown");
});

test("produceKev fetches the given URL with the crawler User-Agent and no next option", async () => {
  const calls: Array<{ url: string; init: RequestInit & { next?: unknown } }> = [];
  const url = "http://127.0.0.1:9/kev.json";
  const map = await produceKev(NOW, {
    url,
    minEntries: 3,
    fetcher: async (u, init) => {
      calls.push({ url: u, init: init ?? {} });
      return new Response(JSON.stringify(feedOf(validEntries(4))), { status: 200 });
    },
  });
  assert.equal(Object.keys(map.entries).length, 4);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, url);
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers["User-Agent"], USER_AGENT);
  assert.equal("next" in calls[0].init, false);
});

test("produceKev rejects (so the cache keeps the last map) on every failure", async () => {
  const respond = (res: () => Response) => ({ fetcher: async () => res(), minEntries: 3 });
  await assert.rejects(
    produceKev(NOW, respond(() => new Response("nope", { status: 500 }))),
    /kev rejected: status 500/
  );
  await assert.rejects(
    produceKev(NOW, respond(() => new Response("<html>not json</html>", { status: 200 }))),
    /kev rejected: invalid JSON/
  );
  await assert.rejects(
    produceKev(NOW, respond(() => new Response(JSON.stringify(feedOf([])), { status: 200 }))),
    /kev rejected/
  );
  await assert.rejects(
    produceKev(NOW, {
      minEntries: 3,
      maxRawBytes: 50,
      fetcher: async () => new Response(JSON.stringify(feedOf(validEntries(4))), { status: 200 }),
    }),
    /kev rejected: Response body exceeded 50 byte cap/
  );
  await assert.rejects(
    produceKev(NOW, {
      fetcher: async () => {
        throw new Error("connect refused");
      },
    }),
    /kev rejected: connect refused/
  );
});
