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
  // auto_vacuum only takes effect before the first table exists, and never inside a transaction.
  if (tableCount === 0) raw.pragma("auto_vacuum = INCREMENTAL");

  const hasLedger = raw.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
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

  const appliedVersions = new Set(
    (raw.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((r) => r.version),
  );
  const pending = opts.migrations.filter((m) => !appliedVersions.has(m.version));

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
  return { applied, backupPath: null };
}
