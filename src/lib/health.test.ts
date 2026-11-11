import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "./db/openDb.ts";
import type { DbHandle } from "./db/openDb.ts";
import { loadMigrations, runMigrations } from "./db/migrator.ts";
import { beat } from "./store/jobs.ts";
import { createLogger } from "./log/logger.ts";
import { computeHealth, workerBand } from "./health.ts";
import type { HealthBody } from "./health.ts";
import { HEALTH_STALE_FACTOR, WORKER_HEARTBEAT_MS } from "./config/env.ts";

/**
 * /api/health's decision logic against real file databases: the worker band boundary (PLAT-11), the
 * schema status mapping, the open-write-transaction read (a WAL reader never waits for the writer)
 * and the SQLITE_BUSY mapping with its fixed log line. The body is pinned to its four keys.
 */

const T = Date.parse("2026-11-11T08:00:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();
const STALE_AFTER_MS = HEALTH_STALE_FACTOR * WORKER_HEARTBEAT_MS;

type Env = {
  dir: string;
  file: string;
  worker: DbHandle;
  web: () => DbHandle;
  cleanup: () => Promise<void>;
};

/** A migrated database (worker handle) plus readonly web-role handles opened the way getWebDb opens them. */
async function env(opts: { migrate?: boolean } = {}): Promise<Env> {
  const dir = mkdtempSync(path.join(tmpdir(), "havadis-health-"));
  const file = path.join(dir, "havadis.db");
  const opened: DbHandle[] = [];
  const worker = openDb(file, "worker");
  opened.push(worker);
  if (opts.migrate !== false) {
    await runMigrations(worker, { migrations: loadMigrations(), backup: async () => null, now: () => T });
  }
  return {
    dir,
    file,
    worker,
    web: () => {
      const h = openDb(file, "web", { readonly: true });
      opened.push(h);
      return h;
    },
    cleanup: async () => {
      for (const h of opened) await h.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function capture(): { lines: string[]; log: ReturnType<typeof createLogger> } {
  const lines: string[] = [];
  return { lines, log: createLogger({ level: "debug", write: (l) => lines.push(l), now: () => T }) };
}

const KEYS = ["schema", "status", "web", "worker"];

test("workerBand: no beat is waiting; exactly three intervals old is ok; one millisecond more is stale", () => {
  assert.equal(workerBand(null, T), "waiting");
  assert.equal(workerBand(iso(T), T), "ok");
  assert.equal(workerBand(iso(T - STALE_AFTER_MS), T), "ok");
  assert.equal(STALE_AFTER_MS, 45_000);
  assert.equal(workerBand(iso(T - 45_000), T), "ok");
  assert.equal(workerBand(iso(T - 45_001), T), "stale");
});

test("workerBand: a beat stamped slightly in the future (clock skew) is ok, not stale", () => {
  assert.equal(workerBand(iso(T + 5_000), T), "ok");
});

test("a current schema with a fresh beat is 200 ok across the board", async () => {
  const e = await env();
  try {
    await beat(e.worker.db, iso(T - 1_000), "idle");
    const { httpStatus, body } = await computeHealth(e.web(), T);
    assert.equal(httpStatus, 200);
    assert.deepEqual(body, { status: "ok", web: "ok", worker: "ok", schema: "ok" });
  } finally {
    await e.cleanup();
  }
});

test("the beat boundary reads through the database: 45000 ms old is ok, 45001 ms is degraded with 200", async () => {
  const e = await env();
  try {
    await beat(e.worker.db, iso(T - 45_000), "running");
    const web = e.web();
    assert.deepEqual((await computeHealth(web, T)).body.worker, "ok");
    const late = await computeHealth(web, T + 1);
    assert.equal(late.httpStatus, 200);
    assert.deepEqual(late.body, { status: "degraded", web: "ok", worker: "stale", schema: "ok" });
  } finally {
    await e.cleanup();
  }
});

test("no heartbeat row yet is 200 degraded with worker waiting", async () => {
  const e = await env();
  try {
    const { httpStatus, body } = await computeHealth(e.web(), T);
    assert.equal(httpStatus, 200);
    assert.deepEqual(body, { status: "degraded", web: "ok", worker: "waiting", schema: "ok" });
  } finally {
    await e.cleanup();
  }
});

test("a schema ahead of the image is 503 unavailable with schema ahead and the worker unknown", async () => {
  const e = await env();
  try {
    await beat(e.worker.db, iso(T), "idle");
    e.worker.raw
      .prepare("INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)")
      .run(9999, "from_the_future", "0".repeat(64), iso(T));
    const { httpStatus, body } = await computeHealth(e.web(), T);
    assert.equal(httpStatus, 503);
    assert.deepEqual(body, { status: "unavailable", web: "ok", worker: "unknown", schema: "ahead" });
  } finally {
    await e.cleanup();
  }
});

test("a database that was never migrated is 503 unavailable with schema pending", async () => {
  const e = await env({ migrate: false });
  try {
    const { httpStatus, body } = await computeHealth(e.web(), T);
    assert.equal(httpStatus, 503);
    assert.deepEqual(body, { status: "unavailable", web: "ok", worker: "unknown", schema: "pending" });
  } finally {
    await e.cleanup();
  }
});

test("PLAT-11/concurrency: while another connection holds an open write transaction the read answers 200 without waiting", async () => {
  const e = await env();
  try {
    await beat(e.worker.db, iso(T), "running");
    const web = e.web();
    const writer = openDb(e.file, "worker");
    try {
      writer.raw.exec("BEGIN IMMEDIATE");
      writer.raw.prepare("UPDATE worker_heartbeat SET state = 'idle' WHERE id = 1").run();
      const started = Date.now();
      const { httpStatus, body } = await computeHealth(web, T);
      const elapsed = Date.now() - started;
      assert.equal(httpStatus, 200);
      assert.deepEqual(body, { status: "ok", web: "ok", worker: "ok", schema: "ok" });
      assert.ok(elapsed < 200, `the read took ${elapsed} ms; a WAL reader must not wait for the writer`);
      writer.raw.exec("ROLLBACK");
    } finally {
      await writer.close();
    }
  } finally {
    await e.cleanup();
  }
});

/** A handle whose driver throws `err` from the named side (the raw schema probe or the Kysely heartbeat read). */
function throwing(real: DbHandle, side: "raw" | "db", err: Error): DbHandle {
  const boom = () => {
    throw err;
  };
  if (side === "raw") {
    return { ...real, raw: new Proxy(real.raw, { get: (target, prop) => (prop === "prepare" ? boom : Reflect.get(target, prop)) }) };
  }
  return { ...real, db: new Proxy(real.db, { get: (target, prop) => (prop === "selectFrom" ? boom : Reflect.get(target, prop)) }) };
}

for (const side of ["raw", "db"] as const) {
  test(`SQLITE_BUSY from the ${side} side is 503 unavailable with the worker and schema unknown and one web_db_busy line without the error text`, async () => {
    const e = await env();
    try {
      const busy = Object.assign(new Error("database is locked: /secret/path/havadis.db"), { code: "SQLITE_BUSY" });
      const { lines, log } = capture();
      const { httpStatus, body } = await computeHealth(throwing(e.web(), side, busy), T, log);
      assert.equal(httpStatus, 503);
      assert.deepEqual(body, { status: "unavailable", web: "ok", worker: "unknown", schema: "unknown" });
      assert.equal(lines.length, 1);
      const line = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
      assert.equal(line.event, "web_db_busy");
      assert.equal(line.route, "/api/health");
      assert.ok(!lines[0]?.includes("/secret/path"), "the driver message must not reach the log");
      assert.ok(!JSON.stringify(body).includes("/secret/path"));
    } finally {
      await e.cleanup();
    }
  });
}

test("any other database error is the same 503 unavailable body and carries no error text", async () => {
  const e = await env();
  try {
    const broken = Object.assign(new Error("disk I/O error at /secret/path/havadis.db"), { code: "SQLITE_IOERR" });
    const { lines, log } = capture();
    const { httpStatus, body } = await computeHealth(throwing(e.web(), "raw", broken), T, log);
    assert.equal(httpStatus, 503);
    assert.deepEqual(body, { status: "unavailable", web: "ok", worker: "unknown", schema: "unknown" });
    assert.ok(!JSON.stringify(body).includes("/secret/path"));
    assert.ok(lines.every((l) => !l.includes("/secret/path")));
  } finally {
    await e.cleanup();
  }
});

test("T-14-33: every answer serializes to exactly the four keys with fixed values and nothing else", async () => {
  const e = await env();
  try {
    await beat(e.worker.db, iso(T), "idle");
    const fixed: Record<keyof HealthBody, readonly string[]> = {
      status: ["ok", "degraded", "unavailable"],
      web: ["ok"],
      worker: ["ok", "stale", "waiting", "unknown"],
      schema: ["ok", "ahead", "pending", "unknown"],
    };
    const bodies = [
      (await computeHealth(e.web(), T)).body,
      (await computeHealth(e.web(), T + 3_600_000)).body,
      (await computeHealth(throwing(e.web(), "raw", Object.assign(new Error("x"), { code: "SQLITE_BUSY" })), T, capture().log)).body,
    ];
    for (const body of bodies) {
      const parsed = JSON.parse(JSON.stringify(body)) as Record<string, string>;
      assert.deepEqual(Object.keys(parsed).sort(), KEYS);
      for (const key of KEYS) {
        assert.ok(fixed[key as keyof HealthBody].includes(parsed[key] ?? ""), `${key}=${parsed[key]}`);
      }
    }
  } finally {
    await e.cleanup();
  }
});
