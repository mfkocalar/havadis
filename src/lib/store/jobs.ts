import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";

/**
 * The ingest job's lease, run bookkeeping and the worker heartbeat (PLAT-06). Every statement is one
 * atomic UPDATE or upsert through Kysely, so "one cycle at a time, also across restarts" is a
 * property of the data rather than of process state.
 *
 * Timestamps are fixed-width ISO strings (the schema CHECK pins one format), so comparing them as
 * text is exact. A lease is held while lease_until >= now; it is expired only when lease_until < now.
 */

export type HeartbeatState = "idle" | "running" | "stopping" | "stopped";

const KIND = "ingest";

/**
 * Takes the ingest lease when the job is due (next_run_at <= now) and nobody holds it: one UPDATE ...
 * RETURNING, so two workers claiming at the same instant cannot both get a row back.
 */
export async function claimLease(db: Kysely<Database>, owner: string, nowIso: string, leaseUntilIso: string): Promise<boolean> {
  const row = await db
    .updateTable("job")
    .set({ lease_owner: owner, lease_until: leaseUntilIso, last_started_at: nowIso })
    .where("kind", "=", KIND)
    .where("next_run_at", "<=", nowIso)
    .where((eb) => eb.or([eb("lease_until", "is", null), eb("lease_until", "<", nowIso)]))
    .returning("kind")
    .executeTakeFirst();
  return row !== undefined;
}

/** Moves lease_until forward while `owner` still holds a lease that has not expired; false means the lease is lost. */
export async function renewLease(db: Kysely<Database>, owner: string, nowIso: string, leaseUntilIso: string): Promise<boolean> {
  const row = await db
    .updateTable("job")
    .set({ lease_until: leaseUntilIso })
    .where("kind", "=", KIND)
    .where("lease_owner", "=", owner)
    .where("lease_until", ">=", nowIso)
    .returning("kind")
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * Clears the lease of `owner` and records the last status. `nextRunAtIso` moves the schedule; without
 * it next_run_at stays (a stopped worker's cycle is still due). Another owner's lease is left alone.
 */
export async function releaseLease(
  db: Kysely<Database>,
  owner: string,
  input: { nextRunAtIso?: string; status: string },
): Promise<void> {
  await db
    .updateTable("job")
    .set({
      lease_owner: null,
      lease_until: null,
      last_status: input.status,
      ...(input.nextRunAtIso === undefined ? {} : { next_run_at: input.nextRunAtIso }),
    })
    .where("kind", "=", KIND)
    .where("lease_owner", "=", owner)
    .execute();
}

/** After a successful claim no cycle of this job is legitimately running: every 'running' row is an orphan. Returns how many. */
export async function abandonStaleRuns(db: Kysely<Database>, nowIso: string): Promise<number> {
  const result = await db
    .updateTable("fetch_runs")
    .set({ status: "abandoned", finished_at: nowIso })
    .where("status", "=", "running")
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

/** Marks one run abandoned, only while it is still 'running', so a cycle that already committed is never overwritten. */
export async function markRunAbandoned(db: Kysely<Database>, runId: number, nowIso: string): Promise<boolean> {
  const result = await db
    .updateTable("fetch_runs")
    .set({ status: "abandoned", finished_at: nowIso })
    .where("id", "=", runId)
    .where("status", "=", "running")
    .executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
}

/** Upserts the single worker_heartbeat row that /api/health and the worker healthcheck read. */
export async function beat(db: Kysely<Database>, nowIso: string, state: HeartbeatState): Promise<void> {
  await db
    .insertInto("worker_heartbeat")
    .values({ id: 1, beat_at: nowIso, state })
    .onConflict((oc) => oc.column("id").doUpdateSet({ beat_at: nowIso, state }))
    .execute();
}
