import BetterSqlite3 from "better-sqlite3";
import { CompiledQuery, Kysely, SqliteDialect, SqliteDriver } from "kysely";
import type { DatabaseConnection } from "kysely";
import { dataDir, dbFile } from "./paths.ts";
import type { Database as Schema } from "./schema.ts";

/**
 * The single driver module: the only non-test file in src that loads better-sqlite3 at runtime.
 * Every connection goes through openDb so the pragmas and the BEGIN IMMEDIATE dialect are uniform.
 */

export type DbRole = "worker" | "cli" | "web";

/** Web keeps a short timeout because busy_timeout blocks the single JS thread for its duration. */
export const BUSY_TIMEOUT_MS: Readonly<Record<DbRole, number>> = { worker: 5000, cli: 5000, web: 250 };

export type DbHandle = {
  db: Kysely<Schema>;
  raw: BetterSqlite3.Database;
  close(): Promise<void>;
};

/**
 * Kysely begins SQLite transactions with a deferred `begin`, so a read-then-write transaction fails
 * with SQLITE_BUSY at once (no busy wait) when another process holds the write lock.
 * `begin immediate` takes the write lock up front and honours busy_timeout.
 */
class ImmediateDriver extends SqliteDriver {
  override async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("begin immediate"));
  }
}

class ImmediateDialect extends SqliteDialect {
  #cfg: ConstructorParameters<typeof SqliteDialect>[0];

  constructor(cfg: ConstructorParameters<typeof SqliteDialect>[0]) {
    super(cfg);
    this.#cfg = cfg;
  }

  override createDriver() {
    return new ImmediateDriver(this.#cfg);
  }
}

export function openDb(file: string, role: DbRole, opts: { readonly?: boolean } = {}): DbHandle {
  const readonly = opts.readonly === true;
  const raw = new BetterSqlite3(file, readonly ? { readonly: true, fileMustExist: true } : {});
  // busy_timeout first so the journal-mode switch itself honours it.
  raw.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS[role]}`);
  if (!readonly) raw.pragma("journal_mode = WAL");
  raw.pragma("synchronous = NORMAL");
  raw.pragma("foreign_keys = ON");
  const db = new Kysely<Schema>({ dialect: new ImmediateDialect({ database: raw }) });
  return {
    db,
    raw,
    async close() {
      await db.destroy();
      // Kysely only closes the driver's handle once it has run a query through it.
      if (raw.open) raw.close();
    },
  };
}

const WEB_DB_KEY = Symbol.for("havadis.webDb");

/**
 * The web process's one read-only handle, stored on globalThis so every route bundle shares it.
 * Opened lazily on first call, never at module load, so `next build` never touches a database.
 */
export function getWebDb(env: NodeJS.ProcessEnv = process.env): DbHandle {
  const holder = globalThis as unknown as Record<symbol, DbHandle | undefined>;
  let handle = holder[WEB_DB_KEY];
  if (!handle) {
    handle = openDb(dbFile(dataDir(env)), "web", { readonly: true });
    holder[WEB_DB_KEY] = handle;
  }
  return handle;
}

export function isBusyError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && (code === "SQLITE_BUSY" || code.startsWith("SQLITE_BUSY_"));
}
