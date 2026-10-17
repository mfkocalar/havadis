import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  KEV_FIXTURE_IDS,
  KEV_HOSTILE_FUTURE_ID,
  startEnrichmentServer,
  type EnrichmentServer,
} from "../../../test/fixtures/enrichmentServer.ts";
import { makeArticle } from "../../../test/fixtures/makeArticle.ts";
import { CVE_ID_SHAPE, planCveChips } from "../cveChips.ts";
import type { ClassifiedArticle, EnrichmentSnapshot, KevMap, KevRead } from "../types.ts";
import { enrichCves, enrichmentNotice, uniqueCves } from "./enrich.ts";
import { produceKev } from "./kev.ts";

/**
 * Hermetic outage proof (ROADMAP SC2 and SC3, ENR-01, ENR-03, D-09, D-10,
 * D-18). Every upstream URL and limit goes through deps, so no request leaves
 * 127.0.0.1. Assertions are properties and bands (set membership, counts,
 * elapsed bounds), never raw scores. The false-assurance wording check lives
 * here only, never in source: it asserts absence.
 */

const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const FALSE_ASSURANCE = /not (?:in|listed in) kev|not exploited/i;

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
 * The KEV x EPSS degradation matrix. The edition's CVEs: 120 EPSS-fixture IDs
 * (which include the ID `/epss-partial` fails and two the consistent routes
 * answer without a row), the five KEV-listed IDs, and IDs that are in neither.
 */
const EDITION_CVES = [
  ...Array.from({ length: 120 }, (_, i) => `CVE-2024-${10_000 + i}`),
  ...KEV_FIXTURE_IDS,
];

function article(cves: string[]): ClassifiedArticle {
  return { ...makeArticle(), section: "Vulnerabilities", cves };
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

describe("enrichCves across KEV and EPSS degradation", () => {
  let okMap: KevMap;
  let staleMap: KevMap;
  before(async () => {
    okMap = await produceKev(NOW, { url: `${server.baseUrl}/kev-ok`, ...FAST });
    staleMap = { ...okMap, entries: { ...okMap.entries }, fetchedAt: new Date(NOW - 30 * DAY).toISOString() };
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

  function expectedNotice(kev: KevCase, epss: EpssCase): string | null {
    const kevPart =
      kev.status === "unavailable"
        ? "KEV data unavailable"
        : kev.status === "stale"
          ? `KEV data from ${new Date(NOW - 30 * DAY).toISOString().slice(0, 10)}`
          : null;
    const parts = [kevPart, epss.part].filter((p): p is string => p !== null);
    return parts.length === 0 ? null : parts.join(" · ");
  }

  const ids = uniqueCves(editionArticles());

  async function run(kev: KevCase, epss: EpssCase): Promise<EnrichmentSnapshot> {
    return enrichCves(ids, { kev: kev.read }, NOW, {
      epss: { url: `${server.baseUrl}${epss.route}`, timeoutMs: 300 },
    });
  }

  test("every combination resolves with a state for every CVE and honest health and notice", async () => {
    let combos = 0;
    for (const kev of kevCases()) {
      for (const epss of epssCases) {
        const label = `${kev.name} x ${epss.route}`;
        const snap = await run(kev, epss);
        combos++;

        assert.deepStrictEqual(Object.keys(snap.byCve).sort(), [...ids].sort(), label);
        assert.equal(snap.health.kev.status, kev.status, label);
        assert.equal(snap.health.epss.status, epss.status, label);

        for (const id of ids) {
          const state = snap.byCve[id];
          if (kev.status === "unavailable") {
            assert.deepStrictEqual(state.kev, { state: "unavailable" }, `${label} ${id}`);
          } else if (KEV_FIXTURE_IDS.includes(id)) {
            assert.equal(state.kev.state, "listed", `${label} ${id} stays listed`);
          } else {
            assert.equal(state.kev.state, "not-listed", `${label} ${id}`);
          }
          if (epss.status === "unavailable") {
            assert.deepStrictEqual(state.epss, { state: "unavailable" }, `${label} ${id}`);
          }
        }

        const notice = enrichmentNotice(snap.health);
        assert.equal(notice, expectedNotice(kev, epss), label);
        assert.doesNotMatch(JSON.stringify(snap) + (notice ?? ""), FALSE_ASSURANCE, label);
      }
    }
    assert.equal(combos, 12);
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
