import type { DbHandle } from "./db/openDb.ts";
import type { createLogger } from "./log/logger.ts";

export type HealthBody = {
  status: "ok" | "degraded" | "unavailable";
  web: "ok";
  worker: "ok" | "stale" | "waiting" | "unknown";
  schema: "ok" | "ahead" | "pending" | "unknown";
};

// Skeleton for the RED commit: the real band and schema logic follow in the GREEN commit.
export function workerBand(_beatAtIso: string | null, _now: number): "ok" | "stale" | "waiting" {
  return "ok";
}

export async function computeHealth(
  _handle: DbHandle,
  _now: number,
  _log?: ReturnType<typeof createLogger>,
): Promise<{ httpStatus: 200 | 503; body: HealthBody }> {
  return { httpStatus: 200, body: { status: "ok", web: "ok", worker: "ok", schema: "ok" } };
}
