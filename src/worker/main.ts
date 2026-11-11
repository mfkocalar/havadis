import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { ENRICH_RETRY_COOLDOWN_MS, loadConfig } from "../lib/config/env.ts";
import { SOURCES } from "../lib/config/sources.ts";
import { openDb } from "../lib/db/openDb.ts";
import type { DbHandle } from "../lib/db/openDb.ts";
import { dataDir, dbFile } from "../lib/db/paths.ts";
import { schemaStatus } from "../lib/db/schemaVersion.ts";
import { safeFetch } from "../lib/egress/safeFetch.ts";
import { createLogger } from "../lib/log/logger.ts";
import type { LogFields } from "../lib/log/logger.ts";
import { fetchFeed } from "../lib/pipeline/fetchSource.ts";
import { loadOperatorKey } from "../lib/secrets/key.ts";
import { runIngestCycle } from "../lib/worker/cycle.ts";
import { runEnrichmentStage } from "../lib/worker/enrichRefresh.ts";
import { createWorker } from "../lib/worker/runner.ts";

/**
 * The worker process (`npm run worker`, the worker container's command): the only process that
 * contacts feeds and enrichment APIs. It refuses to start on an invalid configuration, a missing or
 * malformed key, a missing database or a schema that is not current (D-06, D-11), runs the tick loop
 * from src/lib/worker/runner.ts, and shuts down cleanly on SIGTERM or SIGINT. Relative imports only:
 * node runs this file directly, without the bundler's `@/` alias.
 *
 * Log lines and refusal messages are fixed text; no path, URL, address or driver message is written (D-14).
 */

const SCHEMA_AHEAD_MESSAGE = "database schema is newer than this image; use an image at least as new as the database";
const SCHEMA_PENDING_MESSAGE = "run migrate first (docker compose runs the migrate service before the worker)";
const DB_MISSING_MESSAGE = "database not found; run migrate first";
const DB_UNREADABLE_MESSAGE = "database could not be opened as a Havadis database; check HAVADIS_DATA_DIR and the file's permissions";

/** Exits once stdout and stderr have drained, so the last log line is not lost on a pipe. */
function exitAfterFlush(code: number): void {
  process.stdout.write("", () => process.stderr.write("", () => process.exit(code)));
}

function main(): void {
  const config = loadConfig(process.env);
  const log = createLogger({ level: config.ok ? config.config.logLevel : "info" });

  function refuse(reasonCode: string, message: string, variable?: string): void {
    const fields: LogFields = { component: "worker", reason_code: reasonCode };
    if (variable !== undefined) fields.variable = variable;
    log.log("error", "startup_refused", fields);
    process.stderr.write(`${message}\n`);
    exitAfterFlush(1);
  }

  if (!config.ok) return refuse("config_invalid", config.message, config.variable);
  const key = loadOperatorKey(process.env);
  if (!key.ok) return refuse(key.code, key.message);

  if (!existsSync(dbFile(dataDir(process.env)))) return refuse("db_missing", DB_MISSING_MESSAGE);
  let handle: DbHandle;
  let status: ReturnType<typeof schemaStatus>;
  try {
    handle = openDb(dbFile(dataDir(process.env)), "worker");
    status = schemaStatus(handle.raw);
  } catch {
    return refuse("db_unreadable", DB_UNREADABLE_MESSAGE);
  }
  if (status === "ahead") return refuse("schema_ahead", SCHEMA_AHEAD_MESSAGE);
  if (status === "pending") return refuse("schema_pending", SCHEMA_PENDING_MESSAGE);

  const { ingestIntervalMs, enrichIntervalMs, ssvcMaxLookups, ssvcBudgetMs, fetchConcurrency } = config.config;
  const worker = createWorker({
    db: handle.db,
    owner: randomUUID(),
    clock: Date.now,
    random: Math.random,
    config: { ingestIntervalMs },
    // fetchFeed(source, { validators }) takes its validators in an options object; the cycle passes them positionally.
    // `clock` makes finished_at the real finish time instead of the cycle's start.
    runCycle: (db, now, onStage) =>
      runIngestCycle(
        db,
        { sources: SOURCES, fetchFeed: (source, validators) => fetchFeed(source, { validators }), concurrency: fetchConcurrency, clock: Date.now, onStage },
        now,
      ),
    runEnrichment: (db, clock, runId) =>
      runEnrichmentStage(
        db,
        { fetcher: safeFetch, enrichIntervalMs, cooldownMs: ENRICH_RETRY_COOLDOWN_MS, ssvcMaxLookups, ssvcBudgetMs },
        clock,
        runId,
      ),
    log,
  });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.log("info", "worker_stopping");
    await worker.stop();
    try {
      handle.raw.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      // Best effort: a reader or a late writer may hold the log; the next checkpoint folds it in.
    }
    try {
      await handle.close();
    } catch {
      // Closing is best effort at exit.
    }
    log.log("info", "worker_stopped");
    exitAfterFlush(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  // The restart policy brings the worker back; the job lease keeps the restart from overlapping a cycle.
  process.on("unhandledRejection", () => {
    log.log("error", "cycle_failed", { code: "cycle_error" });
    exitAfterFlush(1);
  });

  log.log("info", "worker_started", { sources: SOURCES.length, ingest_interval_ms: ingestIntervalMs });
  worker.start();
}

main();
