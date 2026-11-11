import { chmodSync, existsSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openDb } from "./openDb.ts";
import type { DbHandle } from "./openDb.ts";

/**
 * Online, verified backups (PLAT-10, PLAT-12). The copy is made by SQLite's own backup API, never by
 * copying the main file and its -wal/-shm by hand, so it is consistent while web and worker keep
 * running. The driver itself is reached only through openDb (driver seam).
 */

export const BACKUP_CHOWN_HINT = "mkdir -p backups && sudo chown 65532:65532 backups (or use a named volume for /backups)";

const LABEL = /^[a-z0-9-]+$/;

/**
 * Checks, before anything else runs, that the backups directory exists, is a directory and accepts a
 * new file: a bind mount owned by the host user is not writable by uid 65532 on a Linux host (Pitfall 11).
 * The probe file is removed again.
 */
export function assertBackupDirWritable(dir: string): { ok: true } | { ok: false; message: string } {
  const fail = (): { ok: false; message: string } => ({
    ok: false,
    message: `Backups directory ${dir} is not writable by this container user (uid 65532). On the host run: ${BACKUP_CHOWN_HINT}`,
  });
  try {
    if (!statSync(dir).isDirectory()) return fail();
  } catch {
    return fail();
  }
  const probe = path.join(dir, `.havadis-write-probe-${process.pid}`);
  try {
    writeFileSync(probe, "", { flag: "w", mode: 0o600 });
  } catch {
    return fail();
  }
  try {
    unlinkSync(probe);
  } catch {
    // A probe that cannot be removed is still proof the directory accepted a write.
  }
  return { ok: true };
}

/** 2026-11-11T08:09:10.000Z becomes 20261111T080910Z. */
function compactUtc(now: number): string {
  return new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
}

function removeQuietly(file: string): void {
  for (const candidate of [file, `${file}-wal`, `${file}-shm`]) rmSync(candidate, { force: true });
}

/**
 * Writes `havadis-<UTC>-<label>.db` into `dir` and returns its path. The copy goes to a dot-prefixed
 * temporary file that already has mode 0600, is opened read-only and must pass PRAGMA integrity_check,
 * and only then is renamed into place. Any failure removes the temporary file. An existing backup of
 * the same name is never overwritten.
 */
export async function backupDatabase(handle: DbHandle, dir: string, now: number, label: string): Promise<string> {
  if (!LABEL.test(label)) throw new Error("backup label must match [a-z0-9-]+");
  const final = path.join(dir, `havadis-${compactUtc(now)}-${label}.db`);
  if (existsSync(final)) throw new Error("a backup with this name already exists");
  const temp = path.join(dir, `.havadis-${compactUtc(now)}-${label}.db.tmp-${process.pid}`);

  try {
    // Created private first, so the copy is never readable by others, not even briefly.
    writeFileSync(temp, "", { flag: "wx", mode: 0o600 });
    await handle.raw.backup(temp);

    // openDb itself throws on a file that is not a database, so opening is part of the check.
    let verdict: unknown = "unreadable";
    try {
      const copy = openDb(temp, "cli", { readonly: true });
      try {
        verdict = copy.raw.pragma("integrity_check", { simple: true });
      } finally {
        await copy.close();
      }
    } catch {
      verdict = "unreadable";
    }
    if (verdict !== "ok") throw new Error("backup failed integrity_check");

    // A read-only WAL connection may leave empty sidecars; the finished copy has no WAL content.
    rmSync(`${temp}-wal`, { force: true });
    rmSync(`${temp}-shm`, { force: true });
    chmodSync(temp, 0o600);
    renameSync(temp, final);
    return final;
  } catch (err) {
    removeQuietly(temp);
    throw err;
  }
}
