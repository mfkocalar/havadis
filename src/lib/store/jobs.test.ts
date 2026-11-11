import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "../db/openDb.ts";
import type { DbHandle } from "../db/openDb.ts";
import { loadMigrations, runMigrations } from "../db/migrator.ts";
import { seedBuiltins } from "../db/seed.ts";
import { abandonStaleRuns, beat, claimLease, markRunAbandoned, releaseLease, renewLease } from "./jobs.ts";

const T = Date.parse("2026-11-11T08:00:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();
const TTL = 600_000;

type Env = {
  dir: string;
  open: () => DbHandle;
  handle: DbHandle;
  job: () => { next_run_at: string; lease_owner: string | null; lease_until: string | null; last_started_at: string | null; last_status: string | null };
  cleanup: () => Promise<void>;
};

/** A migrated, seeded file database plus a way to open more handles on it (one per simulated worker). */
async function env(): Promise<Env> {
  const dir = mkdtempSync(path.join(tmpdir(), "havadis-jobs-"));
  const file = path.join(dir, "havadis.db");
  const opened: DbHandle[] = [];
  const open = (): DbHandle => {
    const h = openDb(file, "worker");
    opened.push(h);
    return h;
  };
  const handle = open();
  await runMigrations(handle, { migrations: loadMigrations(), backup: async () => null, now: () => T });
  await seedBuiltins(handle.db, [], T);
  return {
    dir,
    open,
    handle,
    job: () =>
      handle.raw.prepare("SELECT next_run_at, lease_owner, lease_until, last_started_at, last_status FROM job WHERE kind = 'ingest'").get() as ReturnType<Env["job"]>,
    cleanup: async () => {
      for (const h of opened) await h.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Moves the seeded job's due time and clears any lease, so each test states its own boundary. */
function setJob(e: Env, fields: { next?: string; leaseOwner?: string | null; leaseUntil?: string | null }): void {
  e.handle.raw
    .prepare("UPDATE job SET next_run_at = ?, lease_owner = ?, lease_until = ? WHERE kind = 'ingest'")
    .run(fields.next ?? iso(T), fields.leaseOwner ?? null, fields.leaseUntil ?? null);
}

test("PLAT-06/adjacency: a job whose next_run_at equals now is claimed, one a millisecond later is not", async () => {
  const e = await env();
  try {
    setJob(e, { next: iso(T) });
    assert.equal(await claimLease(e.handle.db, "a", iso(T), iso(T + TTL)), true);
    const row = e.job();
    assert.equal(row.lease_owner, "a");
    assert.equal(row.lease_until, iso(T + TTL));
    assert.equal(row.last_started_at, iso(T));

    await releaseLease(e.handle.db, "a", { status: "ok" });
    setJob(e, { next: iso(T + 1) });
    assert.equal(await claimLease(e.handle.db, "a", iso(T), iso(T + TTL)), false, "not due yet");
    assert.equal(e.job().lease_owner, null);
  } finally {
    await e.cleanup();
  }
});

test("PLAT-06/adjacency: a lease whose lease_until equals now is still held; one millisecond before now is expired", async () => {
  const e = await env();
  try {
    setJob(e, { leaseOwner: "a", leaseUntil: iso(T) });
    assert.equal(await claimLease(e.handle.db, "b", iso(T), iso(T + TTL)), false, "lease_until equal to now is held");
    assert.equal(e.job().lease_owner, "a");

    setJob(e, { leaseOwner: "a", leaseUntil: iso(T - 1) });
    assert.equal(await claimLease(e.handle.db, "b", iso(T), iso(T + TTL)), true, "lease_until one millisecond before now is expired");
    assert.equal(e.job().lease_owner, "b");
  } finally {
    await e.cleanup();
  }
});

test("PLAT-06/ordering: two connections claiming at the same instant, exactly one gets the lease", async () => {
  const e = await env();
  try {
    const other = e.open();
    setJob(e, { next: iso(T) });
    const results = await Promise.all([
      claimLease(e.handle.db, "worker-1", iso(T), iso(T + TTL)),
      claimLease(other.db, "worker-2", iso(T), iso(T + TTL)),
    ]);
    assert.equal(results.filter(Boolean).length, 1, "exactly one claim succeeds");
    const winner = results[0] ? "worker-1" : "worker-2";
    assert.equal(e.job().lease_owner, winner);
  } finally {
    await e.cleanup();
  }
});

test("renewLease: the owner moves lease_until; another owner changes nothing; an expired lease is not renewable", async () => {
  const e = await env();
  try {
    setJob(e, { next: iso(T) });
    assert.equal(await claimLease(e.handle.db, "a", iso(T), iso(T + TTL)), true);

    assert.equal(await renewLease(e.handle.db, "a", iso(T + 1000), iso(T + 1000 + TTL)), true);
    assert.equal(e.job().lease_until, iso(T + 1000 + TTL));

    assert.equal(await renewLease(e.handle.db, "b", iso(T + 2000), iso(T + 2000 + TTL)), false);
    assert.equal(e.job().lease_until, iso(T + 1000 + TTL), "another owner's renewal changes nothing");
    assert.equal(e.job().lease_owner, "a");

    // Held at the boundary (lease_until equal to now), lost one millisecond later.
    assert.equal(await renewLease(e.handle.db, "a", iso(T + 1000 + TTL), iso(T + 2000 + TTL)), true);
    assert.equal(await renewLease(e.handle.db, "a", iso(T + 2001 + TTL), iso(T + 9000 + TTL)), false);
    assert.equal(e.job().lease_until, iso(T + 2000 + TTL));
  } finally {
    await e.cleanup();
  }
});

test("releaseLease: clears the lease and sets next_run_at and last_status; without nextRunAtIso it keeps next_run_at", async () => {
  const e = await env();
  try {
    setJob(e, { next: iso(T) });
    assert.equal(await claimLease(e.handle.db, "a", iso(T), iso(T + TTL)), true);
    await releaseLease(e.handle.db, "a", { nextRunAtIso: iso(T + 900_000), status: "ok" });
    let row = e.job();
    assert.equal(row.lease_owner, null);
    assert.equal(row.lease_until, null);
    assert.equal(row.next_run_at, iso(T + 900_000));
    assert.equal(row.last_status, "ok");

    setJob(e, { next: iso(T + 5) });
    assert.equal(await claimLease(e.handle.db, "a", iso(T + 5), iso(T + 5 + TTL)), true);
    await releaseLease(e.handle.db, "a", { status: "stopped" });
    row = e.job();
    assert.equal(row.lease_owner, null);
    assert.equal(row.lease_until, null);
    assert.equal(row.next_run_at, iso(T + 5), "next_run_at is kept");
    assert.equal(row.last_status, "stopped");
  } finally {
    await e.cleanup();
  }
});

test("releaseLease: a worker that does not own the lease releases nothing", async () => {
  const e = await env();
  try {
    setJob(e, { next: iso(T) });
    assert.equal(await claimLease(e.handle.db, "a", iso(T), iso(T + TTL)), true);
    await releaseLease(e.handle.db, "b", { nextRunAtIso: iso(T + 1), status: "failed" });
    const row = e.job();
    assert.equal(row.lease_owner, "a");
    assert.equal(row.next_run_at, iso(T));
    assert.notEqual(row.last_status, "failed");
  } finally {
    await e.cleanup();
  }
});

test("abandonStaleRuns and markRunAbandoned: only a still-running row changes, and finished_at is set", async () => {
  const e = await env();
  try {
    const insert = e.handle.raw.prepare("INSERT INTO fetch_runs(started_at, status, \"trigger\") VALUES (?, ?, 'scheduled')");
    insert.run(iso(T - 3000), "ok");
    insert.run(iso(T - 2000), "failed");
    const running = Number(insert.run(iso(T - 1000), "running").lastInsertRowid);

    assert.equal(await markRunAbandoned(e.handle.db, running + 99, iso(T)), false, "an unknown id changes nothing");
    assert.equal(await markRunAbandoned(e.handle.db, running, iso(T)), true);
    assert.equal(await markRunAbandoned(e.handle.db, running, iso(T + 1)), false, "no longer running");
    const abandoned = e.handle.raw.prepare("SELECT status, finished_at FROM fetch_runs WHERE id = ?").get(running) as { status: string; finished_at: string };
    assert.deepEqual(abandoned, { status: "abandoned", finished_at: iso(T) }, "the second call did not move finished_at");

    const second = Number(insert.run(iso(T - 500), "running").lastInsertRowid);
    assert.equal(await abandonStaleRuns(e.handle.db, iso(T + 10)), 1);
    const rows = e.handle.raw.prepare("SELECT status, finished_at FROM fetch_runs ORDER BY id").all() as Array<{ status: string; finished_at: string | null }>;
    assert.deepEqual(rows.map((r) => r.status), ["ok", "failed", "abandoned", "abandoned"]);
    assert.equal(rows[3].finished_at, iso(T + 10));
    assert.equal(rows[0].finished_at, null, "an ok row is untouched");
    assert.ok(second > running);
    assert.equal(await abandonStaleRuns(e.handle.db, iso(T + 20)), 0, "nothing left to abandon");
  } finally {
    await e.cleanup();
  }
});

test("beat: upserts the single heartbeat row", async () => {
  const e = await env();
  try {
    const read = () => e.handle.raw.prepare("SELECT id, beat_at, state FROM worker_heartbeat").all();
    assert.deepEqual(read(), []);
    await beat(e.handle.db, iso(T), "idle");
    assert.deepEqual(read(), [{ id: 1, beat_at: iso(T), state: "idle" }]);
    await beat(e.handle.db, iso(T + 15_000), "running");
    assert.deepEqual(read(), [{ id: 1, beat_at: iso(T + 15_000), state: "running" }]);
    await beat(e.handle.db, iso(T + 30_000), "stopped");
    assert.deepEqual(read(), [{ id: 1, beat_at: iso(T + 30_000), state: "stopped" }]);
  } finally {
    await e.cleanup();
  }
});
