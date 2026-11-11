import { loadConfig } from "./config/env.ts";
import { getWebDb, type DbHandle } from "./db/openDb.ts";
import { schemaStatus } from "./db/schemaVersion.ts";
import { createLogger, type LogEvent, type LogFields, type LogLevel } from "./log/logger.ts";
import { loadOperatorKey } from "./secrets/key.ts";

/**
 * The web process's start-up guard (D-06, D-11, T-14-32). It refuses to serve a single page without a
 * valid operator key and a database whose schema matches this image. The messages are fixed text and
 * the log line carries only a fixed reason code, never a value, path or driver message (D-14).
 */

export type WebStartupDeps = {
  env?: NodeJS.ProcessEnv;
  exit?: (code: number) => never;
  log?: { log(level: LogLevel, event: LogEvent, fields?: LogFields): void };
  stderr?: (text: string) => void;
  open?: () => DbHandle;
};

const SCHEMA_AHEAD_MESSAGE = "database schema is newer than this image; use an image at least as new as the database";
const SCHEMA_PENDING_MESSAGE = "run migrate first (docker compose runs the migrate service before web)";
const DB_MISSING_MESSAGE = "database not found; run migrate first";
const DB_UNREADABLE_MESSAGE = "database could not be opened as a Havadis database; check HAVADIS_DATA_DIR and the file's permissions";

function isCantOpen(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "SQLITE_CANTOPEN";
}

/**
 * The opened web database handle stays open for the process lifetime: the restore guard in Plan 15
 * detects a running web through that open connection.
 */
export async function assertWebStartup(deps: WebStartupDeps = {}): Promise<void> {
  const env = deps.env ?? process.env;
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const stderr = deps.stderr ?? ((text: string) => void process.stderr.write(text));
  const open = deps.open ?? (() => getWebDb(env));

  const config = loadConfig(env);
  const logger = deps.log ?? createLogger({ level: config.ok ? config.config.logLevel : "info" });

  function refuse(reasonCode: string, message: string, variable?: string): void {
    const fields: LogFields = { component: "web", reason_code: reasonCode };
    if (variable !== undefined) fields.variable = variable;
    logger.log("error", "startup_refused", fields);
    stderr(`${message}\n`);
    exit(1);
  }

  if (!config.ok) return refuse("config_invalid", config.message, config.variable);

  const key = loadOperatorKey(env);
  if (!key.ok) return refuse(key.code, key.message);

  let handle: DbHandle;
  try {
    handle = open();
  } catch (err) {
    return isCantOpen(err) ? refuse("db_missing", DB_MISSING_MESSAGE) : refuse("db_unreadable", DB_UNREADABLE_MESSAGE);
  }

  let status: ReturnType<typeof schemaStatus>;
  try {
    status = schemaStatus(handle.raw);
  } catch {
    return refuse("db_unreadable", DB_UNREADABLE_MESSAGE);
  }
  if (status === "ahead") return refuse("schema_ahead", SCHEMA_AHEAD_MESSAGE);
  if (status === "pending") return refuse("schema_pending", SCHEMA_PENDING_MESSAGE);
}
