import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";

export type HeartbeatState = "idle" | "running" | "stopping" | "stopped";

// Skeleton so the tests compile and fail on their assertions (RED); replaced in the next commit.
export async function claimLease(_db: Kysely<Database>, _owner: string, _nowIso: string, _leaseUntilIso: string): Promise<boolean> {
  return false;
}
export async function renewLease(_db: Kysely<Database>, _owner: string, _nowIso: string, _leaseUntilIso: string): Promise<boolean> {
  return false;
}
export async function releaseLease(_db: Kysely<Database>, _owner: string, _input: { nextRunAtIso?: string; status: string }): Promise<void> {}
export async function abandonStaleRuns(_db: Kysely<Database>, _nowIso: string): Promise<number> {
  return 0;
}
export async function markRunAbandoned(_db: Kysely<Database>, _runId: number, _nowIso: string): Promise<boolean> {
  return false;
}
export async function beat(_db: Kysely<Database>, _nowIso: string, _state: HeartbeatState): Promise<void> {}
