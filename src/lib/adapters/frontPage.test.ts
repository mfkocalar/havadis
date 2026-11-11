import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../db/openDb.ts";
import type { DbHandle } from "../db/openDb.ts";
import { loadMigrations, runMigrations } from "../db/migrator.ts";
import { seedBuiltins } from "../db/seed.ts";
import { dbFile } from "../db/paths.ts";
import { applySourceWindow } from "../pipeline/applySourceWindow.ts";
import { articleId } from "../pipeline/articleId.ts";
import { composeFrontPage } from "../pipeline/getFrontPage.ts";
import { rankScore } from "../pipeline/rank.ts";
import type { FeedFetchResult } from "../pipeline/feedResult.ts";
import { runIngestCycle } from "../worker/cycle.ts";
import { readFrontPage } from "./frontPage.ts";
import type { FrontPageRead } from "./frontPage.ts";
import { makeArticle, makeSource } from "../../../test/fixtures/makeArticle.ts";
import type { Article, SourceConfig } from "../types.ts";

/**
 * The read adapter against real database rows written by the real ingest cycle: the waiting state,
 * per-source last-good windows across failed and partial cycles, v1 grouping parity on tie-free
 * input, the declared full-tie lead rule, unavailable enrichment, and the one-snapshot read.
 */

const T = Date.parse("2026-11-11T08:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString();

const SRC_A = makeSource({ id: "src-a", name: "Source A", family: "fam-a", sourceType: "news", tier: "Security Research" });
const SRC_B = makeSource({ id: "src-b", name: "Source B", family: "fam-b", sourceType: "news", tier: "Government" });
const SRC_C = makeSource({ id: "src-c", name: "Source C", family: "fam-c", sourceType: "cert", tier: "Enterprise Security" });

const ERROR_FEED: FeedFetchResult = { status: "error", code: "network_error", httpStatus: null, retryAfterMs: null };

function okFeed(articles: Article[]): FeedFetchResult {
  return { status: "ok", articles, validators: { etag: null, lastModified: null }, httpStatus: 200 };
}

function art(source: SourceConfig, title: string, url: string, publishedAt: number, overrides: Partial<Article> = {}): Article {
  return makeArticle({
    title,
    url,
    source: source.name,
    sourceTier: source.tier,
    sourceType: source.sourceType,
    publishedAt: iso(publishedAt),
    ...overrides,
  });
}

type Feeds = Record<string, FeedFetchResult>;

type Harness = {
  handle: DbHandle;
  cycle: (at: number, feeds: Feeds, order?: readonly SourceConfig[]) => ReturnType<typeof runIngestCycle>;
  close: () => Promise<void>;
};

/** A migrated, seeded database (":memory:" unless a file is given) with an injected-feed cycle runner. */
async function harness(sources: readonly SourceConfig[], file = ":memory:"): Promise<Harness> {
  const handle = openDb(file, "worker");
  await runMigrations(handle, { migrations: loadMigrations(), backup: async () => null, now: () => T });
  await seedBuiltins(handle.db, sources, T);
  let counter = 0;
  const newId = () => `story-${String(++counter).padStart(3, "0")}`;
  return {
    handle,
    cycle: (at, feeds, order) =>
      runIngestCycle(
        handle.db,
        { sources: order ?? sources, newId, concurrency: 2, fetchFeed: async (source) => feeds[source.id] ?? ERROR_FEED },
        at,
      ),
    close: () => handle.close(),
  };
}

function ready(read: FrontPageRead): Extract<FrontPageRead, { kind: "ready" }> {
  assert.equal(read.kind, "ready", "expected a ready front page");
  return read as Extract<FrontPageRead, { kind: "ready" }>;
}

/** The fields the page renders from, per card, in page order. */
function cards(read: FrontPageRead) {
  return ready(read).result.articles.map((a) => ({
    title: a.title,
    url: a.url,
    id: a.id,
    section: a.section,
    importance: a.importance,
    cves: a.cves,
  }));
}

const titles = (read: FrontPageRead): string[] => ready(read).result.articles.map((a) => a.title);

// ---------------------------------------------------------------------------
// (1) waiting
// ---------------------------------------------------------------------------

test("waiting: a fresh database, and one that has only seen failed cycles, is waiting and never an empty ready result", async () => {
  const h = await harness([SRC_A, SRC_B]);
  try {
    assert.deepEqual(await readFrontPage(h.handle.db, T), { kind: "waiting" });
    await h.cycle(T, {});
    await h.cycle(T + DAY, { "src-a": ERROR_FEED, "src-b": ERROR_FEED });
    assert.deepEqual(await readFrontPage(h.handle.db, T + 2 * DAY), { kind: "waiting" });
  } finally {
    await h.close();
  }
});

// ---------------------------------------------------------------------------
// (2) failed cycles and the passing of time change nothing
// ---------------------------------------------------------------------------

test("PLAT-09: one good cycle, then failed cycles and four days of reads, always renders the same edition", async () => {
  const h = await harness([SRC_A, SRC_B, SRC_C]);
  try {
    await h.cycle(T, {
      "src-a": okFeed([
        art(SRC_A, "Ransomware crew hits a regional clinic", "https://a.test/1", T - 2 * HOUR),
        art(SRC_A, "CVE-2026-31001 flaw patched in the Cedar gateway", "https://a.test/2", T - 5 * HOUR),
        art(SRC_A, "Council votes on rules for connected car software", "https://a.test/3", T - 9 * HOUR),
      ]),
      "src-b": okFeed([art(SRC_B, "Agency advisory urges review of exposed ports", "https://b.test/1", T - 3 * HOUR)]),
      "src-c": okFeed([art(SRC_C, "Joint advisory on edge device configuration", "https://c.test/1", T - 30 * HOUR)]),
    });
    await h.cycle(T + DAY, { "src-a": ERROR_FEED, "src-b": ERROR_FEED, "src-c": ERROR_FEED });
    await h.cycle(T + 4 * DAY, {});

    const baseline = await readFrontPage(h.handle.db, T);
    assert.ok(ready(baseline).result.articles.length >= 5, "the baseline holds every in-window story");
    assert.equal(ready(baseline).result.generatedAt, iso(T));
    for (const now of [T, T + HOUR, T + 25 * HOUR, T + 4 * DAY]) {
      const read = await readFrontPage(h.handle.db, now);
      assert.notEqual(read.kind, "waiting");
      assert.deepEqual(cards(read), cards(baseline), `articles at ${iso(now)}`);
      assert.deepEqual(ready(read).result.sections, ready(baseline).result.sections, `sections at ${iso(now)}`);
      assert.equal(ready(read).result.generatedAt, iso(T), `generatedAt at ${iso(now)}`);
    }
  } finally {
    await h.close();
  }
});

// ---------------------------------------------------------------------------
// (3) per-source last-good (W3)
// ---------------------------------------------------------------------------

test("per-source last-good (W3): a partial cycle keeps the failed source's stories and moves only the succeeding source's window", async () => {
  const h = await harness([SRC_A, SRC_B]);
  try {
    await h.cycle(T, {
      "src-a": okFeed([
        art(SRC_A, "Alpha ransomware wave one", "https://a.test/old1", T - 3 * HOUR),
        art(SRC_A, "Alpha breach disclosure two", "https://a.test/old2", T - 6 * HOUR),
      ]),
      "src-b": okFeed([
        art(SRC_B, "Bravo advisory notice one", "https://b.test/old1", T - 4 * HOUR),
        art(SRC_B, "Bravo vulnerability fix two", "https://b.test/old2", T - 7 * HOUR),
      ]),
    });
    const later = T + 4 * DAY;
    await h.cycle(later, {
      "src-a": okFeed([
        art(SRC_A, "Alpha fresh malware report three", "https://a.test/new1", later - HOUR),
        art(SRC_A, "Alpha fresh leak report four", "https://a.test/new2", later - 2 * HOUR),
      ]),
      "src-b": ERROR_FEED,
    });

    const read = await readFrontPage(h.handle.db, later + HOUR);
    const shown = titles(read);
    assert.equal(ready(read).result.generatedAt, iso(later), "generatedAt is the partial cycle's time");
    for (const title of ["Bravo advisory notice one", "Bravo vulnerability fix two"]) {
      assert.ok(shown.includes(title), `B's story survives its failed partial cycle: ${title}`);
    }
    for (const title of ["Alpha ransomware wave one", "Alpha breach disclosure two"]) {
      assert.ok(!shown.includes(title), `A's window moved with A's new fetch: ${title}`);
    }
    for (const title of ["Alpha fresh malware report three", "Alpha fresh leak report four"]) {
      assert.ok(shown.includes(title), `A's fresh story is shown: ${title}`);
    }
    const bravo = ready(read).result.articles.find((a) => a.title === "Bravo advisory notice one")!;
    assert.equal(bravo.url, "https://b.test/old1");
    assert.equal(bravo.id, articleId("https://b.test/old1"));

    const before = cards(read);
    await h.cycle(T + 5 * DAY, { "src-a": ERROR_FEED, "src-b": ERROR_FEED });
    const after = await readFrontPage(h.handle.db, T + 5 * DAY + HOUR);
    assert.deepEqual(cards(after), before, "a failed cycle after the partial one changes nothing");
    assert.equal(ready(after).result.generatedAt, iso(later));
  } finally {
    await h.close();
  }
});

// ---------------------------------------------------------------------------
// (4) a cycle in which every source succeeds replaces the whole edition
// ---------------------------------------------------------------------------

test("a cycle in which every source succeeds moves generatedAt and every window", async () => {
  const h = await harness([SRC_A, SRC_B, SRC_C]);
  try {
    await h.cycle(T, {
      "src-a": okFeed([art(SRC_A, "Alpha ransomware wave one", "https://a.test/old", T - 3 * HOUR)]),
      "src-b": okFeed([art(SRC_B, "Bravo advisory notice one", "https://b.test/old", T - 4 * HOUR)]),
      "src-c": okFeed([art(SRC_C, "Charlie vulnerability bulletin one", "https://c.test/old", T - 30 * HOUR)]),
    });
    const later = T + 4 * DAY;
    await h.cycle(later, {
      "src-a": okFeed([art(SRC_A, "Alpha fresh malware report", "https://a.test/new", later - HOUR)]),
      "src-b": okFeed([art(SRC_B, "Bravo fresh leak report", "https://b.test/new", later - 2 * HOUR)]),
      "src-c": okFeed([art(SRC_C, "Charlie fresh advisory bulletin", "https://c.test/new", later - 50 * HOUR)]),
    });

    const read = await readFrontPage(h.handle.db, later + HOUR);
    assert.equal(ready(read).result.generatedAt, iso(later));
    assert.deepEqual(
      titles(read).sort(),
      ["Alpha fresh malware report", "Bravo fresh leak report", "Charlie fresh advisory bulletin"],
      "every item older than its lookback before the new cycle is gone",
    );
  } finally {
    await h.close();
  }
});

// ---------------------------------------------------------------------------
// (5) v1 parity on tie-free input
// ---------------------------------------------------------------------------

test("v1 parity on tie-free input: readFrontPage sections equal composeFrontPage over the same windowed articles", async () => {
  const sources = [SRC_A, SRC_B, SRC_C];
  const feeds: Record<string, Article[]> = {
    "src-a": [
      art(SRC_A, "Ransomware crew hits a regional clinic", "https://a.test/r1", T - 2 * HOUR - 1 * MINUTE),
      art(SRC_A, "CVE-2026-32001 flaw patched in the Cedar gateway", "https://a.test/v1", T - 5 * HOUR - 2 * MINUTE),
      art(SRC_A, "Council votes on rules for connected car software", "https://a.test/p1", T - 9 * HOUR - 3 * MINUTE),
      art(SRC_A, "Retailer confirms breach of loyalty accounts", "https://a.test/b1", T - 11 * HOUR - 4 * MINUTE),
      // Same story as B's "Shared headline" by normalized title: A published first, so A is the card.
      art(SRC_A, "Shared Headline About Harbor Outage", "https://a.test/dup-title", T - 6 * HOUR - 5 * MINUTE),
      // Same canonical URL as C's copy: C published earlier, so C is the card.
      art(SRC_A, "Quill dock update mirrors the notice", "https://shared.test/dock", T - 7 * HOUR - 6 * MINUTE),
    ],
    "src-b": [
      art(SRC_B, "Agency advisory urges review of exposed ports", "https://b.test/a1", T - 3 * HOUR - 7 * MINUTE),
      art(SRC_B, "shared headline about harbor outage!", "https://b.test/dup-title", T - 4 * HOUR - 8 * MINUTE),
      art(SRC_B, "Nation-state operators probe energy suppliers", "https://b.test/t1", T - 12 * HOUR - 9 * MINUTE),
      // Same publishedAt as C's copy but a higher tier weight: tier decides, not a tie.
      art(SRC_B, "Framework lets teams replay network captures", "https://b.test/tool", T - 8 * HOUR - 10 * MINUTE),
    ],
    "src-c": [
      art(SRC_C, "Joint advisory on edge device configuration", "https://c.test/a1", T - 30 * HOUR - 11 * MINUTE),
      art(SRC_C, "Quill dock update from the port authority", "https://shared.test/dock", T - 20 * HOUR - 12 * MINUTE),
      art(SRC_C, "Framework lets teams replay network captures!", "https://c.test/tool", T - 8 * HOUR - 10 * MINUTE),
    ],
  };
  const h = await harness(sources);
  try {
    await h.cycle(T, Object.fromEntries(Object.entries(feeds).map(([id, list]) => [id, okFeed(list)])));

    const windowed = sources.flatMap((source) => applySourceWindow(feeds[source.id]!, source, T));
    const expected = composeFrontPage(windowed, T);

    // The fixture is tie-free: no two copies in a duplicate group share both publishedAt and tier
    // weight, and no two cards of a section share a score (so v1's input-index tie-breaks never decide).
    for (const group of expected.sections) {
      const scores = group.articles.map((a) => rankScore(a, T));
      assert.equal(new Set(scores).size, scores.length, `${group.section}: distinct scores`);
    }

    const read = await readFrontPage(h.handle.db, T + 3 * HOUR);
    const view = (sections: typeof expected.sections) =>
      sections.map((g) => ({ section: g.section, titles: g.articles.map((a) => a.title), urls: g.articles.map((a) => a.url) }));
    assert.deepEqual(view(ready(read).result.sections), view(expected.sections));
    assert.ok(expected.sections.length >= 4, "the fixture spans several sections");
    assert.deepEqual(
      ready(read).result.articles.map((a) => [a.id, a.importance, a.importanceReason, a.cves]),
      expected.articles.map((a) => [a.id, a.importance, a.importanceReason, a.cves]),
    );
  } finally {
    await h.close();
  }
});

// ---------------------------------------------------------------------------
// (8) the declared full-tie lead rule, in any fan-out order
// ---------------------------------------------------------------------------

test("full tie (declared rule): the card is the copy with the smaller canonical URL, then the smaller source id, in either fan-out order", async () => {
  const tieA = makeSource({ id: "tie-a", name: "Tie A", family: "tie-a", sourceType: "news", tier: "Security Research" });
  const tieB = makeSource({ id: "tie-b", name: "Tie B", family: "tie-b", sourceType: "news", tier: "Security Research" });
  const at = T - 2 * HOUR;
  const feeds: Feeds = {
    "tie-a": okFeed([
      // P: titles normalize equal, different canonical URLs; tie-a holds the LARGER canonical URL.
      art(tieA, "Zeta Harbor Notes", "https://zz.test/p", at),
      // Q: one shared canonical URL, different titles.
      art(tieA, "Quill Dock Update", "https://shared.test/q", at - HOUR),
    ]),
    "tie-b": okFeed([
      art(tieB, "zeta harbor notes!", "https://aa.test/p", at),
      art(tieB, "Quill Dock Revised", "https://shared.test/q", at - HOUR),
    ]),
  };

  const views: string[] = [];
  for (const order of [[tieA, tieB], [tieB, tieA]] as const) {
    const h = await harness([tieA, tieB]);
    try {
      await h.cycle(T, feeds, order);
      const read = await readFrontPage(h.handle.db, T);
      const view = ready(read).result.articles.map((a) => ({ title: a.title, url: a.url, id: a.id, source: a.source }));
      view.sort((x, y) => (x.url < y.url ? -1 : 1));
      assert.deepEqual(view, [
        { title: "zeta harbor notes!", url: "https://aa.test/p", id: articleId("https://aa.test/p"), source: "Tie B" },
        { title: "Quill Dock Update", url: "https://shared.test/q", id: articleId("https://shared.test/q"), source: "Tie A" },
      ]);
      views.push(JSON.stringify(view));
    } finally {
      await h.close();
    }
  }
  assert.equal(views[0], views[1], "the same cards in both fan-out orders");
});

// ---------------------------------------------------------------------------
// (6) enrichment that was never checked
// ---------------------------------------------------------------------------

test("a CVE never checked reads unavailable for KEV, EPSS and SSVC", async () => {
  const h = await harness([SRC_A]);
  try {
    await h.cycle(T, {
      "src-a": okFeed([art(SRC_A, "CVE-2026-33001 flaw patched in the Cedar gateway", "https://a.test/v1", T - 2 * HOUR)]),
    });
    const { enrichment } = ready(await readFrontPage(h.handle.db, T + HOUR));
    assert.deepEqual(enrichment.byCve["CVE-2026-33001"], {
      kev: { state: "unavailable" },
      epss: { state: "unavailable" },
      ssvc: { state: "unavailable" },
    });
    assert.deepEqual(enrichment.health.kev, { status: "unavailable", fetchedAt: null });
    assert.deepEqual(enrichment.health.epss, { status: "unavailable", requested: 1, unavailable: 1 });
    assert.deepEqual(enrichment.health.ssvc, { status: "unavailable", requested: 1, unavailable: 1 });
  } finally {
    await h.close();
  }
});

// ---------------------------------------------------------------------------
// (7) one read snapshot (W2)
// ---------------------------------------------------------------------------

test("one snapshot (W2): a cycle that commits between the marker read and the story reads cannot mix two editions", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "havadis-snapshot-"));
  const h = await harness([SRC_A, SRC_B], dbFile(dir));
  let web: DbHandle | null = null;
  try {
    const old = {
      "src-a": okFeed([art(SRC_A, "Alpha ransomware wave one", "https://a.test/old", T - 3 * HOUR)]),
      "src-b": okFeed([art(SRC_B, "Bravo advisory notice one", "https://b.test/old", T - 4 * HOUR)]),
    };
    await h.cycle(T, old);
    web = openDb(dbFile(dir), "web", { readonly: true });

    const later = T + 4 * DAY;
    const fresh = {
      "src-a": okFeed([art(SRC_A, "Alpha fresh malware report", "https://a.test/new", later - HOUR)]),
      "src-b": okFeed([art(SRC_B, "Bravo fresh leak report", "https://b.test/new", later - 2 * HOUR)]),
    };
    const during = await readFrontPage(web.db, later, { betweenReads: async () => void (await h.cycle(later, fresh)) });
    assert.equal(ready(during).result.generatedAt, iso(T), "the marker and the stories are the same edition");
    assert.deepEqual(
      ready(during).result.articles.map((a) => a.url).sort(),
      ["https://a.test/old", "https://b.test/old"],
      "exactly the T edition, none of the fresh stories",
    );

    const next = await readFrontPage(web.db, later);
    assert.equal(ready(next).result.generatedAt, iso(later));
    assert.deepEqual(
      ready(next).result.articles.map((a) => a.url).sort(),
      ["https://a.test/new", "https://b.test/new"],
    );
  } finally {
    await web?.close();
    await h.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
