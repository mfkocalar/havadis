import { mkdirSync } from "node:fs";
import path from "node:path";
import { SOURCES } from "../lib/config/sources.ts";
import { assertBackupDirWritable, backupDatabase } from "../lib/db/backup.ts";
import { loadMigrations, MigrationRefused, runMigrations } from "../lib/db/migrator.ts";
import { openDb } from "../lib/db/openDb.ts";
import type { DbHandle } from "../lib/db/openDb.ts";
import { backupDir, dataDir, dbFile } from "../lib/db/paths.ts";
import { RestoreRefused, restoreDatabase } from "../lib/db/restore.ts";
import { seedBuiltins } from "../lib/db/seed.ts";
import { probeLoopbackHealth } from "../lib/egress/loopbackProbe.ts";
import { workerBand } from "../lib/health.ts";
import { createLogger } from "../lib/log/logger.ts";
import { generateKey, loadOperatorKey } from "../lib/secrets/key.ts";

/**
 * The operator command (D-09 to D-12): `havadis migrate | backup | restore <file> | keygen |
 * healthcheck web|worker | selftest`. It runs as `docker compose run --rm migrate havadis ...`,
 * `docker compose exec worker havadis backup` and as the two Docker healthchecks.
 *
 * Every database is opened through openDb (driver seam). Exit codes: 0 success, 1 refusal or failure,
 * 2 usage. Log lines carry fixed events, reason codes and ids only; the one plain stderr line for a
 * refusal is fixed text. Only keygen prints a key. Relative imports only: node runs this file directly.
 */

const USAGE = "usage: havadis migrate | backup | restore <file> | keygen | healthcheck web|worker | selftest";

const log = createLogger({ level: "info" });

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

function complain(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** Exits once stdout and stderr have drained, so the last line is not lost on a pipe. */
function exitAfterFlush(code: number): void {
  process.stdout.write("", () => process.stderr.write("", () => process.exit(code)));
}

/** A fixed code for an unexpected failure: the driver's own message can hold a path. */
function failureCode(err: unknown): string {
  const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? code : "unexpected_error";
}

async function migrate(): Promise<number> {
  const backups = backupDir(process.env);
  const writable = assertBackupDirWritable(backups);
  if (!writable.ok) {
    log.log("error", "backup_failed", { reason_code: "backup_dir_not_writable" });
    complain(writable.message);
    return 1;
  }
  const key = loadOperatorKey(process.env);
  if (!key.ok) {
    log.log("error", "startup_refused", { component: "migrate", reason_code: key.code });
    complain(key.message);
    return 1;
  }

  const dir = dataDir(process.env);
  let handle: DbHandle | undefined;
  try {
    mkdirSync(dir, { recursive: true });
    handle = openDb(dbFile(dir), "cli");
    const opened = handle;
    const result = await runMigrations(opened, {
      migrations: loadMigrations(),
      // A database at version 0 has nothing worth backing up; anything above gets a verified copy first.
      backup: async (info) => {
        if (info.fromVersion === 0) return null;
        const file = await backupDatabase(opened, backups, Date.now(), `pre-migrate-v${info.fromVersion}-to-v${info.toVersion}`);
        log.log("info", "backup_written", { kind: "pre_migrate", file: path.basename(file) });
        return file;
      },
      now: Date.now,
    });
    await seedBuiltins(opened.db, SOURCES, Date.now());
    if (result.applied.length > 0) {
      log.log("info", "migrate_applied", {
        applied: result.applied.length,
        to_version: result.applied[result.applied.length - 1]!,
        backed_up: result.backupPath !== null,
      });
    } else {
      log.log("info", "migrate_noop");
    }
    return 0;
  } catch (err) {
    if (err instanceof MigrationRefused) {
      log.log("error", "migrate_refused", { reason_code: err.code });
      complain(err.message);
    } else {
      log.log("error", "migrate_refused", { reason_code: failureCode(err) });
      complain("migrate failed; check that the data directory exists, is writable by this user and holds a Havadis database");
    }
    return 1;
  } finally {
    await handle?.close();
  }
}

async function backup(): Promise<number> {
  const backups = backupDir(process.env);
  const writable = assertBackupDirWritable(backups);
  if (!writable.ok) {
    log.log("error", "backup_failed", { reason_code: "backup_dir_not_writable" });
    complain(writable.message);
    return 1;
  }
  let handle: DbHandle | undefined;
  try {
    handle = openDb(dbFile(dataDir(process.env)), "cli", { readonly: true });
  } catch {
    log.log("error", "backup_failed", { reason_code: "db_unreadable" });
    complain("database not found or not readable; run migrate first and check HAVADIS_DATA_DIR");
    return 1;
  }
  try {
    const file = await backupDatabase(handle, backups, Date.now(), "manual");
    log.log("info", "backup_written", { kind: "manual", file: path.basename(file) });
    say(file);
    return 0;
  } catch (err) {
    log.log("error", "backup_failed", { reason_code: failureCode(err) });
    complain("backup failed; nothing was written");
    return 1;
  } finally {
    await handle.close();
  }
}

async function restore(file: string): Promise<number> {
  try {
    const result = await restoreDatabase({ file, dataFile: dbFile(dataDir(process.env)), backupsDir: backupDir(process.env) });
    log.log("info", "restore_done", { pre_restore: result.preRestore !== null });
    say(
      result.preRestore !== null
        ? `restored; the previous database was kept as ${result.preRestore}`
        : "restored; there was no previous database to keep",
    );
    say("next: docker compose up -d");
    return 0;
  } catch (err) {
    if (err instanceof RestoreRefused) {
      log.log("error", "restore_refused", { reason_code: err.code });
      complain(err.message);
    } else {
      log.log("error", "restore_refused", { reason_code: failureCode(err) });
      complain("restore failed; the previous database was left in place");
    }
    return 1;
  }
}

async function healthcheckWeb(): Promise<number> {
  const result = await probeLoopbackHealth(Number(process.env.PORT ?? 4000), 3000);
  return result.ok ? 0 : 1;
}

async function healthcheckWorker(): Promise<number> {
  let handle: DbHandle | undefined;
  try {
    handle = openDb(dbFile(dataDir(process.env)), "cli", { readonly: true });
    const row = await handle.db.selectFrom("worker_heartbeat").select("beat_at").where("id", "=", 1).executeTakeFirst();
    return workerBand(row?.beat_at ?? null, Date.now()) === "ok" ? 0 : 1;
  } catch {
    return 1;
  } finally {
    await handle?.close();
  }
}

/** Proves the native driver loads through the same seam the processes use, and that FTS5 is compiled in. */
async function selftest(): Promise<number> {
  let handle: DbHandle | undefined;
  try {
    handle = openDb(":memory:", "cli");
    const options = handle.raw.pragma("compile_options") as Array<{ compile_options: string }>;
    if (!options.some((o) => o.compile_options === "ENABLE_FTS5")) {
      complain("selftest failed: fts5 is not compiled into the SQLite build");
      return 1;
    }
    handle.raw.exec("CREATE VIRTUAL TABLE selftest USING fts5(body)");
    handle.raw.prepare("INSERT INTO selftest(body) VALUES (?)").run("hello havadis");
    const hit = handle.raw.prepare("SELECT count(*) AS n FROM selftest WHERE selftest MATCH ?").get("havadis") as { n: number };
    if (hit.n !== 1) {
      complain("selftest failed: fts5 did not return the row it was given");
      return 1;
    }
    say("selftest ok: better-sqlite3 loaded, fts5 available");
    return 0;
  } catch (err) {
    log.log("error", "startup_refused", { component: "selftest", reason_code: failureCode(err) });
    complain("selftest failed: the native SQLite driver could not be loaded or used");
    return 1;
  } finally {
    await handle?.close();
  }
}

async function main(argv: string[]): Promise<number> {
  const [command, arg, ...rest] = argv;
  switch (command) {
    case "migrate":
      return arg === undefined ? migrate() : usage();
    case "backup":
      return arg === undefined ? backup() : usage();
    case "restore":
      return arg !== undefined && rest.length === 0 ? restore(arg) : usage();
    case "keygen":
      if (arg !== undefined) return usage();
      say(generateKey());
      return 0;
    case "healthcheck":
      if (rest.length > 0) return usage();
      if (arg === "web") return healthcheckWeb();
      if (arg === "worker") return healthcheckWorker();
      return usage();
    case "selftest":
      return arg === undefined ? selftest() : usage();
    default:
      return usage();
  }
}

function usage(): number {
  complain(USAGE);
  return 2;
}

main(process.argv.slice(2)).then(exitAfterFlush, () => {
  complain("havadis failed unexpectedly");
  exitAfterFlush(1);
});
