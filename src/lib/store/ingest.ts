import type { Kysely } from "kysely";
import type { Database, FetchRunStatus, SourceFetchOutcome } from "../db/schema.ts";
import type { FeedValidators } from "../pipeline/feedResult.ts";
import type { FetchErrorCode } from "../reasonCodes.ts";
import type { DerivePlan, IncomingSighting } from "../worker/derive.ts";

/**
 * Write side of the ingest store: run bookkeeping and the one-transaction cycle write. Every query
 * goes through Kysely with bound parameters; feed text is never concatenated into SQL (T-14-01).
 * Nothing here deletes a story or an article, and a failed cycle writes only its own bookkeeping
 * (PLAT-09 last-good rule).
 */

/** Bumped when classify, extractCves or scoreImportance change meaning, so Phase 16 can re-derive. */
export const DERIVE_VERSION = 1;

/** SQLite's bound-variable limit is far above this; chunking only keeps statements small. */
const CHUNK = 400;

export type PerSourceOutcome = {
  sourceId: string;
  outcome: SourceFetchOutcome;
  httpStatus: number | null;
  /** The count after applySourceWindow for an ok outcome; null for the others. */
  itemCount: number | null;
  /** ISO time of the newest in-window item, null when there is none. */
  newestItemAt: string | null;
  durationMs: number | null;
  code: FetchErrorCode | null;
};

export type SightingKey = { sourceId: string; canonicalUrl: string };

export function sightingKey(sourceId: string, canonicalUrl: string): string {
  return `${sourceId}\n${canonicalUrl}`;
}

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

const isOk = (o: SourceFetchOutcome): boolean => o === "ok" || o === "not_modified";

/** Inserts the 'running' run row at the cycle's now; the unique index rejects a second running row. */
export async function beginRun(db: Kysely<Database>, nowIso: string, trigger: string): Promise<number> {
  const row = await db
    .insertInto("fetch_runs")
    .values({ started_at: nowIso, status: "running", trigger })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

/** The stored sightings among `keys`, keyed by `sightingKey`. */
export async function findExistingSightings(
  trx: Kysely<Database>,
  keys: readonly SightingKey[],
): Promise<Map<string, { id: number; storyId: string }>> {
  const bySource = new Map<string, string[]>();
  for (const key of keys) bySource.set(key.sourceId, [...(bySource.get(key.sourceId) ?? []), key.canonicalUrl]);
  const found = new Map<string, { id: number; storyId: string }>();
  for (const [sourceId, urls] of bySource) {
    for (const part of chunks(urls)) {
      const rows = await trx
        .selectFrom("articles")
        .where("source_id", "=", sourceId)
        .where("canonical_url", "in", part)
        .select(["id", "canonical_url", "story_id"])
        .execute();
      for (const row of rows) found.set(sightingKey(sourceId, row.canonical_url), { id: row.id, storyId: row.story_id });
    }
  }
  return found;
}

/** Updates last_seen_at only. */
export async function touchSightings(trx: Kysely<Database>, ids: readonly number[], nowIso: string): Promise<void> {
  for (const part of chunks(ids)) {
    await trx.updateTable("articles").set({ last_seen_at: nowIso }).where("id", "in", part).execute();
  }
}

async function writeSourceFetches(trx: Kysely<Database>, runId: number, perSource: readonly PerSourceOutcome[]): Promise<void> {
  for (const p of perSource) {
    await trx
      .insertInto("source_fetches")
      .values({
        run_id: runId,
        source_id: p.sourceId,
        outcome: p.outcome,
        http_status: p.httpStatus,
        item_count: p.itemCount,
        newest_item_at: p.newestItemAt,
        duration_ms: p.durationMs,
        reason_code: p.code,
      })
      .execute();
  }
}

/** What one cycle decided about a host: back it off one more step, or clear it. */
export type HostUpdate =
  | { host: string; kind: "failure"; nextAttemptAtIso: string; outcome: string }
  | { host: string; kind: "success" };

/**
 * The stored back-off state before a cycle: `blocked` are the hosts whose next_attempt_at is after
 * `nowIso` (not to be requested), `failures` the consecutive failure count of every host that has a
 * row, blocked or not. Timestamps are fixed-width ISO strings, so comparing them as text is exact.
 */
export async function selectBackoff(
  db: Kysely<Database>,
  nowIso: string,
): Promise<{ blocked: ReadonlySet<string>; failures: ReadonlyMap<string, number> }> {
  const rows = await db.selectFrom("host_backoff").select(["host", "failures", "next_attempt_at"]).execute();
  return {
    blocked: new Set(rows.filter((r) => r.next_attempt_at !== null && r.next_attempt_at > nowIso).map((r) => r.host)),
    failures: new Map(rows.map((r) => [r.host, r.failures])),
  };
}

/**
 * Applies a cycle's host decisions inside the cycle transaction: a failure adds one to the host's
 * count and sets its next attempt, a success deletes the row. Bookkeeping only; reader-visible
 * state is never touched.
 */
async function writeHostUpdates(trx: Kysely<Database>, updates: readonly HostUpdate[]): Promise<void> {
  for (const u of updates) {
    if (u.kind === "success") {
      await trx.deleteFrom("host_backoff").where("host", "=", u.host).execute();
      continue;
    }
    await trx
      .insertInto("host_backoff")
      .values({ host: u.host, failures: 1, next_attempt_at: u.nextAttemptAtIso, last_outcome: u.outcome })
      .onConflict((oc) =>
        oc.column("host").doUpdateSet((eb) => ({
          failures: eb("host_backoff.failures", "+", 1),
          next_attempt_at: u.nextAttemptAtIso,
          last_outcome: u.outcome,
        })),
      )
      .execute();
  }
}

export type ApplyCycleInput = {
  runId: number;
  /** The cycle's now: the instant applySourceWindow windowed with, and the edition time. */
  nowIso: string;
  /** When the run row is finished; defaults to nowIso. */
  finishedAtIso?: string;
  status: "ok" | "partial";
  plan: DerivePlan;
  /** New sightings only (no articles row yet), with published_at already valid. */
  incoming: readonly IncomingSighting[];
  /** In-window sightings seen this cycle, new and already stored. */
  articlesSeen: number;
  perSource: readonly PerSourceOutcome[];
  /** Validators of this cycle's ok outcomes, by source id. */
  validators: ReadonlyMap<string, FeedValidators>;
  /** Back-off decisions of this cycle, written in the same transaction. */
  hostUpdates?: readonly HostUpdate[];
};

/**
 * The whole write of a good (ok or partial) cycle, to be run inside one BEGIN IMMEDIATE transaction
 * after every fetch has finished. Returns what the cycle report needs.
 */
export async function applyCyclePlan(
  trx: Kysely<Database>,
  input: ApplyCycleInput,
): Promise<{ articlesNew: number; storiesCreated: number; storiesMerged: number }> {
  const { runId, nowIso, plan } = input;
  const derivedById = new Map(plan.derived.map((d) => [d.storyId, d]));
  const createdIds = new Set(plan.newStories.map((s) => s.id));

  for (const story of plan.newStories) {
    const d = derivedById.get(story.id);
    if (!d) throw new Error("derive plan has a new story without derived fields");
    await trx
      .insertInto("stories")
      .values({
        id: story.id,
        first_seen_at: story.firstSeenAt,
        section: d.section,
        importance: d.importance,
        importance_reason: d.importanceReason,
        derive_version: DERIVE_VERSION,
        last_activity_at: nowIso,
      })
      .execute();
  }

  // Merge-only: the loser stays as a row with merged_into set, its articles move to the survivor,
  // and any story already merged into the loser is re-pointed so the chain stays flat.
  for (const { loser, survivor } of plan.merges) {
    await trx.updateTable("articles").set({ story_id: survivor }).where("story_id", "=", loser).execute();
    await trx.updateTable("stories").set({ merged_into: survivor }).where("id", "=", loser).execute();
    await trx.updateTable("stories").set({ merged_into: survivor }).where("merged_into", "=", loser).execute();
    await trx.deleteFrom("story_cves").where("story_id", "=", loser).execute();
  }

  // DO NOTHING, never DO UPDATE: DO UPDATE reports one change for new and existing rows alike
  // (RESEARCH Pitfall 12), and an existing sighting must keep its first_seen_at.
  const storyOf = new Map(plan.assignments.map((a) => [sightingKey(a.sourceId, a.canonicalUrl), a.storyId]));
  let articlesNew = 0;
  for (const s of input.incoming) {
    const storyId = storyOf.get(sightingKey(s.sourceId, s.canonicalUrl));
    if (storyId === undefined) throw new Error("derive plan has no story for an incoming sighting");
    const result = await trx
      .insertInto("articles")
      .values({
        story_id: storyId,
        source_id: s.sourceId,
        url: s.url,
        canonical_url: s.canonicalUrl,
        title: s.title,
        summary: s.summary,
        published_at: new Date(s.publishedAt).toISOString(),
        first_seen_at: nowIso,
        last_seen_at: nowIso,
      })
      .onConflict((oc) => oc.columns(["source_id", "canonical_url"]).doNothing())
      .executeTakeFirst();
    articlesNew += Number(result.numInsertedOrUpdatedRows ?? 0);
  }

  // Derived fields of stories that already existed: written only when they changed.
  const existing = plan.derived.filter((d) => !createdIds.has(d.storyId));
  for (const part of chunks(existing)) {
    const rows = await trx
      .selectFrom("stories")
      .where("id", "in", part.map((d) => d.storyId))
      .select(["id", "section", "importance", "importance_reason", "derive_version"])
      .execute();
    const current = new Map(rows.map((r) => [r.id, r]));
    for (const d of part) {
      const row = current.get(d.storyId);
      const changed =
        !row ||
        row.section !== d.section ||
        row.importance !== d.importance ||
        row.importance_reason !== d.importanceReason ||
        row.derive_version !== DERIVE_VERSION;
      if (!changed && !d.joined) continue;
      await trx
        .updateTable("stories")
        .set({
          ...(changed
            ? {
                section: d.section,
                importance: d.importance,
                importance_reason: d.importanceReason,
                derive_version: DERIVE_VERSION,
              }
            : {}),
          ...(d.joined ? { last_activity_at: nowIso } : {}),
        })
        .where("id", "=", d.storyId)
        .execute();
    }
  }

  // The CVE registry row first (story_cves references it), then each derived story's CVE set.
  const allCves = [...new Set(plan.derived.flatMap((d) => d.cves))];
  for (const cveId of allCves) {
    await trx
      .insertInto("cve_signals")
      .values({ cve_id: cveId, first_seen_at: nowIso })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
  for (const part of chunks(plan.derived)) {
    const rows = await trx
      .selectFrom("story_cves")
      .where("story_id", "in", part.map((d) => d.storyId))
      .select(["story_id", "cve_id"])
      .execute();
    const have = new Map<string, Set<string>>();
    for (const r of rows) have.set(r.story_id, (have.get(r.story_id) ?? new Set()).add(r.cve_id));
    for (const d of part) {
      const current = have.get(d.storyId) ?? new Set<string>();
      if (current.size === d.cves.length && d.cves.every((c) => current.has(c))) continue;
      await trx.deleteFrom("story_cves").where("story_id", "=", d.storyId).execute();
      for (const cveId of d.cves) await trx.insertInto("story_cves").values({ story_id: d.storyId, cve_id: cveId }).execute();
    }
  }

  await writeSourceFetches(trx, runId, input.perSource);
  for (const p of input.perSource) {
    const v = p.outcome === "ok" ? input.validators.get(p.sourceId) : undefined;
    if (v) await trx.updateTable("sources").set({ etag: v.etag, last_modified: v.lastModified }).where("id", "=", p.sourceId).execute();
  }
  await writeHostUpdates(trx, input.hostUpdates ?? []);

  await trx
    .updateTable("fetch_runs")
    .set({
      status: input.status,
      finished_at: input.finishedAtIso ?? nowIso,
      sources_total: input.perSource.length,
      sources_ok: input.perSource.filter((p) => isOk(p.outcome)).length,
      articles_new: articlesNew,
      articles_seen: input.articlesSeen,
    })
    .where("id", "=", runId)
    .execute();

  for (const [key, value] of [
    ["last_good_run_id", String(runId)],
    ["edition_generated_at", nowIso],
  ] as const) {
    await trx
      .insertInto("meta")
      .values({ key, value })
      .onConflict((oc) => oc.column("key").doUpdateSet({ value }))
      .execute();
  }

  return { articlesNew, storiesCreated: plan.newStories.length, storiesMerged: plan.merges.length };
}

/**
 * A failed or empty cycle: writes only its own bookkeeping, one source_fetches row per source, the
 * host back-off rows and the finished run row. It touches no story, article, story_cves,
 * cve_signals, sources or meta row, so the stored edition and every window anchor stay exactly as
 * they were (PLAT-09). host_backoff is polling bookkeeping, not reader-visible state.
 */
export async function recordFailedCycle(
  trx: Kysely<Database>,
  input: {
    runId: number;
    nowIso: string;
    finishedAtIso?: string;
    perSource: readonly PerSourceOutcome[];
    hostUpdates?: readonly HostUpdate[];
  },
): Promise<void> {
  await writeSourceFetches(trx, input.runId, input.perSource);
  await writeHostUpdates(trx, input.hostUpdates ?? []);
  await trx
    .updateTable("fetch_runs")
    .set({
      status: "failed",
      finished_at: input.finishedAtIso ?? input.nowIso,
      sources_total: input.perSource.length,
      sources_ok: input.perSource.filter((p) => isOk(p.outcome)).length,
    })
    .where("id", "=", input.runId)
    .execute();
}

/** Closes a run row on the exception path. */
export async function finishRun(
  db: Kysely<Database>,
  runId: number,
  nowIso: string,
  status: Exclude<FetchRunStatus, "running">,
): Promise<void> {
  await db.updateTable("fetch_runs").set({ status, finished_at: nowIso }).where("id", "=", runId).execute();
}
