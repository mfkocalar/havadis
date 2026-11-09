import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  KEV_FIXTURE_IDS,
  KEV_HOSTILE_FUTURE_ID,
  SSVC_ACTIVE_IDS,
  SSVC_DNE_IDS,
  SSVC_FAIL_IDS,
  SSVC_NONE_IDS,
  SSVC_POC_IDS,
  startEnrichmentServer,
  type EnrichmentServer,
} from "../../../test/fixtures/enrichmentServer.ts";
import { makeArticle } from "../../../test/fixtures/makeArticle.ts";
import { CVE_ID_SHAPE, planCveChips } from "../cveChips.ts";
import type { ClassifiedArticle, EnrichmentSnapshot, KevMap, KevRead } from "../types.ts";
import { enrichCves, enrichmentNotice, uniqueCves } from "./enrich.ts";
import { produceKev } from "./kev.ts";
import { produceSsvc } from "./ssvc.ts";

/**
 * Hermetic outage proof (ROADMAP SC2 and SC3, ENR-01, ENR-03, ENR-07, D-09,
 * D-10, D-18). Every upstream URL and limit goes through deps, so no request leaves
 * 127.0.0.1. Assertions are properties and bands (set membership, counts,
 * elapsed bounds), never raw scores. The false-assurance wording check lives
 * here only, never in source: it asserts absence.
 */

const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const FALSE_ASSURANCE =
  /not (?:in|listed in) kev|not exploited|exploitation none|ssvc none|not assessed/i;

let server: EnrichmentServer;
before(async () => {
  server = await startEnrichmentServer();
});
after(async () => {
  await server.close();
});

/** Tight budgets so a withheld or dripping answer cannot stall the suite. */
const FAST = { timeoutMs: 300, minEntries: 5 };

function isKevRejection(err: unknown): boolean {
  return err instanceof Error && /^kev rejected:/.test(err.message);
}

describe("produceKev: every failure mode rejects and never resolves to a map", () => {
  test("/hang and /slow-body reject within the time budget", async (t) => {
    for (const route of ["/hang", "/slow-body"]) {
      const start = Date.now();
      await assert.rejects(
        produceKev(NOW, { url: `${server.baseUrl}${route}`, ...FAST }),
        isKevRejection,
        route
      );
      const elapsed = Date.now() - start;
      t.diagnostic(`${route} rejected after ${elapsed} ms`);
      assert.ok(elapsed < 2_000, `${route} took ${elapsed} ms`);
    }
  });

  test("/oversize, /status-500, /malformed and /html reject", async () => {
    for (const route of ["/oversize", "/status-500", "/malformed", "/html"]) {
      await assert.rejects(
        produceKev(NOW, {
          url: `${server.baseUrl}${route}`,
          timeoutMs: 5_000,
          maxRawBytes: 65_536,
          minEntries: 5,
        }),
        isKevRejection,
        route
      );
    }
  });

  test("a refused connection rejects", async () => {
    const closed = await startEnrichmentServer();
    const dead = closed.baseUrl;
    await closed.close();
    await assert.rejects(produceKev(NOW, { url: `${dead}/kev-ok`, ...FAST }), isKevRejection);
  });

  test("count collapse, schema drift, count mismatch and an over-cap slim map reject", async () => {
    await assert.rejects(
      produceKev(NOW, { url: `${server.baseUrl}/kev-collapse`, ...FAST }),
      isKevRejection,
      "/kev-collapse (3 entries, floor 5)"
    );
    await assert.rejects(
      produceKev(NOW, { url: `${server.baseUrl}/kev-drift`, ...FAST }),
      isKevRejection,
      "/kev-drift (5 bad among 100)"
    );
    await assert.rejects(
      produceKev(NOW, { url: `${server.baseUrl}/kev-count-mismatch`, ...FAST }),
      isKevRejection,
      "/kev-count-mismatch"
    );
    await assert.rejects(
      produceKev(NOW, { url: `${server.baseUrl}/kev-big`, ...FAST, maxSlimBytes: 1024 }),
      isKevRejection,
      "/kev-big (slim cap 1024)"
    );
  });

  test("the rejections come from the rules: the same feeds pass under looser limits", async () => {
    const collapse = await produceKev(NOW, {
      url: `${server.baseUrl}/kev-collapse`,
      timeoutMs: 300,
      minEntries: 3,
    });
    assert.equal(Object.keys(collapse.entries).length, 3);
    const big = await produceKev(NOW, { url: `${server.baseUrl}/kev-big`, ...FAST });
    assert.equal(Object.keys(big.entries).length, 200);
  });
});

describe("produceKev: good and hostile feeds", () => {
  test("/kev-ok resolves with exactly KEV_FIXTURE_IDS as entry keys", async () => {
    const map = await produceKev(NOW, { url: `${server.baseUrl}/kev-ok`, ...FAST });
    assert.deepStrictEqual(Object.keys(map.entries).sort(), [...KEV_FIXTURE_IDS].sort());
    assert.equal(map.fetchedAt, new Date(NOW).toISOString());
  });

  test("/kev-hostile resolves without the bad keys: 199 entries, no __proto__, no future-dated ID", async () => {
    const map = await produceKev(NOW, { url: `${server.baseUrl}/kev-hostile`, ...FAST });
    assert.equal(Object.keys(map.entries).length, 199);
    assert.equal(Object.hasOwn(map.entries, "__proto__"), false);
    assert.equal(Object.hasOwn(map.entries, KEV_HOSTILE_FUTURE_ID), false);
    assert.equal(Object.getPrototypeOf(map.entries), Object.prototype);
  });
});

/**
 * The KEV x EPSS x SSVC degradation matrix. The edition's CVEs: 120 EPSS-fixture
 * IDs (which include the ID `/epss-partial` fails and two the consistent routes
 * answer without a row), the five KEV-listed IDs, the SSVC fixture ID sets
 * (active, poc, none, nonexistent, failing) and IDs that are in none of them.
 */
const EDITION_CVES = [
  ...Array.from({ length: 120 }, (_, i) => `CVE-2024-${10_000 + i}`),
  ...KEV_FIXTURE_IDS,
  ...SSVC_ACTIVE_IDS,
  ...SSVC_POC_IDS,
  ...SSVC_NONE_IDS,
  ...SSVC_DNE_IDS,
  ...SSVC_FAIL_IDS,
];

function article(cves: string[]): ClassifiedArticle {
  return { ...makeArticle(), section: "Vulnerabilities", importance: "normal", importanceReason: null, id: "id", cves };
}

/** Articles covering every edition CVE (so every EPSS batch is exercised), plus awkward lists. */
function editionArticles(): ClassifiedArticle[] {
  const articles: ClassifiedArticle[] = [];
  for (let i = 0; i < EDITION_CVES.length; i += 5) articles.push(article(EDITION_CVES.slice(i, i + 5)));
  articles.push(article([...KEV_FIXTURE_IDS, "CVE-2024-10003"]));
  articles.push(article([...EDITION_CVES.slice(95, 103), "not-a-cve", "CVE-2024-BAD"]));
  articles.push(article([KEV_FIXTURE_IDS[0]]));
  articles.push(article([]));
  return articles;
}

type KevCase = { name: string; read: KevRead; status: "ok" | "stale" | "unavailable" };
type EpssCase = {
  route: string;
  status: "ok" | "partial" | "unavailable";
  part: string | null;
};
/** What one non-skipped CVE must read as: its assessed exploitation level, or its non-assessed state. */
type Expected = "unavailable" | "not-assessed" | "none" | "poc" | "active";
type SsvcCase = {
  name: string;
  /** The fixture route, or null for the closed port. */
  route: string | null;
  status: "ok" | "partial" | "unavailable";
  part: string | null;
  expect: (id: string) => Expected;
  /** The whole-phase budget: short for sources that hold or drip every answer. */
  budgetMs: number;
};

const everyId = (e: Expected) => () => e;
const failing = (name: string, route: string | null, budgetMs = 5_000): SsvcCase => ({
  name,
  route,
  status: "unavailable",
  part: "SSVC data unavailable",
  expect: everyId("unavailable"),
  budgetMs,
});
const SSVC_CASES: SsvcCase[] = [
  {
    name: "ok",
    route: "/ssvc-ok",
    status: "ok",
    part: null,
    expect: (id) =>
      SSVC_ACTIVE_IDS.includes(id)
        ? "active"
        : SSVC_POC_IDS.includes(id)
          ? "poc"
          : SSVC_NONE_IDS.includes(id)
            ? "none"
            : "not-assessed",
    budgetMs: 5_000,
  },
  { name: "no-adp", route: "/ssvc-no-adp", status: "ok", part: null, expect: everyId("not-assessed"), budgetMs: 5_000 },
  { name: "dne", route: "/ssvc-dne", status: "ok", part: null, expect: everyId("not-assessed"), budgetMs: 5_000 },
  { name: "active", route: "/ssvc-active", status: "ok", part: null, expect: everyId("active"), budgetMs: 5_000 },
  failing("status-500", "/ssvc-status-500"),
  failing("429", "/ssvc-429"),
  failing("hang", "/ssvc-hang", 1_000),
  failing("drip", "/ssvc-drip", 1_000),
  failing("oversize", "/ssvc-oversize"),
  failing("malformed", "/ssvc-malformed"),
  failing("html", "/ssvc-html"),
  failing("hostile", "/ssvc-hostile"),
  failing("wrong-404", "/ssvc-wrong-404"),
  failing("closed port", null),
  {
    name: "partial",
    route: "/ssvc-partial",
    status: "partial",
    part: "SSVC partially unavailable",
    // Every ID but the failing ones gets the ok route's answer.
    expect: (id) => (SSVC_FAIL_IDS.includes(id) ? "unavailable" : SSVC_CASES[0].expect(id)),
    budgetMs: 5_000,
  },
];
const SSVC_OK = SSVC_CASES[0];
const SSVC_DOWN = SSVC_CASES.find((c) => c.name === "status-500") as SsvcCase;

describe("enrichCves across KEV, EPSS and SSVC degradation", () => {
  let okMap: KevMap;
  let staleMap: KevMap;
  let closedBase: string;
  before(async () => {
    okMap = await produceKev(NOW, { url: `${server.baseUrl}/kev-ok`, ...FAST });
    staleMap = { ...okMap, entries: { ...okMap.entries }, fetchedAt: new Date(NOW - 30 * DAY).toISOString() };
    // A port that was open a moment ago and is now closed: the connection is refused.
    const closed = http.createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    closedBase = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
  });

  const kevCases = (): KevCase[] => [
    { name: "ok map", read: { status: "ok", map: okMap }, status: "ok" },
    { name: "30-day-old map", read: { status: "ok", map: staleMap }, status: "stale" },
    { name: "unavailable", read: { status: "unavailable" }, status: "unavailable" },
  ];
  const epssCases: EpssCase[] = [
    { route: "/epss-ok", status: "ok", part: null },
    { route: "/epss-partial", status: "partial", part: "EPSS partially unavailable" },
    { route: "/status-500", status: "unavailable", part: "EPSS data unavailable" },
    { route: "/hang", status: "unavailable", part: "EPSS data unavailable" },
  ];

  function expectedNotice(kev: KevCase, epss: EpssCase, ssvc: SsvcCase): string | null {
    const kevPart =
      kev.status === "unavailable"
        ? "KEV data unavailable"
        : kev.status === "stale"
          ? `KEV data from ${new Date(NOW - 30 * DAY).toISOString().slice(0, 10)}`
          : null;
    const parts = [kevPart, epss.part, ssvc.part].filter((p): p is string => p !== null);
    return parts.length === 0 ? null : parts.join(" · ");
  }

  const ids = uniqueCves(editionArticles());
  const cardCves = editionArticles().map((a) => a.cves);

  /**
   * The matrix edition has 136 candidates, over the production cap of 100, so
   * the lookup cap is lifted here: each case then isolates the source's own
   * degradation. The cap alone is proven in its own test below.
   */
  async function run(
    kev: KevCase,
    epss: EpssCase,
    ssvc: SsvcCase = SSVC_OK,
    cap: number | null = 1_000
  ): Promise<EnrichmentSnapshot> {
    const url = `${ssvc.route === null ? closedBase + "/ssvc-ok" : server.baseUrl + ssvc.route}`;
    return enrichCves(ids, { kev: kev.read, cardCves }, NOW, {
      epss: { url: `${server.baseUrl}${epss.route}`, timeoutMs: 300 },
      ssvc: {
        lookup: (id) => produceSsvc(id, { url, timeoutMs: 300, maxBytes: 64 * 1024 }),
        maxLookups: cap ?? undefined,
        totalBudgetMs: ssvc.budgetMs,
      },
    });
  }

  /** Every property one KEV x EPSS x SSVC combination must hold. Returns the number of SSVC chips on the page. */
  function assertCombination(snap: EnrichmentSnapshot, kev: KevCase, epss: EpssCase, ssvc: SsvcCase): number {
    const label = `${kev.name} x ${epss.route} x ssvc ${ssvc.name}`;
    assert.deepStrictEqual(Object.keys(snap.byCve).sort(), [...ids].sort(), label);
    assert.equal(snap.health.kev.status, kev.status, label);
    assert.equal(snap.health.epss.status, epss.status, label);
    assert.equal(snap.health.ssvc.status, ssvc.status, label);

    const kevKnown = kev.status !== "unavailable";
    for (const id of ids) {
      const state = snap.byCve[id];
      if (!kevKnown) {
        assert.deepStrictEqual(state.kev, { state: "unavailable" }, `${label} ${id}`);
      } else if (KEV_FIXTURE_IDS.includes(id)) {
        assert.equal(state.kev.state, "listed", `${label} ${id} stays listed`);
      } else {
        assert.equal(state.kev.state, "not-listed", `${label} ${id}`);
      }
      if (epss.status === "unavailable") {
        assert.deepStrictEqual(state.epss, { state: "unavailable" }, `${label} ${id}`);
      }

      // Skipped only for a listed CVE and only when KEV is known (D-05); every other CVE has a looked-up state.
      const s = state.ssvc;
      if (kevKnown && KEV_FIXTURE_IDS.includes(id)) {
        assert.deepStrictEqual(s, { state: "skipped" }, `${label} ${id}`);
      } else {
        assert.notEqual(s.state, "skipped", `${label} ${id} is skipped without a KEV listing`);
        const got = s.state === "assessed" ? s.exploitation : s.state;
        assert.equal(got, ssvc.expect(id), `${label} ${id}`);
      }
      // "none" is the fixture's own word and nothing else ever becomes it (ENR-07).
      if (s.state === "assessed" && s.exploitation === "none") {
        assert.ok(
          (ssvc.name === "ok" || ssvc.name === "partial") && SSVC_NONE_IDS.includes(id),
          `${label} ${id} became none`
        );
      }
    }

    const unavailable = ids.filter((id) => snap.byCve[id].ssvc.state === "unavailable").length;
    const requested = ids.filter((id) => snap.byCve[id].ssvc.state !== "skipped").length;
    assert.deepStrictEqual(snap.health.ssvc.requested, requested, label);
    assert.deepStrictEqual(snap.health.ssvc.unavailable, unavailable, label);

    const notice = enrichmentNotice(snap.health);
    assert.equal(notice, expectedNotice(kev, epss, ssvc), label);
    const text = JSON.stringify(snap) + (notice ?? "");
    assert.doesNotMatch(text, FALSE_ASSURANCE, label);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(snap)), snap, `${label} survives a JSON round trip`);

    // A chip for SSVC only ever stands for an assessed active or poc level of a CVE outside KEV (D-01, D-03).
    let chips = 0;
    for (const a of editionArticles()) {
      for (const chip of planCveChips(a.cves, snap.byCve).visible) {
        const e = snap.byCve[chip.id];
        const chipWorthy =
          e.kev.state !== "listed" &&
          e.ssvc.state === "assessed" &&
          (e.ssvc.exploitation === "active" || e.ssvc.exploitation === "poc");
        if (chipWorthy) {
          assert.deepStrictEqual(chip.ssvc, { level: (e.ssvc as { exploitation: string }).exploitation }, `${label} ${chip.id}`);
          chips++;
        } else {
          assert.equal(chip.ssvc, null, `${label} ${chip.id} must not carry an SSVC chip`);
        }
      }
    }
    return chips;
  }

  test("every KEV x EPSS combination on a healthy SSVC source resolves with honest states, health and notice", async () => {
    let combos = 0;
    for (const kev of kevCases()) {
      for (const epss of epssCases) {
        assertCombination(await run(kev, epss), kev, epss, SSVC_OK);
        combos++;
      }
    }
    assert.equal(combos, 12);
  });

  test("every KEV x SSVC source case, with EPSS ok, resolves with honest states, health and notice", async (t) => {
    const start = Date.now();
    let combos = 0;
    let activeChips = 0;
    for (const kev of kevCases()) {
      for (const ssvc of SSVC_CASES) {
        const chips = assertCombination(await run(kev, epssCases[0], ssvc), kev, epssCases[0], ssvc);
        combos++;
        if (ssvc.name === "active") activeChips += chips;
        if (ssvc.status === "unavailable") assert.equal(chips, 0, `${kev.name} x ${ssvc.name} shows no SSVC chip`);
      }
    }
    assert.equal(combos, 3 * SSVC_CASES.length);
    assert.ok(activeChips > 0, "the all-active source puts SSVC chips on the page (non-vacuity)");
    t.diagnostic(`SSVC matrix: ${combos} combinations in ${Date.now() - start} ms`);
  });

  test("a degraded EPSS source crossed with a healthy and a down SSVC source keeps every notice part", async (t) => {
    const start = Date.now();
    let combos = 0;
    for (const kev of kevCases()) {
      for (const epss of epssCases.slice(1)) {
        for (const ssvc of [SSVC_OK, SSVC_DOWN]) {
          assertCombination(await run(kev, epss, ssvc), kev, epss, ssvc);
          combos++;
        }
      }
    }
    assert.equal(combos, 18);
    t.diagnostic(`EPSS x SSVC matrix: ${combos} combinations in ${Date.now() - start} ms`);
  });

  test("skipped appears only for a listed CVE under a known KEV map, and never raises a notice part", async () => {
    for (const kev of kevCases()) {
      const snap = await run(kev, epssCases[0]);
      const skipped = ids.filter((id) => snap.byCve[id].ssvc.state === "skipped");
      assert.deepStrictEqual(
        skipped.sort(),
        kev.status === "unavailable" ? [] : [...KEV_FIXTURE_IDS].sort(),
        kev.name
      );
      assert.equal(enrichmentNotice(snap.health)?.includes("SSVC") ?? false, false, kev.name);
    }
  });

  test("with KEV unavailable and more candidates than the cap, the cap alone makes SSVC partially unavailable", async () => {
    const unknownKev = kevCases()[2];
    const snap = await run(unknownKev, epssCases[0], SSVC_OK, null);
    assert.equal(snap.health.ssvc.status, "partial");
    assert.equal(snap.health.ssvc.requested, ids.length, "nothing is skipped when KEV is unknown");
    assert.equal(snap.health.ssvc.unavailable, ids.length - 100);
    assert.equal(enrichmentNotice(snap.health), "KEV data unavailable · SSVC partially unavailable");
    // Past the cap a CVE is unavailable, never not-assessed or none, and nothing is skipped.
    const states = ids.map((id) => snap.byCve[id].ssvc.state);
    assert.equal(states.filter((st) => st === "unavailable").length, ids.length - 100);
    assert.equal(states.filter((st) => st === "skipped").length, 0);
  });

  test("the notice vocabulary check can fail: each new false-assurance phrase is caught", () => {
    assert.match("Exploitation none", FALSE_ASSURANCE);
    assert.match("SSVC none", FALSE_ASSURANCE);
    assert.match("Not assessed", FALSE_ASSURANCE);
    assert.doesNotMatch("SSVC partially unavailable", FALSE_ASSURANCE);
  });

  test("a 30-day-old map still lists its CVEs: stale beats empty", async () => {
    const snap = await run(kevCases()[1], epssCases[0]);
    assert.equal(snap.health.kev.status, "stale");
    for (const id of KEV_FIXTURE_IDS) assert.equal(snap.byCve[id].kev.state, "listed", id);
  });

  test("health.epss counts match: partial leaves some IDs scored, hang leaves none", async () => {
    const partial = await run(kevCases()[0], epssCases[1]);
    assert.ok(partial.health.epss.unavailable > 0);
    assert.ok(partial.health.epss.unavailable < partial.health.epss.requested);
    const hung = await run(kevCases()[0], epssCases[3]);
    assert.equal(hung.health.epss.unavailable, hung.health.epss.requested);
  });

  test("every article keeps all of its valid CVE chips under every combination", async () => {
    const articles = editionArticles();
    for (const kev of kevCases()) {
      for (const epss of epssCases) {
        const snap = await run(kev, epss);
        for (const article of articles) {
          const valid = article.cves.filter((id) => CVE_ID_SHAPE.test(id)).length;
          const plan = planCveChips(article.cves, snap.byCve);
          assert.equal(
            plan.visible.length + plan.overflow,
            valid,
            `${kev.name} x ${epss.route}: ${article.title}`
          );
        }
      }
    }
  });
});
