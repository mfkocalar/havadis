import type { Kysely } from "kysely";
import type { Database, SourceFetchOutcome } from "../db/schema.ts";
import { applySourceWindow } from "../pipeline/applySourceWindow.ts";
import { canonicalizeUrl } from "../pipeline/canonicalizeUrl.ts";
import type { FeedFetchResult, FeedValidators } from "../pipeline/feedResult.ts";
import { fanOutWithOutcomes } from "../pipeline/fanOut.ts";
import type { FetchErrorCode } from "../reasonCodes.ts";
import { readSourceAnchors, selectInWindowArticles } from "../store/articles.ts";
import {
  applyCyclePlan,
  beginRun,
  findExistingSightings,
  finishRun,
  recordFailedCycle,
  sightingKey,
  touchSightings,
} from "../store/ingest.ts";
import type { PerSourceOutcome } from "../store/ingest.ts";
import type { SourceConfig } from "../types.ts";
import { planStories } from "./derive.ts";
import type { IncomingSighting } from "./derive.ts";

/**
 * One ingest cycle: fan out over the enabled sources, window each result exactly like v1, store
 * every sighting on sticky merge-only stories, and advance the last-good marker only for ok or
 * partial cycles. A failed or empty cycle writes only its own bookkeeping (PLAT-09).
 *
 * No network call happens inside a database transaction: every fetch has finished before the one
 * BEGIN IMMEDIATE transaction that writes the cycle (T-14-03).
 */

export type CycleDeps = {
  /** The worker's source list; only those with an enabled sources row are fetched. */
  sources: readonly SourceConfig[];
  fetchFeed: (source: SourceConfig, validators: FeedValidators) => Promise<FeedFetchResult>;
  concurrency?: number;
  newId?: () => string;
  trigger?: string;
  /** Wall clock for finished_at only; defaults to the cycle's now so tests stay deterministic. */
  clock?: () => number;
};

export type CycleReport = {
  runId: number;
  status: "ok" | "partial" | "failed";
  sourcesTotal: number;
  sourcesOk: number;
  articlesNew: number;
  articlesSeen: number;
  storiesCreated: number;
  storiesMerged: number;
  outcomes: Array<{ sourceId: string; outcome: SourceFetchOutcome; code: FetchErrorCode | null }>;
};

/**
 * `failed` when no source produced anything (ok outcomes with items plus 304s are zero), `partial`
 * when any outcome failed or was skipped, else `ok`. A 304 counts as a success (RESEARCH Pitfall 15);
 * `itemCount` is the count after applySourceWindow.
 */
export function classifyRun(
  outcomes: ReadonlyArray<{ outcome: SourceFetchOutcome; itemCount: number }>,
): "ok" | "partial" | "failed" {
  const productive = outcomes.filter((o) => (o.outcome === "ok" && o.itemCount > 0) || o.outcome === "not_modified").length;
  if (productive === 0) return "failed";
  if (outcomes.some((o) => o.outcome === "failed" || o.outcome === "skipped_backoff")) return "partial";
  return "ok";
}

const REJECTED: FeedFetchResult = { status: "error", code: "network_error", httpStatus: null, retryAfterMs: null };

function validIso(value: string): string | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export async function runIngestCycle(db: Kysely<Database>, deps: CycleDeps, now: number): Promise<CycleReport> {
  const nowIso = new Date(now).toISOString();
  const clock = deps.clock ?? (() => now);
  const runId = await beginRun(db, nowIso, deps.trigger ?? "scheduled");
  try {
    const stateRows = await db.selectFrom("sources").where("enabled", "=", 1).select(["id", "etag", "last_modified"]).execute();
    const enabled = new Map(stateRows.map((r) => [r.id, { etag: r.etag, lastModified: r.last_modified }]));
    const sources = deps.sources.filter((s) => enabled.has(s.id));

    const fetched = await fanOutWithOutcomes(
      sources,
      (source) => deps.fetchFeed(source, enabled.get(source.id)!),
      { concurrency: deps.concurrency ?? 8, onRejected: () => REJECTED },
    );

    const perSource: PerSourceOutcome[] = [];
    const sightings: IncomingSighting[] = [];
    const validators = new Map<string, FeedValidators>();
    const successful = new Set<string>();
    for (const { source, result, durationMs } of fetched) {
      if (result.status === "ok") {
        const windowed = applySourceWindow(result.articles, source, now);
        let newest: number | null = null;
        for (const article of windowed) {
          const publishedAt = validIso(article.publishedAt);
          if (publishedAt === null) continue;
          sightings.push({ ...article, publishedAt, sourceId: source.id, canonicalUrl: canonicalizeUrl(article.url) });
          newest = Math.max(newest ?? 0, Date.parse(publishedAt));
        }
        validators.set(source.id, result.validators);
        successful.add(source.id);
        perSource.push({
          sourceId: source.id,
          outcome: "ok",
          httpStatus: result.httpStatus,
          itemCount: windowed.length,
          newestItemAt: newest === null ? null : new Date(newest).toISOString(),
          durationMs,
          code: null,
        });
      } else if (result.status === "not-modified") {
        successful.add(source.id);
        perSource.push({ sourceId: source.id, outcome: "not_modified", httpStatus: 304, itemCount: null, newestItemAt: null, durationMs, code: null });
      } else {
        perSource.push({ sourceId: source.id, outcome: "failed", httpStatus: result.httpStatus, itemCount: null, newestItemAt: null, durationMs, code: result.code });
      }
    }

    const status = classifyRun(perSource.map((p) => ({ outcome: p.outcome, itemCount: p.itemCount ?? 0 })));
    const report = (extra: Partial<CycleReport> = {}): CycleReport => ({
      runId,
      status,
      sourcesTotal: perSource.length,
      sourcesOk: perSource.filter((p) => p.outcome === "ok" || p.outcome === "not_modified").length,
      articlesNew: 0,
      articlesSeen: 0,
      storiesCreated: 0,
      storiesMerged: 0,
      outcomes: perSource.map((p) => ({ sourceId: p.sourceId, outcome: p.outcome, code: p.code })),
      ...extra,
    });

    if (status === "failed") {
      await db.transaction().execute((trx) =>
        recordFailedCycle(trx, { runId, nowIso, finishedAtIso: new Date(clock()).toISOString(), perSource }),
      );
      return report();
    }

    const counts = await db.transaction().execute(async (trx) => {
      // The anchor map as it will read once this cycle commits: this cycle's successful sources at now.
      const anchors = await readSourceAnchors(trx);
      for (const sourceId of successful) anchors.set(sourceId, now);
      const stored = await selectInWindowArticles(trx, anchors);

      // A sighting listed twice in one feed is one sighting.
      const unique = new Map<string, IncomingSighting>();
      for (const s of sightings) {
        const key = sightingKey(s.sourceId, s.canonicalUrl);
        if (!unique.has(key)) unique.set(key, s);
      }
      const existing = await findExistingSightings(trx, [...unique.values()]);
      await touchSightings(trx, [...existing.values()].map((e) => e.id), nowIso);
      const fresh = [...unique].filter(([key]) => !existing.has(key)).map(([, s]) => s);

      const storyIds = [...new Set(stored.map((a) => a.storyId))];
      const firstSeen = new Map<string, string>();
      if (storyIds.length > 0) {
        const rows = await trx.selectFrom("stories").where("id", "in", storyIds).select(["id", "first_seen_at"]).execute();
        for (const r of rows) firstSeen.set(r.id, r.first_seen_at);
      }

      const plan = planStories(
        { stored, incoming: fresh, storyFirstSeen: firstSeen },
        deps.newId ?? (() => crypto.randomUUID()),
        now,
      );
      const applied = await applyCyclePlan(trx, {
        runId,
        nowIso,
        finishedAtIso: new Date(clock()).toISOString(),
        status,
        plan,
        incoming: fresh,
        articlesSeen: unique.size,
        perSource,
        validators,
      });
      return { ...applied, articlesSeen: unique.size };
    });

    return report(counts);
  } catch (err) {
    await finishRun(db, runId, new Date(clock()).toISOString(), "failed");
    throw err;
  }
}
