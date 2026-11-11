import { HEALTH_STALE_FACTOR, WORKER_HEARTBEAT_MS } from "./config/env.ts";
import { isBusyError } from "./db/openDb.ts";
import type { DbHandle } from "./db/openDb.ts";
import { schemaStatus } from "./db/schemaVersion.ts";
import { createLogger } from "./log/logger.ts";

/**
 * The /api/health answer (PLAT-11): liveness of the web process, the age band of the worker's
 * heartbeat row and the schema status, and nothing else. The body is a fixed set of four keys with
 * fixed values, so no build detail, path, host, count or error text can reach an unauthenticated
 * caller (T-14-33). Only the schema and an unreadable database fail the Docker healthcheck; a stale
 * or missing worker is "degraded" with 200 so Docker does not restart a healthy web.
 */

export type HealthBody = {
  status: "ok" | "degraded" | "unavailable";
  web: "ok";
  worker: "ok" | "stale" | "waiting" | "unknown";
  schema: "ok" | "ahead" | "pending" | "unknown";
};

export type HealthResult = { httpStatus: 200 | 503; body: HealthBody };

/** The stale threshold in milliseconds: a heartbeat older than this is stale, one exactly this old is still ok. */
const STALE_AFTER_MS = HEALTH_STALE_FACTOR * WORKER_HEARTBEAT_MS;

/** The answer for a database that cannot be read or opened. */
export const UNAVAILABLE: HealthResult = {
  httpStatus: 503,
  body: { status: "unavailable", web: "ok", worker: "unknown", schema: "unknown" },
};

/** `ok` within three heartbeat intervals (boundary inclusive), `stale` beyond, `waiting` with no heartbeat row yet. */
export function workerBand(beatAtIso: string | null, now: number): "ok" | "stale" | "waiting" {
  if (beatAtIso === null) return "waiting";
  return now - Date.parse(beatAtIso) <= STALE_AFTER_MS ? "ok" : "stale";
}

export async function computeHealth(
  handle: DbHandle,
  now: number,
  log: ReturnType<typeof createLogger> = createLogger({ level: "info" }),
): Promise<HealthResult> {
  try {
    const schema = schemaStatus(handle.raw);
    if (schema !== "current") {
      return { httpStatus: 503, body: { status: "unavailable", web: "ok", worker: "unknown", schema } };
    }
    const row = await handle.db.selectFrom("worker_heartbeat").select("beat_at").where("id", "=", 1).executeTakeFirst();
    const worker = workerBand(row?.beat_at ?? null, now);
    return {
      httpStatus: 200,
      body: { status: worker === "ok" ? "ok" : "degraded", web: "ok", worker, schema: "ok" },
    };
  } catch (err) {
    // Only the fixed event and route are logged: the driver's message can hold a path.
    if (isBusyError(err)) log.log("warn", "web_db_busy", { route: "/api/health" });
    return UNAVAILABLE;
  }
}
