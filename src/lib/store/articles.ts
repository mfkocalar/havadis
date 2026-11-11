import { sql } from "kysely";
import type { Kysely } from "kysely";
import { applySourceWindow } from "../pipeline/applySourceWindow.ts";
import type { Database } from "../db/schema.ts";
import type { Article, SourceConfig, SourceTier } from "../types.ts";

/**
 * Read side of the ingest store: per-source last-good window anchors, the sightings inside those
 * windows, and the last-good edition marker. Every query goes through Kysely with bound parameters;
 * the one raw fragment is a constant (T-14-01).
 */

/** One stored sighting: the engine's `Article` plus the row identity the derive step needs. */
export type StoredArticle = Article & {
  /** The articles.id row id (not the URL hash of pipeline/articleId.ts). */
  articleId: number;
  sourceId: string;
  storyId: string;
  canonicalUrl: string;
};

/** The longest lookback of any source type (LOOKBACK_HOURS), so a prefilter can never drop an in-window row. */
const MAX_LOOKBACK_MS = 72 * 3_600_000;

/**
 * Per source, the started_at of the newest ok or partial run in which its fetch outcome was ok or
 * not_modified (its last successful fetch), as one statement (user decision B).
 *
 * The outcome term below repeats the WHERE term of the partial index `source_fetches_success`
 * (migration 0001) verbatim as literals, not bound parameters: SQLite uses a partial index only when
 * the query repeats its WHERE term. The planner then does one seek per source on
 * (source_id, run_id), reads that source's success rows newest first until the first one inside an
 * ok or partial run, and never reads failed or skipped_backoff rows. The fragment interpolates
 * nothing. A plan test pins the index use.
 */
export function sourceAnchorsQuery(db: Kysely<Database>) {
  return db.selectFrom("sources as s").select((eb) => [
    "s.id",
    eb
      .selectFrom("source_fetches as sf")
      .innerJoin("fetch_runs as fr", "fr.id", "sf.run_id")
      .whereRef("sf.source_id", "=", "s.id")
      .where(sql<boolean>`sf.outcome IN ('ok','not_modified')`)
      .where("fr.status", "in", ["ok", "partial"])
      .orderBy("sf.run_id", "desc")
      .limit(1)
      .select("fr.started_at")
      .as("anchor"),
  ]);
}

/**
 * Each source's window anchor: Date.parse of its last successful fetch's run start. Failed, empty,
 * abandoned and running runs never count, so a failed cycle moves no anchor; a source with no
 * successful fetch is absent. articles.last_seen_at is bookkeeping, not an anchor, because a 304
 * touches no sighting.
 */
export async function readSourceAnchors(db: Kysely<Database>): Promise<Map<string, number>> {
  const anchors = new Map<string, number>();
  for (const row of await sourceAnchorsQuery(db).execute()) {
    if (row.anchor !== null) anchors.set(row.id, Date.parse(row.anchor));
  }
  return anchors;
}

/**
 * The sightings of every source in `anchors`, windowed by `applySourceWindow` at that source's own
 * anchor so lookback and cap match v1 at the moment the source was last fetched successfully. A
 * source missing from the map contributes nothing. Ordered by row id.
 */
export async function selectInWindowArticles(
  db: Kysely<Database>,
  anchors: ReadonlyMap<string, number>,
): Promise<StoredArticle[]> {
  if (anchors.size === 0) return [];
  const earliest = Math.min(...anchors.values()) - MAX_LOOKBACK_MS;
  const rows = await db
    .selectFrom("articles as a")
    .innerJoin("sources as s", "s.id", "a.source_id")
    .where("a.source_id", "in", [...anchors.keys()])
    .where("a.published_at", ">=", new Date(earliest).toISOString())
    .orderBy("a.id")
    .select([
      "a.id as articleId",
      "a.story_id as storyId",
      "a.source_id as sourceId",
      "a.url",
      "a.canonical_url as canonicalUrl",
      "a.title",
      "a.summary",
      "a.published_at as publishedAt",
      "s.name as sourceName",
      "s.tier as sourceTier",
      "s.source_type as sourceType",
      "s.family",
      "s.url as sourceUrl",
      "s.max_items as maxItems",
    ])
    .execute();

  const ordered: StoredArticle[] = [];
  const bySource = new Map<string, Array<{ stored: StoredArticle; config: SourceConfig }>>();
  for (const row of rows) {
    if (row.publishedAt === null) continue;
    const config: SourceConfig = {
      id: row.sourceId,
      name: row.sourceName,
      tier: row.sourceTier as SourceTier,
      sourceType: row.sourceType,
      lang: "en",
      family: row.family,
      url: row.sourceUrl,
      ...(row.maxItems === null ? {} : { maxItems: row.maxItems }),
    };
    const stored: StoredArticle = {
      title: row.title,
      url: row.url,
      source: row.sourceName,
      sourceTier: config.tier,
      sourceType: row.sourceType,
      publishedAt: row.publishedAt,
      summary: row.summary ?? "",
      articleId: row.articleId,
      sourceId: row.sourceId,
      storyId: row.storyId,
      canonicalUrl: row.canonicalUrl,
    };
    const list = bySource.get(row.sourceId) ?? [];
    list.push({ stored, config });
    bySource.set(row.sourceId, list);
    ordered.push(stored);
  }

  const kept = new Set<StoredArticle>();
  for (const [sourceId, entries] of bySource) {
    const anchor = anchors.get(sourceId);
    if (anchor === undefined) continue;
    // applySourceWindow returns the same object references it was given.
    for (const article of applySourceWindow(
      entries.map((e) => e.stored),
      entries[0]!.config,
      anchor,
    )) {
      kept.add(article as StoredArticle);
    }
  }
  return ordered.filter((article) => kept.has(article));
}

/**
 * The last good edition marker: the run id and edition time of the newest ok or partial cycle, null
 * before the first one. editionAt is the display "Updated" time and the ranking instant, never a
 * window anchor.
 */
export async function readLastGood(db: Kysely<Database>): Promise<{ runId: number; editionAt: number } | null> {
  const rows = await db
    .selectFrom("meta")
    .where("key", "in", ["last_good_run_id", "edition_generated_at"])
    .select(["key", "value"])
    .execute();
  const meta = new Map(rows.map((r) => [r.key, r.value]));
  const runId = Number(meta.get("last_good_run_id"));
  const editionAt = Date.parse(meta.get("edition_generated_at") ?? "");
  if (!meta.has("last_good_run_id") || !Number.isInteger(runId) || !Number.isFinite(editionAt)) return null;
  return { runId, editionAt };
}
