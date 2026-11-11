import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "../db/openDb.ts";
import type { DbHandle } from "../db/openDb.ts";
import { loadMigrations, runMigrations } from "../db/migrator.ts";
import { seedBuiltins } from "../db/seed.ts";
import { createLogger } from "../log/logger.ts";
import type { LogLevel } from "../log/logger.ts";
import { INTERVAL_JITTER_RATIO, LEASE_TTL_MS, WORKER_HEARTBEAT_MS, WORKER_START_JITTER_MS, WORKER_TICK_MS } from "../config/env.ts";
import { beginRun } from "../store/ingest.ts";
import type { FetchErrorCode } from "../reasonCodes.ts";
import type { FeedFetchResult } from "../pipeline/feedResult.ts";
import type { SourceConfig } from "../types.ts";
import { makeArticle, makeSource } from "../../../test/fixtures/makeArticle.ts";
import { runIngestCycle } from "./cycle.ts";
import type { CycleReport, CycleStage } from "./cycle.ts";
import type { EnrichReport } from "./enrichRefresh.ts";
import { createWorker } from "./runner.ts";

const T = Date.parse("2026-11-11T08:00:00.000Z");
const INTERVAL = 15 * 60_000;
const iso = (ms: number): string => new Date(ms).toISOString();

type Line = Record<string, string | number | boolean | null>;
type JobRow = { next_run_at: string; lease_owner: string | null; lease_until: string | null; last_status: string | null };

type Env = {
  open: () => DbHandle;
  handle: DbHandle;
  rows: (sql: string) => Array<Record<string, unknown>>;
  job: () => JobRow;
  cleanup: () => Promise<void>;
};

/** A migrated file database with the ingest job seeded (due since 1970) and a trigger that logs every lease_until change. */
async function env(sources: readonly SourceConfig[] = []): Promise<Env> {
  const dir = mkdtempSync(path.join(tmpdir(), "havadis-runner-"));
  const file = path.join(dir, "havadis.db");
  const opened: DbHandle[] = [];
  const open = (): DbHandle => {
    const h = openDb(file, "worker");
    opened.push(h);
    return h;
  };
  const handle = open();
  await runMigrations(handle, { migrations: loadMigrations(), backup: async () => null, now: () => T });
  await seedBuiltins(handle.db, sources, T);
  handle.raw.exec(`
    CREATE TABLE lease_log (n INTEGER PRIMARY KEY, lease_until TEXT);
    CREATE TRIGGER lease_log_t AFTER UPDATE OF lease_until ON job BEGIN INSERT INTO lease_log(lease_until) VALUES (new.lease_until); END;
  `);
  return {
    open,
    handle,
    rows: (sql) => handle.raw.prepare(sql).all() as Array<Record<string, unknown>>,
    job: () => handle.raw.prepare("SELECT next_run_at, lease_owner, lease_until, last_status FROM job WHERE kind = 'ingest'").get() as JobRow,
    cleanup: async () => {
      for (const h of opened) if (h.raw.open) await h.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Lets the promise chains of the runner and Kysely run; setImmediate is not mocked. */
async function settle(): Promise<void> {
  for (let i = 0; i < 25; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function report(runId: number, status: CycleReport["status"] = "ok", extra: Partial<CycleReport> = {}): CycleReport {
  return { runId, status, sourcesTotal: 0, sourcesOk: 0, articlesNew: 0, articlesSeen: 0, storiesCreated: 0, storiesMerged: 0, outcomes: [], ...extra };
}

const ENRICH: EnrichReport = { kev: "fresh", requested: 0, ssvcLookups: 0, epssUnavailable: 0, ssvcUnavailable: 0 };

/** Common wiring: an injected mutable clock and random, captured log lines, and mock timers. */
function rig(level: LogLevel = "debug") {
  const state = { now: T, random: 0.5 };
  const lines: Line[] = [];
  const raw: string[] = [];
  const log = createLogger({ level, write: (line) => (raw.push(line), lines.push(JSON.parse(line) as Line)), now: () => state.now });
  const events = (name: string) => lines.filter((l) => l.event === name);
  return { state, lines, raw, log, events, clock: () => state.now, random: () => state.random };
}

function timers() {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
}

/** A runCycle that opens a real run, then lets the test script what happens. */
function scripted(
  handle: DbHandle,
  clock: () => number,
  body: (ctx: { runId: number; onStage: (stage: CycleStage, runId: number) => Promise<void> }) => Promise<CycleReport | void>,
) {
  const calls: number[] = [];
  const runCycle = async (db: DbHandle["db"], now: number, onStage: (stage: CycleStage, runId: number) => Promise<void>): Promise<CycleReport> => {
    const runId = await beginRun(db, iso(now), "scheduled");
    calls.push(runId);
    await onStage("started", runId);
    const result = await body({ runId, onStage });
    if (result) return result;
    handle.raw.prepare("UPDATE fetch_runs SET status = 'ok', finished_at = ? WHERE id = ? AND status = 'running'").run(iso(clock()), runId);
    return report(runId);
  };
  return { runCycle, calls };
}

test("start beats idle at once, the first claim comes after random() * 5000 ms, ticks every 15000 ms, and a tick during a cycle does nothing", async () => {
  timers();
  const e = await env();
  try {
    const r = rig();
    r.state.random = 0.4;
    const gate = deferred<void>();
    const { runCycle, calls } = scripted(e.handle, r.clock, async () => gate.promise);
    const w = createWorker({
      db: e.handle.db,
      owner: "worker-a",
      clock: r.clock,
      random: r.random,
      config: { ingestIntervalMs: INTERVAL },
      runCycle,
      runEnrichment: async () => ENRICH,
      log: r.log,
    });
    w.start();
    await settle();
    assert.deepEqual(e.rows("SELECT id, beat_at, state FROM worker_heartbeat"), [{ id: 1, beat_at: iso(T), state: "idle" }]);

    const jitter = 0.4 * WORKER_START_JITTER_MS;
    mock.timers.tick(jitter - 1);
    await settle();
    assert.equal(calls.length, 0, "no claim before the start jitter has passed");
    mock.timers.tick(1);
    await settle();
    assert.equal(calls.length, 1, "the first claim happens after random() * 5000 ms");
    assert.equal(e.job().lease_owner, "worker-a");
    assert.equal(r.events("lease_claimed").length, 1);

    mock.timers.tick(WORKER_TICK_MS);
    await settle();
    mock.timers.tick(WORKER_TICK_MS);
    await settle();
    assert.equal(calls.length, 1, "a tick while a cycle is in flight starts nothing");
    assert.equal(r.events("lease_claimed").length, 1);

    gate.resolve();
    await w.idle();
    assert.equal(e.job().lease_owner, null);
    await w.stop();
  } finally {
    mock.timers.reset();
    await e.cleanup();
  }
});

test("a job that is not due yet is not claimed; it is claimed on the tick after it becomes due", async () => {
  timers();
  const e = await env();
  try {
    const r = rig();
    r.state.random = 0;
    e.handle.raw.prepare("UPDATE job SET next_run_at = ?").run(iso(T + 20_000));
    const { runCycle, calls } = scripted(e.handle, r.clock, async () => undefined);
    const w = createWorker({ db: e.handle.db, owner: "w", clock: r.clock, random: r.random, config: { ingestIntervalMs: INTERVAL }, runCycle, runEnrichment: async () => ENRICH, log: r.log });
    w.start();
    mock.timers.tick(WORKER_START_JITTER_MS);
    await settle();
    assert.equal(calls.length, 0, "not due");
    r.state.now = T + 20_000;
    mock.timers.tick(WORKER_TICK_MS);
    await settle();
    assert.equal(calls.length, 1, "due");
    await w.idle();
    await w.stop();
  } finally {
    mock.timers.reset();
    await e.cleanup();
  }
});

test("after a cycle next_run_at is the finish time plus the interval spread by plus or minus 10%: random 0 gives 0.9x, random 1 gives 1.1x", async () => {
  timers();
  for (const [random, factor] of [
    [0, 1 - INTERVAL_JITTER_RATIO],
    [1, 1 + INTERVAL_JITTER_RATIO],
  ] as const) {
    const e = await env();
    try {
      const r = rig();
      r.state.random = random;
      const { runCycle } = scripted(e.handle, r.clock, async () => undefined);
      const w = createWorker({ db: e.handle.db, owner: "w", clock: r.clock, random: r.random, config: { ingestIntervalMs: INTERVAL }, runCycle, runEnrichment: async () => ENRICH, log: r.log });
      w.start();
      mock.timers.tick(WORKER_START_JITTER_MS);
      await w.idle();
      await settle();
      await w.idle();
      const job = e.job();
      assert.equal(job.next_run_at, iso(T + Math.round(INTERVAL * factor)), `random ${random}`);
      assert.equal(job.last_status, "ok");
      assert.equal(job.lease_owner, null);
      assert.equal(job.lease_until, null);
      await w.stop();
    } finally {
      await e.cleanup();
    }
  }
  mock.timers.reset();
});

test("renewLease runs at the started, fetched and written stages and after enrichment, and enrichment gets the run id", async () => {
  timers();
  const e = await env();
  try {
    const r = rig();
    const { runCycle, calls } = scripted(e.handle, r.clock, async ({ runId, onStage }) => {
      r.state.now += 1000;
      await onStage("fetched", runId);
      r.state.now += 1000;
      await onStage("written", runId);
    });
    const enrichCalls: number[] = [];
    const w = createWorker({
      db: e.handle.db,
      owner: "w",
      clock: r.clock,
      random: r.random,
      config: { ingestIntervalMs: INTERVAL },
      runCycle: async (db, now, onStage) => {
        // The claim stamped T + TTL; the started stage runs next, one second later.
        r.state.now += 1000;
        return runCycle(db, now, onStage);
      },
      runEnrichment: async (_db, clock, runId) => {
        r.state.now += 1000;
        enrichCalls.push(runId);
        assert.equal(clock(), r.state.now, "enrichment gets the worker's clock");
        return ENRICH;
      },
      log: r.log,
    });
    w.start();
    mock.timers.tick(WORKER_START_JITTER_MS);
    await w.idle();
    await settle();
    await w.idle();
    assert.deepEqual(enrichCalls, calls);
    const log = e.rows("SELECT lease_until FROM lease_log ORDER BY n").map((row) => row.lease_until);
    assert.deepEqual(log, [
      iso(T + LEASE_TTL_MS), // claim
      iso(T + 1000 + LEASE_TTL_MS), // started
      iso(T + 2000 + LEASE_TTL_MS), // fetched
      iso(T + 3000 + LEASE_TTL_MS), // written
      iso(T + 4000 + LEASE_TTL_MS), // after enrichment
      null, // release
    ]);
    await w.stop();
  } finally {
    mock.timers.reset();
    await e.cleanup();
  }
});

test("when the lease is lost the cycle aborts before its write transaction, the run is recorded failed and enrichment does not run", async () => {
  timers();
  const SRC = makeSource({ id: "src-a", name: "Source A", family: "fam-a", url: "https://host-a.test/feed.xml" });
  const e = await env([SRC]);
  try {
    const r = rig();
    let enriched = 0;
    const w = createWorker({
      db: e.handle.db,
      owner: "w",
      clock: r.clock,
      random: r.random,
      config: { ingestIntervalMs: INTERVAL },
      runCycle: (db, now, onStage) =>
        runIngestCycle(
          db,
          {
            sources: [SRC],
            onStage,
            clock: r.clock,
            fetchFeed: async () => {
              // Another worker takes the job while this one is fetching.
              e.handle.raw.prepare("UPDATE job SET lease_owner = 'other', lease_until = ?").run(iso(T + 2 * LEASE_TTL_MS));
              return { status: "ok", articles: [makeArticle({ title: "Alpha ransomware campaign", url: "https://a.test/1", source: SRC.name, sourceTier: SRC.tier, sourceType: SRC.sourceType, publishedAt: iso(T - 3_600_000) })], validators: { etag: null, lastModified: null }, httpStatus: 200 };
            },
          },
          now,
        ),
      runEnrichment: async () => ((enriched += 1), ENRICH),
      log: r.log,
    });
    w.start();
    mock.timers.tick(WORKER_START_JITTER_MS);
    await w.idle();
    await settle();
    await w.idle();
    assert.deepEqual(e.rows("SELECT status FROM fetch_runs"), [{ status: "failed" }]);
    assert.deepEqual(e.rows("SELECT count(*) AS n FROM articles"), [{ n: 0 }], "nothing was written");
    assert.deepEqual(e.rows("SELECT count(*) AS n FROM source_fetches"), [{ n: 0 }]);
    assert.equal(enriched, 0);
    const failed = r.events("cycle_failed");
    assert.equal(failed.length, 1);
    assert.equal(failed[0].code, "lease_lost");
    assert.equal(e.job().lease_owner, "other", "the other worker's lease is not released by this one");
    assert.equal(e.job().next_run_at, "1970-01-01T00:00:00.000Z", "and the schedule is not moved");
    await w.stop();
  } finally {
    mock.timers.reset();
    await e.cleanup();
  }
});

test("stop() during a cycle abandons that run, releases the lease keeping next_run_at, beats stopped and does not wait for the cycle", async () => {
  timers();
  const e = await env();
  try {
    const r = rig();
    const gate = deferred<void>();
    let enriched = 0;
    const { runCycle, calls } = scripted(e.handle, r.clock, async () => gate.promise);
    const w = createWorker({ db: e.handle.db, owner: "w", clock: r.clock, random: r.random, config: { ingestIntervalMs: INTERVAL }, runCycle, runEnrichment: async () => ((enriched += 1), ENRICH), log: r.log });
    w.start();
    mock.timers.tick(WORKER_START_JITTER_MS / 2);
    await settle();
    assert.equal(calls.length, 1);

    let stopped = false;
    void w.stop().then(() => (stopped = true));
    await settle();
    assert.equal(stopped, true, "stop resolved while the cycle is still in flight");
    assert.deepEqual(e.rows("SELECT status FROM fetch_runs"), [{ status: "abandoned" }]);
    const job = e.job();
    assert.equal(job.lease_owner, null);
    assert.equal(job.lease_until, null);
    assert.equal(job.next_run_at, "1970-01-01T00:00:00.000Z", "next_run_at is kept");
    assert.deepEqual(e.rows("SELECT state FROM worker_heartbeat"), [{ state: "stopped" }]);

    mock.timers.tick(WORKER_TICK_MS * 3);
    await settle();
    assert.equal(calls.length, 1, "a stopped worker does not tick");

    const linesBefore = r.lines.length;
    gate.resolve();
    await w.idle();
    await settle();
    assert.equal(r.lines.length, linesBefore, "the abandoned cycle logs nothing after stop");
    assert.equal(enriched, 0, "and does not enrich");
    assert.deepEqual(e.rows("SELECT status FROM fetch_runs"), [{ status: "abandoned" }], "stop() cannot be overwritten by the late cycle");
    assert.deepEqual(e.rows("SELECT state FROM worker_heartbeat"), [{ state: "stopped" }]);
    await w.stop();
  } finally {
    mock.timers.reset();
    await e.cleanup();
  }
});

test("stop() while idle beats stopped and clears the timers", async () => {
  timers();
  const e = await env();
  try {
    const r = rig();
    const { runCycle, calls } = scripted(e.handle, r.clock, async () => undefined);
    const w = createWorker({ db: e.handle.db, owner: "w", clock: r.clock, random: r.random, config: { ingestIntervalMs: INTERVAL }, runCycle, runEnrichment: async () => ENRICH, log: r.log });
    w.start();
    await settle();
    await w.stop();
    assert.deepEqual(e.rows("SELECT state FROM worker_heartbeat"), [{ state: "stopped" }]);
    mock.timers.tick(WORKER_START_JITTER_MS + WORKER_TICK_MS * 2);
    await settle();
    assert.equal(calls.length, 0);
    assert.deepEqual(e.rows("SELECT state FROM worker_heartbeat"), [{ state: "stopped" }], "no heartbeat after stop");
  } finally {
    mock.timers.reset();
    await e.cleanup();
  }
});

test("crash: a worker that claims and never releases blocks the job until its lease expires; the next claim abandons its running row", async () => {
  timers();
  const e = await env();
  const second = e.open();
  try {
    const r = rig();
    r.state.random = 0;
    const hang = deferred<void>();
    const a = scripted(e.handle, r.clock, async () => hang.promise);
    const b = scripted(second, r.clock, async () => undefined);
    const wa = createWorker({ db: e.handle.db, owner: "worker-a", clock: r.clock, random: r.random, config: { ingestIntervalMs: INTERVAL }, runCycle: a.runCycle, runEnrichment: async () => ENRICH, log: r.log });
    wa.start();
    mock.timers.tick(WORKER_START_JITTER_MS);
    await settle();
    assert.equal(a.calls.length, 1, "A claimed and is stuck in its cycle");
    const leaseUntil = Date.parse(e.job().lease_until!);
    assert.equal(leaseUntil, T + LEASE_TTL_MS);

    const wb = createWorker({ db: second.db, owner: "worker-b", clock: r.clock, random: r.random, config: { ingestIntervalMs: INTERVAL }, runCycle: b.runCycle, runEnrichment: async () => ENRICH, log: r.log });
    wb.start();
    mock.timers.tick(WORKER_START_JITTER_MS);
    await settle();
    assert.equal(b.calls.length, 0, "B cannot claim while A's lease is live");

    r.state.now = leaseUntil;
    mock.timers.tick(WORKER_TICK_MS);
    await settle();
    assert.equal(b.calls.length, 0, "a lease whose lease_until equals now is still held");

    r.state.now = leaseUntil + 1;
    mock.timers.tick(WORKER_TICK_MS);
    await wb.idle();
    await settle();
    await wb.idle();
    assert.equal(b.calls.length, 1, "B claims once the clock has passed lease_until");
    const runs = e.rows("SELECT id, status FROM fetch_runs ORDER BY id");
    assert.deepEqual(runs.map((x) => x.status), ["abandoned", "ok"], "A's orphaned running row is abandoned, B's cycle ran");
    assert.equal(r.events("lease_claimed").length, 2);
    assert.equal(r.events("lease_claimed")[1].abandoned_runs, 1);

    await wb.stop();
    await wa.stop();
    hang.resolve();
  } finally {
    mock.timers.reset();
    await e.cleanup();
  }
});

test("a throwing cycle logs cycle_failed with a fixed code, records the run failed and releases with now plus the interval", async () => {
  timers();
  for (const [thrown, code] of [
    [new Error("boom: upstream said https://10.1.2.3/secret"), "cycle_error"],
    [Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" }), "db_busy"],
  ] as const) {
    const e = await env();
    try {
      const r = rig();
      r.state.random = 1;
      const { runCycle, calls } = scripted(e.handle, r.clock, async () => {
        throw thrown;
      });
      const w = createWorker({ db: e.handle.db, owner: "w", clock: r.clock, random: r.random, config: { ingestIntervalMs: INTERVAL }, runCycle, runEnrichment: async () => ENRICH, log: r.log });
      w.start();
      mock.timers.tick(WORKER_START_JITTER_MS);
      await w.idle();
      await settle();
      await w.idle();
      assert.equal(calls.length, 1);
      const failed = r.events("cycle_failed");
      assert.equal(failed.length, 1);
      assert.equal(failed[0].code, code);
      assert.equal(failed[0].run_id, calls[0]);
      assert.deepEqual(e.rows("SELECT status FROM fetch_runs"), [{ status: "failed" }]);
      const job = e.job();
      assert.equal(job.next_run_at, iso(T + INTERVAL), "now plus the interval, no stretch");
      assert.equal(job.last_status, "failed");
      assert.equal(job.lease_owner, null);
      assert.ok(!r.raw.join("\n").includes("boom") && !r.raw.join("\n").includes("10.1.2.3") && !r.raw.join("\n").includes("locked"), "no upstream text in any line");
      await w.stop();
    } finally {
      await e.cleanup();
    }
  }
  mock.timers.reset();
});

test("a throwing enrichment is logged with a fixed code and does not fail the cycle or hold the lease", async () => {
  timers();
  const e = await env();
  try {
    const r = rig();
    const { runCycle } = scripted(e.handle, r.clock, async () => undefined);
    const w = createWorker({
      db: e.handle.db,
      owner: "w",
      clock: r.clock,
      random: r.random,
      config: { ingestIntervalMs: INTERVAL },
      runCycle,
      runEnrichment: async () => {
        throw new Error("kev said https://10.9.8.7/x");
      },
      log: r.log,
    });
    w.start();
    mock.timers.tick(WORKER_START_JITTER_MS);
    await w.idle();
    await settle();
    await w.idle();
    assert.equal(r.events("cycle_failed").length, 0);
    const failed = r.events("enrich_provider_failed");
    assert.equal(failed.length, 1);
    assert.equal(failed[0].code, "enrich_error");
    assert.equal(e.job().last_status, "ok");
    assert.equal(e.job().lease_owner, null);
    assert.ok(!r.raw.join("\n").includes("10.9.8.7"));
    await w.stop();
  } finally {
    mock.timers.reset();
    await e.cleanup();
  }
});

test("logging: one line per failed source (egress_denied or source_failed with a fixed code), cycle_finished counts, and no IP address or URL in any line", async () => {
  timers();
  const SRC_A = makeSource({ id: "src-a", name: "Source A", family: "fam-a", url: "https://host-a.test/feed.xml" });
  const SRC_B = makeSource({ id: "src-b", name: "Source B", family: "fam-b", url: "https://host-b.test/feed.xml" });
  const SRC_C = makeSource({ id: "src-c", name: "Source C", family: "fam-c", url: "https://host-c.test/feed.xml" });
  const e = await env([SRC_A, SRC_B, SRC_C]);
  try {
    const r = rig();
    const fail = (code: FetchErrorCode): FeedFetchResult => ({ status: "error", code, httpStatus: null, retryAfterMs: null });
    const feeds: Record<string, FeedFetchResult> = {
      "src-a": fail("egress_denied_private"),
      "src-b": fail("http_error"),
      "src-c": { status: "ok", articles: [makeArticle({ title: "Gamma ransomware campaign", url: "https://c.test/1", source: SRC_C.name, sourceTier: SRC_C.tier, sourceType: SRC_C.sourceType, publishedAt: iso(T - 3_600_000) })], validators: { etag: null, lastModified: null }, httpStatus: 200 },
    };
    const w = createWorker({
      db: e.handle.db,
      owner: "6f9619ff-8b86-d011-b42d-00cf4fc964ff",
      clock: r.clock,
      random: r.random,
      config: { ingestIntervalMs: INTERVAL },
      runCycle: (db, now, onStage) => runIngestCycle(db, { sources: [SRC_A, SRC_B, SRC_C], onStage, clock: r.clock, fetchFeed: async (s) => feeds[s.id]! }, now),
      runEnrichment: async () => ({ kev: "refreshed", requested: 3, ssvcLookups: 2, epssUnavailable: 1, ssvcUnavailable: 0 }),
      log: r.log,
    });
    w.start();
    mock.timers.tick(WORKER_START_JITTER_MS);
    await w.idle();
    await settle();
    await w.idle();

    const denied = r.events("egress_denied");
    const failed = r.events("source_failed");
    assert.equal(denied.length, 1);
    assert.deepEqual({ source_id: denied[0].source_id, code: denied[0].code }, { source_id: "src-a", code: "egress_denied_private" });
    assert.equal(failed.length, 1);
    assert.deepEqual({ source_id: failed[0].source_id, code: failed[0].code }, { source_id: "src-b", code: "http_error" });

    const finished = r.events("cycle_finished");
    assert.equal(finished.length, 1);
    assert.equal(finished[0].status, "partial");
    assert.equal(typeof finished[0].run_id, "number");
    assert.deepEqual(
      {
        sources_total: finished[0].sources_total,
        sources_ok: finished[0].sources_ok,
        articles_new: finished[0].articles_new,
        articles_seen: finished[0].articles_seen,
        stories_created: finished[0].stories_created,
        stories_merged: finished[0].stories_merged,
      },
      { sources_total: 3, sources_ok: 1, articles_new: 1, articles_seen: 1, stories_created: 1, stories_merged: 0 },
    );
    const enrich = r.events("enrich_finished");
    assert.equal(enrich.length, 1);
    assert.equal(enrich[0].kev, "refreshed");
    assert.equal(enrich[0].requested, 3);

    const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/;
    for (const line of r.raw) {
      assert.ok(!IPV4.test(line), `no IP address pattern in ${line}`);
      assert.ok(!line.includes("://"), `no URL in ${line}`);
    }
    assert.ok(r.raw.length >= 5, "the run produced a real set of lines to scan");
    await w.stop();
  } finally {
    mock.timers.reset();
    await e.cleanup();
  }
});

test("the heartbeat is written every 15 s, and a failing heartbeat logs heartbeat_failed and never stops the loop", async () => {
  timers();
  const e = await env();
  try {
    const r = rig();
    const { runCycle, calls } = scripted(e.handle, r.clock, async () => undefined);
    e.handle.raw.prepare("UPDATE job SET next_run_at = ?").run(iso(T + 60 * 60_000));
    const w = createWorker({ db: e.handle.db, owner: "w", clock: r.clock, random: r.random, config: { ingestIntervalMs: INTERVAL }, runCycle, runEnrichment: async () => ENRICH, log: r.log });
    w.start();
    await settle();
    r.state.now = T + WORKER_HEARTBEAT_MS;
    mock.timers.tick(WORKER_HEARTBEAT_MS);
    await settle();
    assert.deepEqual(e.rows("SELECT beat_at FROM worker_heartbeat"), [{ beat_at: iso(T + WORKER_HEARTBEAT_MS) }]);

    e.handle.raw.exec("CREATE TRIGGER no_beat BEFORE UPDATE ON worker_heartbeat BEGIN SELECT RAISE(ABORT, 'locked down'); END");
    r.state.now = T + 2 * WORKER_HEARTBEAT_MS;
    mock.timers.tick(WORKER_HEARTBEAT_MS);
    await settle();
    const failed = r.events("heartbeat_failed");
    assert.equal(failed.length, 1);
    assert.equal(failed[0].code, "heartbeat_error");
    assert.ok(!r.raw.join("\n").includes("locked down"), "no driver text in the line");

    e.handle.raw.exec("DROP TRIGGER no_beat");
    r.state.now = T + 3 * WORKER_HEARTBEAT_MS;
    mock.timers.tick(WORKER_HEARTBEAT_MS);
    await settle();
    assert.deepEqual(e.rows("SELECT beat_at FROM worker_heartbeat"), [{ beat_at: iso(T + 3 * WORKER_HEARTBEAT_MS) }], "the loop kept beating");
    assert.equal(calls.length, 0);
    await w.stop();
  } finally {
    mock.timers.reset();
    await e.cleanup();
  }
});
