import { sql } from "kysely";
import type { Kysely } from "kysely";
import type { Database } from "./schema.ts";

/**
 * Runs `fn` against one consistent view of the database: one deferred read transaction on a single
 * pinned connection. In WAL mode the snapshot is fixed at the first read inside the transaction and
 * held until commit, while the worker keeps committing, so every statement of `fn` sees the same
 * edition (W2). The transaction is committed when `fn` returns and rolled back, with the error
 * rethrown, when it throws.
 *
 * It must not use `db.transaction()`: the project's dialect (openDb.ts) starts every Kysely
 * transaction with `begin immediate`, which a readonly connection cannot take and which would queue
 * behind the worker's write lock. The plain deferred `begin` here takes no lock at all.
 *
 * `fn` must use only the handle it is given: a query on `db` itself would wait for the pinned
 * connection and never finish.
 */
export async function inReadSnapshot<T>(
  db: Kysely<Database>,
  fn: (snap: Kysely<Database>) => Promise<T>,
): Promise<T> {
  return db.connection().execute(async (snap) => {
    await sql`begin`.execute(snap);
    let result: T;
    try {
      result = await fn(snap);
      await sql`commit`.execute(snap);
    } catch (err) {
      try {
        await sql`rollback`.execute(snap);
      } catch {
        // The original error is the one worth reporting; a failed rollback leaves nothing to undo.
      }
      throw err;
    }
    return result;
  });
}
