import type { Database } from "better-sqlite3";

/**
 * The newest migration this image ships. A test pins it to the highest NNNN file in
 * src/lib/db/migrations, so adding a migration without bumping it fails the suite.
 */
export const LATEST_SCHEMA_VERSION = 1;

export type SchemaStatus = "current" | "pending" | "ahead";

/**
 * Compares the database's highest recorded migration with the image's. No table means
 * "pending". Imports no fs and no migrator code, so web startup and /api/health can use it
 * inside the Next bundle; checksum verification stays the migrate command's job.
 */
export function schemaStatus(raw: Database, latest: number = LATEST_SCHEMA_VERSION): SchemaStatus {
  const table = raw.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  if (!table) return "pending";
  const row = raw.prepare("SELECT max(version) AS v FROM schema_migrations").get() as { v: number | null };
  const recorded = row.v ?? 0;
  if (recorded > latest) return "ahead";
  return recorded === latest ? "current" : "pending";
}
