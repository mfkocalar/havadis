import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { DbHandle } from "./openDb.ts";

/**
 * The project's own migration runner. Kysely's Migrator is neither transactional nor locked on
 * SQLite, so numbered NNNN_name.sql files are applied here, each inside one BEGIN IMMEDIATE
 * transaction together with its schema_migrations row.
 *
 * Imported only by the CLI, the worker and tests, never by src/app or anything the Next bundle
 * pulls in: bundled code has a different import.meta.url, so the migrations directory would not
 * resolve there.
 */

export type Migration = {
  version: number;
  name: string;
  file: string;
  sql: string;
  /** SHA-256 hex of the file's raw bytes, so a one-byte change (even CRLF) is a different checksum. */
  checksum: string;
};

export type BackupInfo = { fromVersion: number; toVersion: number };

export type MigrateOptions = {
  migrations: readonly Migration[];
  backup: (info: BackupInfo) => Promise<string | null>;
  now: () => number;
};

export type MigrateResult = { applied: number[]; backupPath: string | null };

export type MigrationRefusal = "checksum_mismatch" | "schema_ahead" | "backup_failed";

/** The runner refuses, before writing anything, rather than touch a database it cannot trust. */
export class MigrationRefused extends Error {
  readonly code: MigrationRefusal;

  constructor(code: MigrationRefusal, message: string) {
    super(message);
    this.name = "MigrationRefused";
    this.code = code;
  }
}

const MIGRATION_FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

const TIMESTAMP_GLOB =
  "'[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'";

/** Resolved inside the function, never at module load (see the header comment). */
export function loadMigrations(dir: URL = new URL("./migrations/", import.meta.url)): Migration[] {
  const migrations: Migration[] = [];
  for (const file of readdirSync(dir)) {
    const match = MIGRATION_FILE.exec(file);
    if (!match) continue;
    const bytes = readFileSync(new URL(file, dir));
    migrations.push({
      version: Number(match[1]),
      name: match[2]!,
      file,
      sql: bytes.toString("utf8"),
      checksum: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  migrations.sort((a, b) => a.version - b.version);
  for (let i = 1; i < migrations.length; i++) {
    if (migrations[i]!.version === migrations[i - 1]!.version) {
      throw new Error(`duplicate migration version ${migrations[i]!.version}`);
    }
  }
  return migrations;
}

export async function runMigrations(handle: DbHandle, opts: MigrateOptions): Promise<MigrateResult> {
  const { raw, db } = handle;

  const tableCount = (raw.prepare("SELECT count(*) AS n FROM sqlite_master").get() as { n: number }).n;
  const hasLedger = raw.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get() !== undefined;
  const recorded = hasLedger
    ? (raw.prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version").all() as { version: number; name: string; checksum: string }[])
    : [];

  const migrations = [...opts.migrations].sort((a, b) => a.version - b.version);
  const latest = migrations.length > 0 ? migrations[migrations.length - 1]!.version : 0;
  const fromVersion = recorded.length > 0 ? recorded[recorded.length - 1]!.version : 0;

  // 1. Refuse a database this image cannot vouch for, before any write.
  if (fromVersion > latest) {
    throw new MigrationRefused(
      "schema_ahead",
      `database schema v${fromVersion} is newer than this image (v${latest}); use an image at least as new as the database`,
    );
  }
  const byVersion = new Map(migrations.map((m) => [m.version, m]));
  for (const row of recorded) {
    const file = byVersion.get(row.version);
    if (!file) {
      throw new MigrationRefused(
        "checksum_mismatch",
        `migration ${String(row.version).padStart(4, "0")}_${row.name}.sql was applied to this database but is missing from this image`,
      );
    }
    if (file.checksum !== row.checksum) {
      throw new MigrationRefused(
        "checksum_mismatch",
        `migration ${file.file} differs from the version applied to this database (checksum mismatch); migration files must never change once shipped`,
      );
    }
  }

  // 2. Nothing pending: no backup, no write.
  const recordedVersions = new Set(recorded.map((r) => r.version));
  const pending = migrations.filter((m) => !recordedVersions.has(m.version));
  if (pending.length === 0) return { applied: [], backupPath: null };

  // 3. Back up first, through the seam. An empty database (version 0) has nothing to back up.
  const toVersion = pending[pending.length - 1]!.version;
  let backupPath: string | null;
  try {
    backupPath = await opts.backup({ fromVersion, toVersion });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new MigrationRefused("backup_failed", `backup before migrating v${fromVersion} to v${toVersion} failed: ${reason}`);
  }
  if (backupPath === null && fromVersion > 0) {
    throw new MigrationRefused("backup_failed", `backup before migrating v${fromVersion} to v${toVersion} returned no file`);
  }

  // 4. Apply.
  if (tableCount === 0) {
    // auto_vacuum only takes effect before the first table exists, and never inside a transaction.
    // openDb has already switched the journal to WAL, which initialises the file header, so the
    // setting needs a VACUUM (free on an empty database) to be recorded.
    raw.pragma("auto_vacuum = INCREMENTAL");
    raw.exec("VACUUM");
  }
  if (!hasLedger) {
    raw.exec(
      `CREATE TABLE schema_migrations (
         version    INTEGER PRIMARY KEY,
         name       TEXT NOT NULL,
         checksum   TEXT NOT NULL,
         applied_at TEXT NOT NULL CHECK (applied_at GLOB ${TIMESTAMP_GLOB})
       ) STRICT`,
    );
  }

  const applied: number[] = [];
  for (const migration of pending) {
    await db.transaction().execute(async (trx) => {
      raw.exec(migration.sql);
      await trx
        .insertInto("schema_migrations")
        .values({
          version: migration.version,
          name: migration.name,
          checksum: migration.checksum,
          applied_at: new Date(opts.now()).toISOString(),
        })
        .execute();
    });
    applied.push(migration.version);
  }
  return { applied, backupPath };
}
