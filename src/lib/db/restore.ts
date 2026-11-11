import { chmodSync, copyFileSync, existsSync, lstatSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isBusyError, openDb } from "./openDb.ts";
import { LATEST_SCHEMA_VERSION, schemaStatus } from "./schemaVersion.ts";

/**
 * Guarded restore (PLAT-12, D-12). A backup is untrusted until it passes every check, and the
 * current database is never discarded: it is kept as <db>.pre-restore. The driver itself is reached
 * only through openDb (driver seam). Refusal messages are fixed text; they never echo file contents.
 */

export type RestoreRefusal =
  | "db_in_use"
  | "outside_backups"
  | "not_regular_file"
  | "not_found"
  | "integrity_failed"
  | "backup_newer_than_image"
  | "pre_restore_exists"
  | "live_unreadable";

export class RestoreRefused extends Error {
  readonly code: RestoreRefusal;

  constructor(code: RestoreRefusal, message: string) {
    super(message);
    this.name = "RestoreRefused";
    this.code = code;
  }
}

const IN_USE_MESSAGE = "web or worker is still running: stop them first (docker compose stop web worker)";

/**
 * Proves no other process holds the live database: with locking_mode EXCLUSIVE and no busy wait,
 * BEGIN EXCLUSIVE fails with SQLITE_BUSY while any other connection exists, even an idle one in WAL
 * mode. It is a kernel file lock, so it also holds across containers sharing the data volume. On
 * success the WAL is folded into the main file so that renaming the main file alone loses nothing.
 */
export async function assertNoOtherHolder(dataFile: string): Promise<void> {
  let handle;
  try {
    handle = openDb(dataFile, "cli");
  } catch (err) {
    if (isBusyError(err)) throw new RestoreRefused("db_in_use", IN_USE_MESSAGE);
    throw new RestoreRefused(
      "live_unreadable",
      "the current database could not be opened as a database, so nothing can show that it is not in use; if it is corrupt, stop web and worker, move havadis.db and its -wal and -shm files out of the data directory and run restore again",
    );
  }
  try {
    handle.raw.pragma("locking_mode = EXCLUSIVE");
    handle.raw.pragma("busy_timeout = 0");
    try {
      handle.raw.exec("BEGIN EXCLUSIVE");
      handle.raw.exec("COMMIT");
    } catch (err) {
      if (isBusyError(err)) throw new RestoreRefused("db_in_use", IN_USE_MESSAGE);
      throw err;
    }
    handle.raw.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    await handle.close();
  }
}

/**
 * Resolves the argument inside the backups directory. A bare name is read from that directory; every
 * other form must still land inside it once the parent directory's symlinks are resolved, and the
 * final component must be a regular file, never a symlink.
 */
function resolveBackup(file: string, backupsDir: string): string {
  let realBackups: string;
  try {
    realBackups = realpathSync(backupsDir);
  } catch {
    throw new RestoreRefused("not_found", "the backups directory does not exist");
  }
  const requested = path.isAbsolute(file) ? file : path.join(backupsDir, file);
  let realParent: string;
  try {
    realParent = realpathSync(path.dirname(requested));
  } catch {
    throw new RestoreRefused("not_found", "backup file not found");
  }
  const full = path.join(realParent, path.basename(requested));
  const relative = path.relative(realBackups, full);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new RestoreRefused("outside_backups", "the backup must be a file inside the backups directory; copy it there first");
  }
  let stat;
  try {
    stat = lstatSync(full);
  } catch {
    throw new RestoreRefused("not_found", "backup file not found");
  }
  if (!stat.isFile()) throw new RestoreRefused("not_regular_file", "the backup must be a regular file, not a symlink or a directory");
  return full;
}

/**
 * Order: resolve and validate the argument, integrity_check the backup, refuse a backup newer than the
 * image, refuse over an existing .pre-restore, prove no other process holds the live file, keep the
 * live file as .pre-restore, remove its sidecars, copy the backup in through a private temp file.
 * If installing fails after the live file was moved, it is moved back.
 */
export async function restoreDatabase(opts: {
  file: string;
  dataFile: string;
  backupsDir: string;
  latest?: number;
}): Promise<{ restoredFrom: string; preRestore: string | null }> {
  const latest = opts.latest ?? LATEST_SCHEMA_VERSION;
  const source = resolveBackup(opts.file, opts.backupsDir);

  let status: ReturnType<typeof schemaStatus> | "unreadable" = "unreadable";
  let verdict: unknown = "unreadable";
  // Opening a WAL-mode file read-only leaves -wal/-shm beside it; remove only the ones this check created.
  const sidecars = [`${source}-wal`, `${source}-shm`].filter((f) => !existsSync(f));
  try {
    const backup = openDb(source, "cli", { readonly: true });
    try {
      verdict = backup.raw.pragma("integrity_check", { simple: true });
      if (verdict === "ok") status = schemaStatus(backup.raw, latest);
    } finally {
      await backup.close();
    }
  } catch {
    verdict = "unreadable";
  }
  for (const f of sidecars) rmSync(f, { force: true });
  if (verdict !== "ok" || status === "unreadable") {
    throw new RestoreRefused("integrity_failed", "the backup failed PRAGMA integrity_check; nothing was changed");
  }
  if (status === "ahead") {
    throw new RestoreRefused("backup_newer_than_image", "the backup comes from a newer version than this image; use an image at least as new as the backup");
  }

  const preRestore = `${opts.dataFile}.pre-restore`;
  if (existsSync(preRestore)) {
    throw new RestoreRefused("pre_restore_exists", `${path.basename(preRestore)} already exists; move or delete it first so the current database is not lost`);
  }

  const hadLive = existsSync(opts.dataFile);
  if (hadLive) await assertNoOtherHolder(opts.dataFile);

  const temp = `${opts.dataFile}.restore-tmp-${process.pid}`;
  try {
    if (hadLive) renameSync(opts.dataFile, preRestore);
    // Sidecars belong to the database that was just moved aside (its WAL was folded in above).
    rmSync(`${opts.dataFile}-wal`, { force: true });
    rmSync(`${opts.dataFile}-shm`, { force: true });
    writeFileSync(temp, "", { flag: "wx", mode: 0o600 });
    copyFileSync(source, temp);
    chmodSync(temp, 0o600);
    renameSync(temp, opts.dataFile);
  } catch (err) {
    rmSync(temp, { force: true });
    if (hadLive && !existsSync(opts.dataFile) && existsSync(preRestore)) renameSync(preRestore, opts.dataFile);
    throw err;
  }
  return { restoredFrom: source, preRestore: hadLive ? preRestore : null };
}
