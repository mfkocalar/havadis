import { test } from "node:test";
import assert from "node:assert/strict";
import { CompiledQuery } from "kysely";
import type { KyselyPlugin } from "kysely";
import { openDb } from "../db/openDb.ts";
import type { DbHandle } from "../db/openDb.ts";
import { loadMigrations, runMigrations } from "../db/migrator.ts";
import { seedBuiltins } from "../db/seed.ts";
import type { FetchErrorCode } from "../reasonCodes.ts";
import type { FeedFetchResult, FeedValidators } from "../pipeline/feedResult.ts";
import { dedupeGroups, pickLead } from "../pipeline/dedupe.ts";
import { fanOutWithOutcomes } from "../pipeline/fanOut.ts";
import { readLastGood, readSourceAnchors, selectInWindowArticles, sourceAnchorsQuery } from "../store/articles.ts";
import type { StoredArticle } from "../store/articles.ts";
import { planStories } from "./derive.ts";
import type { IncomingSighting } from "./derive.ts";
import { classifyRun, runIngestCycle } from "./cycle.ts";
import { makeArticle, makeSource } from "../../../test/fixtures/makeArticle.ts";
import type { Article, SourceConfig } from "../types.ts";

const T = Date.parse("2026-11-11T08:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms: number): string => new Date(ms).toISOString();

const SRC_A = makeSource({ id: "src-a", name: "Source A", family: "fam-a", sourceType: "news", tier: "Security Research", url: "https://host-a.test/feed.xml" });
const SRC_B = makeSource({ id: "src-b", name: "Source B", family: "fam-b", sourceType: "news", tier: "Security Research", url: "https://host-b.test/feed.xml" });
const SRC_C = makeSource({ id: "src-c", name: "Source C", family: "fam-c", sourceType: "news", tier: "Security Research", url: "https://host-c.test/feed.xml" });

type Feed = FeedFetchResult | "reject";

function okFeed(articles: Article[]): FeedFetchResult {
  return { status: "ok", articles, validators: { etag: null, lastModified: null }, httpStatus: 200 };
}
function failFeed(code: FetchErrorCode = "http_error"): FeedFetchResult {
  return { status: "error", code, httpStatus: code === "http_error" ? 503 : null, retryAfterMs: null };
}
const NOT_MODIFIED: FeedFetchResult = { status: "not-modified", httpStatus: 304 };

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

/** Sources on one shared host and one on another, for the per-host back-off tests. */
const SHARED_1 = makeSource({ id: "sh-1", name: "Shared 1", family: "fam-s1", url: "https://shared.test/one.xml" });
const SHARED_2 = makeSource({ id: "sh-2", name: "Shared 2", family: "fam-s2", url: "https://shared.test/two.xml" });
const OTHER = makeSource({ id: "other", name: "Other", family: "fam-o", url: "https://other.test/feed.xml" });

type FetchCall = { id: string; validators: FeedValidators };

type Harness = {
  handle: DbHandle;
  /** Every fetchFeed call the cycles made, in order. */
  calls: FetchCall[];
  cycle: (at: number, feeds: Record<string, Feed>, order?: readonly SourceConfig[]) => ReturnType<typeof runIngestCycle>;
  rows: (sql: string) => Array<Record<string, unknown>>;
  close: () => Promise<void>;
};

async function harness(sources: readonly SourceConfig[]): Promise<Harness> {
  const handle = openDb(":memory:", "worker");
  await runMigrations(handle, { migrations: loadMigrations(), backup: async () => null, now: () => T });
  await seedBuiltins(handle.db, sources, T);
  let counter = 0;
  const newId = () => `story-${String(++counter).padStart(3, "0")}`;
  const calls: FetchCall[] = [];
  return {
    handle,
    calls,
    cycle: (at, feeds, order) =>
      runIngestCycle(
        handle.db,
        {
          sources: order ?? sources,
          newId,
          concurrency: 2,
          // Jitter pinned to its midpoint: the first back-off is exactly 15 minutes.
          random: () => 0.5,
          fetchFeed: async (source, validators) => {
            calls.push({ id: source.id, validators });
            const feed = feeds[source.id];
            if (feed === "reject") throw new Error("boom");
            return feed ?? failFeed("network_error");
          },
        },
        at,
      ),
    rows: (sql) => handle.raw.prepare(sql).all() as Array<Record<string, unknown>>,
    close: () => handle.close(),
  };
}

function snapshotTables(h: Harness): string {
  return JSON.stringify(
    ["stories", "articles", "story_cves", "cve_signals", "meta"].map((table) => h.rows(`SELECT * FROM ${table} ORDER BY 1, 2`)),
  );
}

function anchorMap(map: ReadonlyMap<string, number>): Record<string, string> {
  return Object.fromEntries([...map].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, ms]) => [id, iso(ms)]));
}

function partition(h: Harness): string[] {
  const groups = new Map<string, string[]>();
  for (const r of h.rows("SELECT story_id, source_id, canonical_url FROM articles")) {
    const list = groups.get(String(r.story_id)) ?? [];
    list.push(`${String(r.source_id)}|${String(r.canonical_url)}`);
    groups.set(String(r.story_id), list);
  }
  return [...groups.values()].map((m) => m.sort().join(" + ")).sort();
}

// ---------------------------------------------------------------------------
// classifyRun
// ---------------------------------------------------------------------------

test("classifyRun: the status table, with a 304 counting as a success", () => {
  assert.equal(classifyRun([]), "failed", "zero sources");
  assert.equal(
    classifyRun([
      { outcome: "failed", itemCount: 0 },
      { outcome: "failed", itemCount: 0 },
    ]),
    "failed",
    "every source failed",
  );
  assert.equal(
    classifyRun([
      { outcome: "ok", itemCount: 0 },
      { outcome: "ok", itemCount: 0 },
    ]),
    "failed",
    "every ok outcome has zero in-window items",
  );
  assert.equal(classifyRun([{ outcome: "not_modified", itemCount: 0 }]), "ok", "not_modified only");
  assert.equal(
    classifyRun([
      { outcome: "ok", itemCount: 3 },
      { outcome: "failed", itemCount: 0 },
    ]),
    "partial",
    "ok plus failed",
  );
  assert.equal(
    classifyRun([
      { outcome: "ok", itemCount: 3 },
      { outcome: "skipped_backoff", itemCount: 0 },
    ]),
    "partial",
    "ok plus skipped_backoff",
  );
  assert.equal(
    classifyRun([
      { outcome: "ok", itemCount: 3 },
      { outcome: "ok", itemCount: 0 },
    ]),
    "ok",
    "an empty ok source next to a productive one is still ok",
  );
});

// ---------------------------------------------------------------------------
// engine additions
// ---------------------------------------------------------------------------

test("fanOutWithOutcomes: input order, bounded concurrency, and a rejection never collapses the batch", async () => {
  const sources = ["s1", "s2", "s3", "s4", "s5"].map((id) => makeSource({ id }));
  let inFlight = 0;
  let peak = 0;
  const out = await fanOutWithOutcomes(
    sources,
    async (source) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, source.id === "s1" ? 20 : 2));
      inFlight--;
      if (source.id === "s3") throw new Error("boom");
      return `ok:${source.id}`;
    },
    { concurrency: 2, onRejected: (source) => `rejected:${source.id}` },
  );
  assert.deepEqual(
    out.map((o) => [o.source.id, o.result]),
    [
      ["s1", "ok:s1"],
      ["s2", "ok:s2"],
      ["s3", "rejected:s3"],
      ["s4", "ok:s4"],
      ["s5", "ok:s5"],
    ],
  );
  assert.ok(peak <= 2, `concurrency stayed bounded (peak ${peak})`);
  assert.ok(out.every((o) => Number.isFinite(o.durationMs) && o.durationMs >= 0));
});

test("dedupeGroups: URL OR title equality, transitively, as groups of input indices", () => {
  const a = art(SRC_A, "Widget zero-day", "https://x.test/1", T);
  const b = art(SRC_B, "Widget zero-day", "https://y.test/1", T); // title with a
  const c = art(SRC_C, "Other headline here", "https://y.test/1", T); // url with b
  const d = art(SRC_C, "Entirely separate story", "https://z.test/1", T);
  const groups = dedupeGroups([a, b, c, d]).map((g) => [...g].sort((x, y) => x - y));
  assert.deepEqual(groups.sort((x, y) => x[0]! - y[0]!), [[0, 1, 2], [3]]);
});

test("pickLead: earliest publishedAt, then tier weight, then canonical URL, then source id", () => {
  const base = { canonicalUrl: "https://m.test/1", sourceId: "m" };
  const early = { ...art(SRC_A, "t", "https://m.test/1", T - HOUR), ...base };
  const late = { ...art(SRC_A, "t", "https://m.test/2", T), ...base };
  assert.equal(pickLead([late, early]), 1, "earliest publishedAt wins");

  const gov = { ...art(SRC_A, "t", "https://m.test/1", T, { sourceTier: "Government" }), ...base };
  const tech = { ...art(SRC_A, "t", "https://m.test/1", T, { sourceTier: "Tech & General" }), ...base };
  assert.equal(pickLead([tech, gov]), 1, "tier weight breaks a publishedAt tie");

  const urlB = { ...art(SRC_A, "t", "https://b.test/1", T), canonicalUrl: "https://b.test/1", sourceId: "a" };
  const urlA = { ...art(SRC_A, "t", "https://a.test/1", T), canonicalUrl: "https://a.test/1", sourceId: "z" };
  assert.equal(pickLead([urlB, urlA]), 1, "smaller canonical URL breaks a full publishedAt and tier tie");
  assert.equal(pickLead([urlA, urlB]), 0, "and does so in either input order");

  const sameUrlHigh = { ...art(SRC_A, "t", "https://a.test/1", T), canonicalUrl: "https://a.test/1", sourceId: "src-z" };
  const sameUrlLow = { ...art(SRC_A, "t", "https://a.test/1", T), canonicalUrl: "https://a.test/1", sourceId: "src-a" };
  assert.equal(pickLead([sameUrlHigh, sameUrlLow]), 1, "smaller source id is the last tie-break");
  assert.equal(pickLead([sameUrlLow, sameUrlHigh]), 0);

  const unparseable = { ...art(SRC_A, "t", "https://u.test/1", T, { publishedAt: "not a date" }), canonicalUrl: "https://u.test/1", sourceId: "u" };
  assert.equal(pickLead([unparseable, late]), 1, "an unparseable date never wins");
});

// ---------------------------------------------------------------------------
// planStories (pure)
// ---------------------------------------------------------------------------

function stored(source: SourceConfig, title: string, url: string, storyId: string, id: number, publishedAt = T): StoredArticle {
  return { ...art(source, title, url, publishedAt), articleId: id, sourceId: source.id, storyId, canonicalUrl: url };
}
function incoming(source: SourceConfig, title: string, url: string, publishedAt = T): IncomingSighting {
  return { ...art(source, title, url, publishedAt), sourceId: source.id, canonicalUrl: url };
}

test("planStories: a sighting linking two stories keeps the oldest first_seen_at, tie smaller id, and never splits", () => {
  const s1 = stored(SRC_A, "Alpha headline", "https://a.test/1", "story-b", 1);
  const s2 = stored(SRC_B, "Beta headline", "https://b.test/1", "story-a", 2);
  const link = incoming(SRC_C, "Alpha headline", "https://b.test/1");

  const tie = planStories(
    { stored: [s1, s2], incoming: [link], storyFirstSeen: new Map([["story-a", iso(T)], ["story-b", iso(T)]]) },
    () => "never",
    T,
  );
  assert.deepEqual(tie.merges, [{ loser: "story-b", survivor: "story-a" }], "tie: smaller id survives");
  assert.deepEqual(tie.newStories, []);
  assert.deepEqual(tie.assignments.map((a) => a.storyId), ["story-a"]);

  const older = planStories(
    { stored: [s1, s2], incoming: [link], storyFirstSeen: new Map([["story-a", iso(T)], ["story-b", iso(T - DAY)]]) },
    () => "never",
    T,
  );
  assert.deepEqual(older.merges, [{ loser: "story-a", survivor: "story-b" }], "older first_seen_at survives");

  // One story whose two stored members are no longer linked inside the window stays one story.
  const x1 = stored(SRC_A, "First member", "https://a.test/10", "story-x", 3);
  const x2 = stored(SRC_B, "Second member", "https://b.test/10", "story-x", 4);
  const y1 = stored(SRC_C, "First member", "https://c.test/10", "story-y", 5);
  const kept = planStories(
    { stored: [x1, x2, y1], incoming: [], storyFirstSeen: new Map([["story-x", iso(T - DAY)], ["story-y", iso(T)]]) },
    () => "never",
    T,
  );
  assert.deepEqual(kept.merges, [{ loser: "story-y", survivor: "story-x" }]);
  assert.equal(kept.derived.length, 1, "x1 and x2 stay together even though only x1 is linked to y1");
});

test("planStories: the same sightings in any order give the same partition and the same lead", () => {
  const a1 = incoming(SRC_A, "Zero-day in Widget", "https://a.test/1");
  const b1 = incoming(SRC_B, "Zero-day in Widget", "https://b.test/1"); // full tie with a1
  const a2 = incoming(SRC_A, "Unrelated alpha", "https://a.test/2");
  const b2 = incoming(SRC_B, "Bridge item", "https://a.test/2"); // joins a2 by URL
  const c1 = incoming(SRC_C, "Bridge item", "https://c.test/1"); // joins b2 by title
  const lone = incoming(SRC_C, "Standalone story", "https://c.test/2");
  const all = [a1, b1, a2, b2, c1, lone];

  const shape = (list: IncomingSighting[]) => {
    let n = 0;
    const plan = planStories({ stored: [], incoming: list, storyFirstSeen: new Map() }, () => `new-${++n}`, T);
    const storyOf = new Map(plan.assignments.map((a) => [`${a.sourceId}|${a.canonicalUrl}`, a.storyId]));
    const members = new Map<string, string[]>();
    for (const [key, story] of storyOf) members.set(story, [...(members.get(story) ?? []), key].sort());
    const leads = new Map(plan.derived.map((d) => [d.storyId, `${d.lead.sourceId}|${d.lead.canonicalUrl}`]));
    return [...members].map(([story, m]) => `${m.join(" + ")} => ${leads.get(story)}`).sort();
  };

  const baseline = shape(all);
  assert.equal(baseline.length, 3, "three stories");
  assert.ok(baseline.includes("src-a|https://a.test/1 + src-b|https://b.test/1 => src-a|https://a.test/1"), "full tie: smaller canonical URL leads");
  assert.deepEqual(shape([...all].reverse()), baseline);
  assert.deepEqual(shape([all[3]!, all[5]!, all[0]!, all[2]!, all[4]!, all[1]!]), baseline);
});

// ---------------------------------------------------------------------------
// cycles
// ---------------------------------------------------------------------------

test("sticky identity: an article seen in two cycles keeps one row, one story id and its first_seen_at", async () => {
  const h = await harness([SRC_A, SRC_B]);
  try {
    const a1 = art(SRC_A, "Widget flaw disclosed", "https://a.test/widget", T - HOUR);
    const first = await h.cycle(T, { "src-a": okFeed([a1]), "src-b": okFeed([]) });
    assert.equal(first.status, "ok");
    assert.equal(first.articlesNew, 1);
    assert.equal(first.storiesCreated, 1);
    const before = h.rows("SELECT story_id, first_seen_at, last_seen_at FROM articles");
    assert.equal(before.length, 1);

    const a2 = art(SRC_A, "Gadget breach reported", "https://a.test/gadget", T + HOUR - 30 * 60_000);
    const second = await h.cycle(T + HOUR, { "src-a": okFeed([a1, a2]), "src-b": okFeed([]) });
    assert.equal(second.articlesNew, 1);
    assert.equal(second.articlesSeen, 2);
    const after = h.rows("SELECT story_id, first_seen_at, last_seen_at FROM articles ORDER BY id");
    assert.equal(after.length, 2);
    assert.equal(after[0]!.story_id, before[0]!.story_id, "the story UUID never changes");
    assert.equal(after[0]!.first_seen_at, before[0]!.first_seen_at, "first_seen_at is kept");
    assert.equal(after[0]!.last_seen_at, iso(T + HOUR), "last_seen_at moves to the new cycle");
    assert.equal(h.rows("SELECT id FROM stories").length, 2);
  } finally {
    await h.close();
  }
});

test("PLAT-07/adjacency: same canonical URL from the same source updates one row; from another source it adds a row on the same story", async () => {
  const h = await harness([SRC_A, SRC_B]);
  try {
    const url = "https://shared.test/story?utm_source=rss";
    // +01:00 offsets must be normalized to Date.prototype.toISOString form.
    const a = art(SRC_A, "Shared story headline", url, T, { publishedAt: "2026-11-11T08:00:00+01:00" });
    await h.cycle(T, { "src-a": okFeed([a]), "src-b": okFeed([]) });
    await h.cycle(T + HOUR, { "src-a": okFeed([{ ...a, url: "https://shared.test/story" }]), "src-b": okFeed([]) });
    let rows = h.rows("SELECT source_id, story_id, published_at, first_seen_at, last_seen_at FROM articles");
    assert.equal(rows.length, 1, "one row for one (source, canonical url)");
    assert.equal(rows[0]!.published_at, "2026-11-11T07:00:00.000Z");
    assert.equal(rows[0]!.first_seen_at, iso(T));
    assert.equal(rows[0]!.last_seen_at, iso(T + HOUR));

    const b = art(SRC_B, "Shared story headline, syndicated", "https://shared.test/story", T);
    await h.cycle(T + 2 * HOUR, { "src-a": okFeed([a]), "src-b": okFeed([b]) });
    rows = h.rows("SELECT source_id, story_id FROM articles ORDER BY source_id");
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.story_id, rows[1]!.story_id, "the second source joins the same story");
    assert.equal(h.rows("SELECT id FROM stories").length, 1);
  } finally {
    await h.close();
  }
});

test("PLAT-07/empty: a cycle with zero new sightings inserts no story and re-points no article", async () => {
  const h = await harness([SRC_A, SRC_B]);
  try {
    const feeds = {
      "src-a": okFeed([art(SRC_A, "Alpha ransomware campaign", "https://a.test/1", T - HOUR)]),
      "src-b": okFeed([art(SRC_B, "Beta supply chain attack", "https://b.test/1", T - HOUR)]),
    };
    await h.cycle(T, feeds);
    const storiesBefore = JSON.stringify(h.rows("SELECT * FROM stories ORDER BY id"));
    const linksBefore = JSON.stringify(h.rows("SELECT id, story_id FROM articles ORDER BY id"));
    const again = await h.cycle(T + HOUR, feeds);
    assert.equal(again.status, "ok");
    assert.equal(again.articlesNew, 0);
    assert.equal(again.storiesCreated, 0);
    assert.equal(again.storiesMerged, 0);
    assert.equal(JSON.stringify(h.rows("SELECT * FROM stories ORDER BY id")), storiesBefore, "no story row changed");
    assert.equal(JSON.stringify(h.rows("SELECT id, story_id FROM articles ORDER BY id")), linksBefore);
  } finally {
    await h.close();
  }
});

test("merge: a sighting that links two stored stories keeps the older, marks the other merged_into, and deletes no story", async () => {
  const h = await harness([SRC_A, SRC_B, SRC_C]);
  try {
    const x = art(SRC_A, "Alpha headline for merging", "https://a.test/x", T - HOUR);
    const y = art(SRC_B, "Beta headline for merging", "https://b.test/y", T);
    await h.cycle(T, { "src-a": okFeed([x]), "src-b": okFeed([]), "src-c": okFeed([]) });
    await h.cycle(T + HOUR, { "src-a": okFeed([x]), "src-b": okFeed([y]), "src-c": okFeed([]) });
    const stories = h.rows("SELECT id, first_seen_at FROM stories ORDER BY first_seen_at");
    assert.equal(stories.length, 2);
    const [older, newer] = [String(stories[0]!.id), String(stories[1]!.id)];

    // Source C's article has Y's URL and X's title, so it links both stories.
    const z = art(SRC_C, "Alpha headline for merging", "https://b.test/y", T + 2 * HOUR - 10 * 60_000);
    const merged = await h.cycle(T + 2 * HOUR, { "src-a": okFeed([x]), "src-b": okFeed([y]), "src-c": okFeed([z]) });
    assert.equal(merged.storiesMerged, 1);
    assert.equal(merged.storiesCreated, 0);

    const after = h.rows("SELECT id, merged_into FROM stories ORDER BY first_seen_at");
    assert.equal(after.length, 2, "no story row is ever deleted");
    assert.equal(after[0]!.merged_into, null);
    assert.equal(after[1]!.merged_into, older);
    assert.equal(String(after[1]!.id), newer);
    const owners = new Set(h.rows("SELECT story_id FROM articles").map((r) => r.story_id));
    assert.deepEqual([...owners], [older], "every article now belongs to the survivor");
  } finally {
    await h.close();
  }
});

test("PLAT-07/ordering: any source and article order produces the same story partition", async () => {
  const a1 = art(SRC_A, "Zero-day in Widget", "https://a.test/1", T - 2 * HOUR);
  const b1 = art(SRC_B, "Zero-day in Widget", "https://b.test/1", T - 2 * HOUR);
  const a2 = art(SRC_A, "Unrelated alpha", "https://a.test/2", T - HOUR);
  const b2 = art(SRC_B, "Bridge item", "https://a.test/2", T - HOUR);
  const c1 = art(SRC_C, "Bridge item", "https://c.test/1", T - HOUR);
  const lone = art(SRC_C, "Standalone story", "https://c.test/2", T - HOUR);

  const runs: Array<{ order: SourceConfig[]; feeds: Record<string, Feed> }> = [
    { order: [SRC_A, SRC_B, SRC_C], feeds: { "src-a": okFeed([a1, a2]), "src-b": okFeed([b1, b2]), "src-c": okFeed([c1, lone]) } },
    { order: [SRC_C, SRC_B, SRC_A], feeds: { "src-a": okFeed([a2, a1]), "src-b": okFeed([b2, b1]), "src-c": okFeed([lone, c1]) } },
    { order: [SRC_B, SRC_C, SRC_A], feeds: { "src-a": okFeed([a2, a1]), "src-b": okFeed([b1, b2]), "src-c": okFeed([c1, lone]) } },
  ];
  const partitions: string[][] = [];
  for (const run of runs) {
    const h = await harness([SRC_A, SRC_B, SRC_C]);
    try {
      await h.cycle(T, run.feeds, run.order);
      partitions.push(partition(h));
    } finally {
      await h.close();
    }
  }
  assert.equal(partitions[0]!.length, 3);
  assert.deepEqual(partitions[1], partitions[0]);
  assert.deepEqual(partitions[2], partitions[0]);
});

test("PLAT-06/empty: zero sources, all failed, or no in-window items is recorded failed and never advances last_good_run_id", async () => {
  const h = await harness([SRC_A, SRC_B]);
  try {
    assert.equal(await readLastGood(h.handle.db), null, "null on a fresh database");

    const noSources = await runIngestCycle(
      h.handle.db,
      { sources: [], fetchFeed: async () => okFeed([]), newId: () => "never" },
      T,
    );
    assert.equal(noSources.status, "failed");

    const allFailed = await h.cycle(T + HOUR, { "src-a": failFeed("timeout"), "src-b": "reject" });
    assert.equal(allFailed.status, "failed");

    const stale = art(SRC_A, "Ancient history", "https://a.test/old", T - 10 * DAY);
    const empty = await h.cycle(T + 2 * HOUR, { "src-a": okFeed([stale]), "src-b": okFeed([]) });
    assert.equal(empty.status, "failed");

    assert.equal(await readLastGood(h.handle.db), null, "failed-only cycles leave the marker null");
    assert.equal(h.rows("SELECT * FROM meta WHERE key IN ('last_good_run_id','edition_generated_at')").length, 0);
    assert.equal(h.rows("SELECT id FROM articles").length, 0, "an out-of-window sighting is not stored");
    assert.equal(h.rows("SELECT id FROM fetch_runs WHERE status = 'failed'").length, 3);
  } finally {
    await h.close();
  }
});

test("failed after good: failed and empty cycles change no story, article, cve, meta row or anchor", async () => {
  const h = await harness([SRC_A, SRC_B]);
  try {
    const a1 = art(SRC_A, "CVE-2026-1234 exploited in widgets", "https://a.test/cve", T - HOUR);
    const b1 = art(SRC_B, "Ransomware gang hits a hospital", "https://b.test/hospital", T - HOUR);
    const good = await h.cycle(T, { "src-a": okFeed([a1]), "src-b": okFeed([b1]) });
    assert.equal(good.status, "ok");
    assert.equal(h.rows("SELECT * FROM story_cves").length, 1);
    assert.equal(h.rows("SELECT * FROM cve_signals").length, 1);

    const before = snapshotTables(h);
    const anchorsBefore = anchorMap(await readSourceAnchors(h.handle.db));
    assert.deepEqual(anchorsBefore, { "src-a": iso(T), "src-b": iso(T) });

    const oneDay = await h.cycle(T + DAY, { "src-a": failFeed("timeout"), "src-b": failFeed("http_error") });
    assert.equal(oneDay.status, "failed");
    // Every source ok with zero in-window items: an empty cycle.
    const fourDays = await h.cycle(T + 4 * DAY, { "src-a": okFeed([]), "src-b": okFeed([]) });
    assert.equal(fourDays.status, "failed");

    assert.equal(snapshotTables(h), before, "stories, articles, story_cves, cve_signals and meta are identical");
    assert.deepEqual(anchorMap(await readSourceAnchors(h.handle.db)), anchorsBefore, "no anchor moved");

    const runs = h.rows("SELECT id, status FROM fetch_runs ORDER BY id");
    assert.deepEqual(runs.map((r) => r.status), ["ok", "failed", "failed"]);
    const failedFetches = h.rows(
      `SELECT run_id, source_id, outcome, reason_code FROM source_fetches WHERE run_id = ${String(runs[1]!.id)} ORDER BY source_id`,
    );
    assert.deepEqual(
      failedFetches.map((r) => [r.source_id, r.outcome, r.reason_code]),
      [["src-a", "failed", "timeout"], ["src-b", "failed", "http_error"]],
    );
    const emptyFetches = h.rows(`SELECT source_id, outcome, reason_code FROM source_fetches WHERE run_id = ${String(runs[2]!.id)} ORDER BY source_id`);
    assert.deepEqual(
      emptyFetches.map((r) => [r.source_id, r.outcome, r.reason_code]),
      [["src-a", "ok", null], ["src-b", "ok", null]],
    );
  } finally {
    await h.close();
  }
});

test("readLastGood: the newest ok or partial cycle, edition time equal to its now and fetch_runs.started_at", async () => {
  const h = await harness([SRC_A, SRC_B]);
  try {
    assert.equal(await readLastGood(h.handle.db), null);
    await h.cycle(T - HOUR, { "src-a": failFeed(), "src-b": failFeed() });
    assert.equal(await readLastGood(h.handle.db), null, "null after a failed-only cycle");

    const good = await h.cycle(T, {
      "src-a": okFeed([art(SRC_A, "Alpha ransomware campaign", "https://a.test/1", T - HOUR)]),
      "src-b": okFeed([art(SRC_B, "Beta supply chain attack", "https://b.test/1", T - HOUR)]),
    });
    const lastGood = await readLastGood(h.handle.db);
    assert.deepEqual(lastGood, { runId: good.runId, editionAt: T });
    const run = h.rows(`SELECT started_at FROM fetch_runs WHERE id = ${good.runId}`);
    assert.equal(run[0]!.started_at, iso(T));

    await h.cycle(T + HOUR, { "src-a": failFeed(), "src-b": failFeed() });
    assert.deepEqual(await readLastGood(h.handle.db), lastGood, "a later failed cycle does not move it");
  } finally {
    await h.close();
  }
});

test("per-source last-good (W3): a partial cycle keeps the failed source's stories windowed at its own last success", async () => {
  const h = await harness([SRC_A, SRC_B]);
  try {
    const a1 = art(SRC_A, "Alpha ransomware campaign", "https://a.test/1", T - HOUR);
    const b1 = art(SRC_B, "Beta supply chain attack", "https://b.test/1", T - 2 * HOUR);
    const first = await h.cycle(T, { "src-a": okFeed([a1]), "src-b": okFeed([b1]) });
    assert.equal(first.status, "ok");

    const later = T + 4 * DAY;
    const a2 = art(SRC_A, "Gamma breach disclosure", "https://a.test/2", later - HOUR);
    const partial = await h.cycle(later, { "src-a": okFeed([a2]), "src-b": failFeed("network_error") });
    assert.equal(partial.status, "partial");

    const lastGood = await readLastGood(h.handle.db);
    assert.equal(lastGood?.editionAt, later);

    const anchors = await readSourceAnchors(h.handle.db);
    assert.deepEqual(anchorMap(anchors), { "src-a": iso(later), "src-b": iso(T) });

    const visible = await selectInWindowArticles(h.handle.db, anchors);
    assert.deepEqual(
      visible.map((a) => a.url).sort(),
      ["https://a.test/2", "https://b.test/1"],
      "B's T-sightings stay, A's new sighting shows, A's T-sighting is out",
    );

    const another = await h.cycle(T + 5 * DAY, { "src-a": failFeed(), "src-b": failFeed() });
    assert.equal(another.status, "failed");
    assert.deepEqual(anchorMap(await readSourceAnchors(h.handle.db)), anchorMap(anchors));
    assert.deepEqual(
      (await selectInWindowArticles(h.handle.db, await readSourceAnchors(h.handle.db))).map((a) => a.url).sort(),
      ["https://a.test/2", "https://b.test/1"],
    );
  } finally {
    await h.close();
  }
});

test("anchor rules: a 304 moves its own anchor; failed, skipped_backoff and an ok inside a failed run never do; a never-successful source is absent", async () => {
  const SRC_D = makeSource({ id: "src-d", name: "Source D", family: "fam-d", sourceType: "news", tier: "Security Research" });
  const h = await harness([SRC_A, SRC_B, SRC_C, SRC_D]);
  try {
    const items = (source: SourceConfig, slug: string) => okFeed([art(source, `Headline about ${slug}`, `https://${slug}.test/1`, T - HOUR)]);
    await h.cycle(T, { "src-a": items(SRC_A, "alpha"), "src-b": items(SRC_B, "bravo"), "src-c": items(SRC_C, "charlie"), "src-d": failFeed() });
    assert.deepEqual(anchorMap(await readSourceAnchors(h.handle.db)), { "src-a": iso(T), "src-b": iso(T), "src-c": iso(T) });

    const partial = await h.cycle(T + HOUR, { "src-a": NOT_MODIFIED, "src-b": failFeed(), "src-c": items(SRC_C, "charlie2"), "src-d": failFeed() });
    assert.equal(partial.status, "partial");
    assert.deepEqual(anchorMap(await readSourceAnchors(h.handle.db)), { "src-a": iso(T + HOUR), "src-b": iso(T), "src-c": iso(T + HOUR) });

    // A failed run with an ok outcome inside it moves nothing.
    const failed = await h.cycle(T + 2 * HOUR, { "src-a": okFeed([]), "src-b": failFeed(), "src-c": failFeed(), "src-d": failFeed() });
    assert.equal(failed.status, "failed");
    // A skipped_backoff outcome inside a partial run moves nothing.
    const run = await h.handle.db
      .insertInto("fetch_runs")
      .values({ started_at: iso(T + 3 * HOUR), status: "partial", trigger: "scheduled" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await h.handle.db.insertInto("source_fetches").values({ run_id: run.id, source_id: "src-b", outcome: "skipped_backoff" }).execute();
    assert.deepEqual(anchorMap(await readSourceAnchors(h.handle.db)), { "src-a": iso(T + HOUR), "src-b": iso(T), "src-c": iso(T + HOUR) });

    const anchors = await readSourceAnchors(h.handle.db);
    assert.ok(!anchors.has("src-d"));
    const visible = await selectInWindowArticles(h.handle.db, anchors);
    assert.ok(visible.every((a) => a.source !== "Source D"), "a source with no successful fetch contributes nothing");
  } finally {
    await h.close();
  }
});

test("bounded anchor lookup (B): 300 failed runs cost one statement and the plan searches source_fetches_success", async () => {
  const h = await harness([SRC_A, SRC_B]);
  try {
    const items = (source: SourceConfig, slug: string) => okFeed([art(source, `Headline about ${slug}`, `https://${slug}.test/1`, T - HOUR)]);
    await h.cycle(T, { "src-a": items(SRC_A, "alpha"), "src-b": items(SRC_B, "bravo") });

    for (let i = 1; i <= 300; i++) {
      const run = await h.handle.db
        .insertInto("fetch_runs")
        .values({ started_at: iso(T + i * 60_000), status: "failed", trigger: "scheduled" })
        .returning("id")
        .executeTakeFirstOrThrow();
      await h.handle.db
        .insertInto("source_fetches")
        .values({ run_id: run.id, source_id: "src-b", outcome: "failed", reason_code: "network_error" })
        .execute();
    }

    let statements = 0;
    const counter: KyselyPlugin = {
      transformQuery: (args) => {
        statements++;
        return args.node;
      },
      transformResult: async (args) => args.result,
    };
    const anchors = await readSourceAnchors(h.handle.db.withPlugin(counter));
    assert.equal(statements, 1, "exactly one statement");
    assert.deepEqual(anchorMap(anchors), { "src-a": iso(T), "src-b": iso(T) });

    const compiled = sourceAnchorsQuery(h.handle.db).compile();
    const plan = await h.handle.db.executeQuery<{ detail: string }>(
      CompiledQuery.raw(`EXPLAIN QUERY PLAN ${compiled.sql}`, [...compiled.parameters]),
    );
    const details = plan.rows.map((r) => r.detail);
    assert.ok(details.some((d) => d.includes("source_fetches_success")), `plan names the partial index: ${details.join(" | ")}`);
    assert.ok(!details.some((d) => /\bSCAN (sf|source_fetches)\b/.test(d)), `no scan of source_fetches: ${details.join(" | ")}`);
  } finally {
    await h.close();
  }
});

test("derive uses the same windows: a fresh A item joins B's story from B's per-source window", async () => {
  const h = await harness([SRC_A, SRC_B]);
  try {
    const b1 = art(SRC_B, "Shared zero-day in Widget", "https://b.test/zd", T - HOUR);
    await h.cycle(T, { "src-a": okFeed([art(SRC_A, "Quiet alpha item", "https://a.test/q", T - HOUR)]), "src-b": okFeed([b1]) });
    const bStory = h.rows("SELECT story_id FROM articles WHERE source_id = 'src-b'")[0]!.story_id;
    const storiesBefore = h.rows("SELECT id FROM stories").length;

    const later = T + 4 * DAY;
    const a2 = art(SRC_A, "Shared zero-day in Widget", "https://a.test/zd", later - HOUR);
    const partial = await h.cycle(later, { "src-a": okFeed([a2]), "src-b": failFeed() });
    assert.equal(partial.status, "partial");
    assert.equal(partial.storiesCreated, 0);
    assert.equal(h.rows("SELECT id FROM stories").length, storiesBefore);
    assert.equal(h.rows("SELECT story_id FROM articles WHERE canonical_url = 'a.test/zd'")[0]!.story_id, bStory);
  } finally {
    await h.close();
  }
});

test("a rejecting fetcher records that source failed with network_error and still stores the others", async () => {
  const h = await harness([SRC_A, SRC_B]);
  try {
    const report = await h.cycle(T, {
      "src-a": okFeed([art(SRC_A, "Alpha ransomware campaign", "https://a.test/1", T - HOUR)]),
      "src-b": "reject",
    });
    assert.equal(report.status, "partial");
    assert.deepEqual(
      report.outcomes.map((o) => [o.sourceId, o.outcome, o.code]),
      [["src-a", "ok", null], ["src-b", "failed", "network_error"]],
    );
    assert.equal(h.rows("SELECT id FROM articles WHERE source_id = 'src-a'").length, 1);
    const stored = h.rows("SELECT outcome, reason_code FROM source_fetches WHERE source_id = 'src-b'");
    assert.deepEqual(stored, [{ outcome: "failed", reason_code: "network_error" }]);
  } finally {
    await h.close();
  }
});

test("validators are stored for ok outcomes only", async () => {
  const h = await harness([SRC_A, SRC_B]);
  try {
    const withValidators: FeedFetchResult = {
      status: "ok",
      articles: [art(SRC_A, "Alpha ransomware campaign", "https://a.test/1", T - HOUR)],
      validators: { etag: '"abc"', lastModified: "Wed, 11 Nov 2026 07:00:00 GMT" },
      httpStatus: 200,
    };
    await h.cycle(T, { "src-a": withValidators, "src-b": failFeed() });
    const rows = h.rows("SELECT id, etag, last_modified FROM sources WHERE id IN ('src-a','src-b') ORDER BY id");
    assert.deepEqual(rows, [
      { id: "src-a", etag: '"abc"', last_modified: "Wed, 11 Nov 2026 07:00:00 GMT" },
      { id: "src-b", etag: null, last_modified: null },
    ]);
  } finally {
    await h.close();
  }
});

// ---------------------------------------------------------------------------
// Per-host back-off, conditional validators and 304 (SAFE-03, PLAT-09)
// ---------------------------------------------------------------------------

const MIN = 60_000;
const items = (source: SourceConfig, slug: string) => okFeed([art(source, `Headline about ${slug}`, `https://${slug}.test/1`, T - HOUR)]);
const backoffRows = (h: Harness) => h.rows("SELECT host, failures, next_attempt_at, last_outcome FROM host_backoff ORDER BY host");

test("a failing source writes a host_backoff row, also when the whole cycle is failed, and the delay doubles", async () => {
  const h = await harness([SHARED_1, OTHER]);
  try {
    const report = await h.cycle(T, { "sh-1": failFeed("http_error"), other: failFeed("timeout") });
    assert.equal(report.status, "failed");
    assert.deepEqual(backoffRows(h), [
      { host: "other.test", failures: 1, next_attempt_at: iso(T + 15 * MIN), last_outcome: "timeout" },
      { host: "shared.test", failures: 1, next_attempt_at: iso(T + 15 * MIN), last_outcome: "http_error" },
    ]);

    await h.cycle(T + 20 * MIN, { "sh-1": failFeed("http_error"), other: items(OTHER, "other") });
    assert.deepEqual(backoffRows(h), [
      { host: "shared.test", failures: 2, next_attempt_at: iso(T + 50 * MIN), last_outcome: "http_error" },
    ]);
  } finally {
    await h.close();
  }
});

test("a host inside its back-off is skipped with no request, and fetched again after next_attempt_at; a success deletes the row", async () => {
  const h = await harness([SHARED_1, SHARED_2, OTHER]);
  try {
    await h.cycle(T, { "sh-1": failFeed(), "sh-2": failFeed("timeout"), other: items(OTHER, "other") });
    assert.equal(backoffRows(h).length, 1);

    const before = h.calls.length;
    const skipped = await h.cycle(T + 5 * MIN, { "sh-1": items(SHARED_1, "one"), "sh-2": items(SHARED_2, "two"), other: items(OTHER, "other2") });
    assert.deepEqual(h.calls.slice(before).map((c) => c.id), ["other"], "no request is sent to the backed-off host");
    assert.deepEqual(
      skipped.outcomes.map((o) => [o.sourceId, o.outcome, o.code]),
      [["sh-1", "skipped_backoff", null], ["sh-2", "skipped_backoff", null], ["other", "ok", null]],
    );
    assert.equal(skipped.status, "partial");
    assert.deepEqual(backoffRows(h), [{ host: "shared.test", failures: 1, next_attempt_at: iso(T + 15 * MIN), last_outcome: "http_error" }], "a skip changes nothing");

    const mark = h.calls.length;
    await h.cycle(T + 16 * MIN, { "sh-1": items(SHARED_1, "one"), "sh-2": items(SHARED_2, "two"), other: items(OTHER, "other3") });
    assert.deepEqual(h.calls.slice(mark).map((c) => c.id).sort(), ["other", "sh-1", "sh-2"]);
    assert.deepEqual(backoffRows(h), [], "a success clears the host");
  } finally {
    await h.close();
  }
});

test("a cycle in which every source is skipped is recorded failed and leaves the back-off row alone", async () => {
  const h = await harness([SHARED_1]);
  try {
    await h.cycle(T, { "sh-1": failFeed() });
    const report = await h.cycle(T + 5 * MIN, { "sh-1": items(SHARED_1, "one") });
    assert.equal(report.status, "failed");
    assert.deepEqual(report.outcomes.map((o) => o.outcome), ["skipped_backoff"]);
    assert.deepEqual(h.rows("SELECT outcome, reason_code FROM source_fetches ORDER BY run_id DESC LIMIT 1"), [{ outcome: "skipped_backoff", reason_code: null }]);
    assert.equal(backoffRows(h)[0]!.failures, 1);
  } finally {
    await h.close();
  }
});

test("Retry-After longer than the computed delay sets next_attempt_at", async () => {
  const h = await harness([SHARED_1]);
  try {
    await h.cycle(T, { "sh-1": { status: "error", code: "http_error", httpStatus: 429, retryAfterMs: 2 * HOUR } });
    assert.equal(backoffRows(h)[0]!.next_attempt_at, iso(T + 2 * HOUR));
  } finally {
    await h.close();
  }
});

test("an egress-denied source is recorded failed with its code but creates no back-off row", async () => {
  const h = await harness([SHARED_1, OTHER]);
  try {
    const report = await h.cycle(T, { "sh-1": failFeed("egress_denied_private"), other: items(OTHER, "other") });
    assert.deepEqual(report.outcomes.map((o) => [o.sourceId, o.outcome, o.code]), [["sh-1", "failed", "egress_denied_private"], ["other", "ok", null]]);
    assert.deepEqual(backoffRows(h), []);
  } finally {
    await h.close();
  }
});

test("a source failing next to a healthy one on the same host does not back the host off", async () => {
  const h = await harness([SHARED_1, SHARED_2]);
  try {
    await h.cycle(T, { "sh-1": failFeed("http_error"), "sh-2": items(SHARED_2, "two") });
    assert.deepEqual(backoffRows(h), []);
  } finally {
    await h.close();
  }
});

test("validators from an ok result are stored and passed to the next fetchFeed call", async () => {
  const h = await harness([SRC_A]);
  try {
    const validators = { etag: 'W/"v1"', lastModified: "Wed, 11 Nov 2026 07:00:00 GMT" };
    await h.cycle(T, { "src-a": { status: "ok", articles: [art(SRC_A, "Alpha ransomware campaign", "https://a.test/1", T - HOUR)], validators, httpStatus: 200 } });
    await h.cycle(T + HOUR, { "src-a": NOT_MODIFIED });
    assert.deepEqual(h.calls.map((c) => c.validators), [{ etag: null, lastModified: null }, validators]);
  } finally {
    await h.close();
  }
});

test("a not_modified source adds no article, updates none and counts as a success", async () => {
  const h = await harness([SRC_A, SRC_B]);
  try {
    await h.cycle(T, { "src-a": items(SRC_A, "alpha"), "src-b": items(SRC_B, "bravo") });
    const rowsOf = () => JSON.stringify(["stories", "articles", "story_cves"].map((table) => h.rows(`SELECT * FROM ${table} ORDER BY 1, 2`)));
    const before = rowsOf();
    const report = await h.cycle(T + HOUR, { "src-a": NOT_MODIFIED, "src-b": NOT_MODIFIED });
    assert.equal(report.status, "ok");
    assert.equal(report.sourcesOk, 2);
    assert.equal(report.articlesNew, 0);
    assert.equal(rowsOf(), before);
    assert.deepEqual(h.rows("SELECT outcome FROM source_fetches WHERE run_id = " + report.runId + " ORDER BY source_id"), [{ outcome: "not_modified" }, { outcome: "not_modified" }]);
  } finally {
    await h.close();
  }
});

test("failed after good with back-off rows being written: stories, articles, cves and meta stay identical", async () => {
  const h = await harness([SRC_A, SRC_B]);
  try {
    await h.cycle(T, { "src-a": items(SRC_A, "alpha"), "src-b": items(SRC_B, "bravo") });
    const before = snapshotTables(h);
    const failed = await h.cycle(T + DAY, { "src-a": failFeed("timeout"), "src-b": failFeed("http_error") });
    assert.equal(failed.status, "failed");
    assert.equal(snapshotTables(h), before);
    assert.deepEqual(backoffRows(h).map((r) => r.host), ["host-a.test", "host-b.test"]);
  } finally {
    await h.close();
  }
});

// ---------------------------------------------------------------------------
// onStage: the runner's lease-renewal hook (Plan 13)
// ---------------------------------------------------------------------------

type StageCall = { stage: string; runId: number; articles: number; runStatus: string };

/** Runs one cycle with an onStage recorder that snapshots what the database holds at each stage. */
async function stagedCycle(
  h: Harness,
  sources: readonly SourceConfig[],
  feeds: Record<string, FeedFetchResult>,
  onStage: (stage: "started" | "fetched" | "written", runId: number) => Promise<void>,
) {
  return runIngestCycle(
    h.handle.db,
    {
      sources,
      concurrency: 2,
      random: () => 0.5,
      fetchFeed: async (source, validators) => {
        h.calls.push({ id: source.id, validators });
        return feeds[source.id] ?? failFeed("network_error");
      },
      onStage,
    },
    T,
  );
}

test("onStage: started, fetched and written run in order, and fetched is before the write transaction", async () => {
  const h = await harness([SRC_A, SRC_B]);
  try {
    const calls: StageCall[] = [];
    const report = await stagedCycle(h, [SRC_A, SRC_B], { "src-a": items(SRC_A, "alpha"), "src-b": items(SRC_B, "bravo") }, async (stage, runId) => {
      calls.push({
        stage,
        runId,
        articles: Number((h.rows("SELECT count(*) AS n FROM articles")[0] as { n: number }).n),
        runStatus: String((h.rows(`SELECT status FROM fetch_runs WHERE id = ${runId}`)[0] as { status: string }).status),
      });
    });
    assert.deepEqual(
      calls.map((c) => [c.stage, c.runId, c.articles, c.runStatus]),
      [
        ["started", report.runId, 0, "running"],
        ["fetched", report.runId, 0, "running"],
        ["written", report.runId, 2, "ok"],
      ],
    );
  } finally {
    await h.close();
  }
});

test("onStage: a failed cycle awaits fetched before recording and written after it", async () => {
  const h = await harness([SRC_A]);
  try {
    const calls: Array<[string, string]> = [];
    const report = await stagedCycle(h, [SRC_A], { "src-a": failFeed("timeout") }, async (stage, runId) => {
      calls.push([stage, String((h.rows(`SELECT status FROM fetch_runs WHERE id = ${runId}`)[0] as { status: string }).status)]);
    });
    assert.equal(report.status, "failed");
    assert.deepEqual(calls, [
      ["started", "running"],
      ["fetched", "running"],
      ["written", "failed"],
    ]);
  } finally {
    await h.close();
  }
});

test("onStage: an exception at fetched marks the run failed, writes no story or source row, and rethrows", async () => {
  const h = await harness([SRC_A, SRC_B]);
  try {
    await assert.rejects(
      stagedCycle(h, [SRC_A, SRC_B], { "src-a": items(SRC_A, "alpha"), "src-b": items(SRC_B, "bravo") }, async (stage) => {
        if (stage === "fetched") throw new Error("lease lost");
      }),
      /lease lost/,
    );
    assert.deepEqual(h.rows("SELECT status FROM fetch_runs"), [{ status: "failed" }]);
    assert.deepEqual(h.rows("SELECT count(*) AS n FROM articles"), [{ n: 0 }]);
    assert.deepEqual(h.rows("SELECT count(*) AS n FROM source_fetches"), [{ n: 0 }]);
    assert.deepEqual(h.rows("SELECT count(*) AS n FROM meta WHERE key = 'last_good_run_id'"), [{ n: 0 }]);
  } finally {
    await h.close();
  }
});

test("onStage: an exception at started marks the run failed and rethrows before any fetch", async () => {
  const h = await harness([SRC_A]);
  try {
    await assert.rejects(
      stagedCycle(h, [SRC_A], { "src-a": items(SRC_A, "alpha") }, async (stage) => {
        if (stage === "started") throw new Error("lease lost");
      }),
      /lease lost/,
    );
    assert.deepEqual(h.rows("SELECT status FROM fetch_runs"), [{ status: "failed" }]);
    assert.deepEqual(h.calls, [], "no fetch happened");
  } finally {
    await h.close();
  }
});

test("onStage: an exception on the exception path never overwrites a run that is no longer running", async () => {
  const h = await harness([SRC_A]);
  try {
    // Another actor (a stopping worker) closes the run while the cycle is mid-flight; the failure path must keep that status.
    await assert.rejects(
      stagedCycle(h, [SRC_A], { "src-a": items(SRC_A, "alpha") }, async (stage, runId) => {
        if (stage === "fetched") {
          h.handle.raw.prepare("UPDATE fetch_runs SET status = 'abandoned', finished_at = ? WHERE id = ?").run(iso(T + 1), runId);
          throw new Error("lease lost");
        }
      }),
      /lease lost/,
    );
    assert.deepEqual(h.rows("SELECT status, finished_at FROM fetch_runs"), [{ status: "abandoned", finished_at: iso(T + 1) }]);
  } finally {
    await h.close();
  }
});

test("a cycle without onStage behaves as before (existing callers are unaffected)", async () => {
  const h = await harness([SRC_A]);
  try {
    const report = await h.cycle(T, { "src-a": items(SRC_A, "alpha") });
    assert.equal(report.status, "ok");
    assert.equal(report.articlesNew, 1);
  } finally {
    await h.close();
  }
});
