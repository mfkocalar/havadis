import { test } from "node:test";
import assert from "node:assert/strict";
import { makeArticle } from "../../test/fixtures/makeArticle.ts";
import { EDITION_CACHE_KEY, produceEdition } from "./edition.ts";
import { SECTION_DISPLAY_ORDER } from "./config/sections.ts";
import { composeFrontPage } from "./pipeline/getFrontPage.ts";
import type { Article, SectionedFrontPageResult } from "./types.ts";

/**
 * Hermetic tests of the pure edition policy (D-05): every call injects a
 * loader, so nothing touches the network or the clock.
 */

const NOW = Date.parse("2026-09-23T12:00:00.000Z");
const HOUR = 3_600_000;

test("an errored load is rejected with its reason", async () => {
  const load = async (): Promise<SectionedFrontPageResult> => ({ status: "error", reason: "boom" });
  await assert.rejects(produceEdition(NOW, load), /edition rejected: boom/);
});

test("a load with zero articles is rejected", async () => {
  const load = async (now: number): Promise<SectionedFrontPageResult> => composeFrontPage([], now);
  await assert.rejects(produceEdition(NOW, load), /edition rejected: zero articles/);
});

test("a partial edition with at least one article is published unchanged", async () => {
  const composed = composeFrontPage(
    [makeArticle({ publishedAt: new Date(NOW - HOUR).toISOString() })],
    NOW
  );
  const edition = await produceEdition(NOW, async () => composed);
  assert.equal(edition, composed);
  assert.equal(edition.status, "ok");
  assert.ok(edition.articles.length >= 1);
});

test("the loader is called once, with exactly the now it was given", async () => {
  const seen: number[] = [];
  const load = async (now: number): Promise<SectionedFrontPageResult> => {
    seen.push(now);
    return composeFrontPage([makeArticle({ publishedAt: new Date(NOW).toISOString() })], now);
  };
  await produceEdition(NOW, load);
  assert.deepEqual(seen, [NOW]);
});

/**
 * Fixed article set for the golden and round-trip tests. Titles are chosen
 * against SECTION_KEYWORDS: a CVE id (Vulnerabilities), ransomware, breach
 * and advisory headlines, and a plain policy headline that falls into the
 * Industry/Policy default bucket. Two articles share one URL so dedupe
 * collapses them, and the Vulnerabilities section holds two articles of
 * different tiers so ranking has something to order.
 */
const SHARED_URL = "https://fixture.test/shared-story";

function goldenFixture(): Article[] {
  const at = (hoursAgo: number): string => new Date(NOW - hoursAgo * HOUR).toISOString();
  return [
    makeArticle({
      title: "CVE-2026-1111 allows remote code execution in a router",
      url: "https://fixture.test/vuln-gov",
      source: "Gov Source",
      sourceTier: "Government",
      summary: "A critical flaw is being patched.",
      publishedAt: at(2),
    }),
    makeArticle({
      title: "Researchers describe a new zero-day in a popular browser",
      url: "https://fixture.test/vuln-general",
      source: "General Source",
      sourceTier: "Tech & General",
      summary: "Tracked as CVE-2026-2222 by the vendor.",
      publishedAt: at(1),
    }),
    makeArticle({
      title: "A ransomware crew hits a hospital network",
      url: "https://fixture.test/ransom",
      source: "Research Source",
      sourceTier: "Security Research",
      summary: "Operations were disrupted.",
      publishedAt: at(5),
    }),
    makeArticle({
      title: "Retailer confirms a customer breach",
      url: "https://fixture.test/breach",
      source: "Enterprise Source",
      sourceTier: "Enterprise Security",
      summary: "Notification letters are going out.",
      publishedAt: at(8),
    }),
    makeArticle({
      title: "Agency issues advisory for industrial controllers",
      url: "https://fixture.test/advisory",
      source: "Gov Source",
      sourceTier: "Government",
      summary: "Operators should review their exposure.",
      publishedAt: at(11),
    }),
    makeArticle({
      title: "Parliament debates a new reporting rule",
      url: "https://fixture.test/policy",
      source: "General Source",
      sourceTier: "Tech & General",
      summary: "Lawmakers return next week.",
      publishedAt: at(14),
    }),
    makeArticle({
      title: "Shared story, first outlet",
      url: SHARED_URL,
      source: "Research Source",
      sourceTier: "Security Research",
      summary: "Covered by two outlets.",
      publishedAt: at(18),
    }),
    makeArticle({
      title: "Shared story, second outlet",
      url: SHARED_URL,
      source: "General Source",
      sourceTier: "Tech & General",
      summary: "Covered by two outlets.",
      publishedAt: at(17),
    }),
  ];
}

/** What unstable_cache stores and returns: the edition through JSON. */
function viaJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test("golden: the cached read path shows the same edition as the existing composition (D-04)", async () => {
  const articles = goldenFixture();
  const direct = composeFrontPage(structuredClone(articles), NOW);
  const cached = viaJson(
    await produceEdition(NOW, async (now) => composeFrontPage(structuredClone(articles), now))
  );

  assert.deepStrictEqual(cached, direct);

  const names = cached.sections.map((g) => g.section);
  assert.deepStrictEqual(
    names,
    direct.sections.map((g) => g.section)
  );
  const displayIndex = names.map((n) => SECTION_DISPLAY_ORDER.indexOf(n));
  assert.ok(displayIndex.every((i) => i >= 0), "every section is a known section");
  assert.deepStrictEqual(
    displayIndex,
    [...displayIndex].sort((a, b) => a - b),
    "sections follow SECTION_DISPLAY_ORDER"
  );
  assert.ok(names.length >= 3, "the fixture spreads over at least three sections");

  assert.deepStrictEqual(
    cached.sections.map((g) => g.articles.length),
    direct.sections.map((g) => g.articles.length)
  );
  assert.deepStrictEqual(
    cached.sections.map((g) => g.articles.map((a) => a.url)),
    direct.sections.map((g) => g.articles.map((a) => a.url))
  );
  assert.equal(cached.generatedAt, new Date(NOW).toISOString());
  assert.deepStrictEqual(
    cached.articles,
    cached.sections.flatMap((g) => g.articles)
  );
  assert.equal(cached.articles.filter((a) => a.url === SHARED_URL).length, 1);
});

test("the edition survives a JSON round trip unchanged (D-02)", async () => {
  const articles = goldenFixture();
  const edition = await produceEdition(NOW, async (now) =>
    composeFrontPage(structuredClone(articles), now)
  );
  assert.deepStrictEqual(viaJson(edition), edition);

  // Negative controls: the same assertion must fail for values JSON cannot carry.
  const withDate = { ...edition, extra: new Date(NOW) };
  assert.throws(() => assert.deepStrictEqual(JSON.parse(JSON.stringify(withDate)), withDate));
  const withMap = { ...edition, extra: new Map([["a", 1]]) };
  assert.throws(() => assert.deepStrictEqual(JSON.parse(JSON.stringify(withMap)), withMap));
});

/**
 * Key sets of the cached edition, per snapshot cache-key version. NEVER edit
 * an existing entry: a shape change adds a new entry under the next version
 * (havadis-snapshot-v2) and bumps EDITION_CACHE_KEY in src/lib/edition.ts in
 * the same commit, because Vercel's Data Cache persists across deployments
 * and an unchanged key would serve old-shape JSON to new code.
 */
const PINNED_SHAPES: Record<string, { edition: string[]; group: string[]; article: string[] }> = {
  "havadis-snapshot-v1": {
    edition: ["articles", "generatedAt", "sections", "status"],
    group: ["articles", "section"],
    article: ["cves", "publishedAt", "section", "source", "sourceTier", "sourceType", "summary", "title", "url"],
  },
  "havadis-snapshot-v2": {
    edition: ["articles", "generatedAt", "sections", "status"],
    group: ["articles", "section"],
    article: ["cves", "id", "importance", "importanceReason", "publishedAt", "section", "source", "sourceTier", "sourceType", "summary", "title", "url"],
  },
};

test("schema pin: a shape change must ship with a new snapshot key (Pitfall 5)", async () => {
  const pinned = PINNED_SHAPES[EDITION_CACHE_KEY];
  assert.ok(pinned, `no pinned shape for ${EDITION_CACHE_KEY}: add one when bumping the key`);

  const articles = goldenFixture();
  const edition = await produceEdition(NOW, async (now) =>
    composeFrontPage(structuredClone(articles), now)
  );
  const keys = (o: object): string[] => Object.keys(o).sort();

  assert.deepStrictEqual(keys(edition), pinned.edition);
  assert.ok(edition.sections.length > 0);
  for (const group of edition.sections) {
    assert.deepStrictEqual(keys(group), pinned.group);
    assert.ok(group.articles.length > 0);
    for (const article of group.articles) {
      assert.deepStrictEqual(keys(article), pinned.article);
    }
  }
});
