import type { Kysely } from "kysely";
import {
  INTERVAL_JITTER_RATIO,
  LEASE_TTL_MS,
  WORKER_HEARTBEAT_MS,
  WORKER_START_JITTER_MS,
  WORKER_TICK_MS,
} from "../config/env.ts";
import type { HavadisConfig } from "../config/env.ts";
import { isBusyError } from "../db/openDb.ts";
import type { Database } from "../db/schema.ts";
import type { LogEvent, LogFields, LogLevel } from "../log/logger.ts";
import { EGRESS_CODES } from "../reasonCodes.ts";
import { finishRun } from "../store/ingest.ts";
import { abandonStaleRuns, beat, claimLease, markRunAbandoned, releaseLease, renewLease } from "../store/jobs.ts";
import type { HeartbeatState } from "../store/jobs.ts";
import type { CycleReport, CycleStage } from "./cycle.ts";
import type { EnrichReport } from "./enrichRefresh.ts";

/**
 * The worker's tick loop (PLAT-06, SAFE-03): claim the ingest lease when the job is due, run one
 * ingest cycle and the enrichment stage under that lease, renew the lease at every stage, and
 * release it with a jittered next_run_at. All state that matters lives in the database (the lease,
 * the run rows, the heartbeat), so a second cycle never overlaps one, also across restarts.
 *
 * Logs carry fixed event names, ids, counts and fixed reason codes only: never a URL, a resolved
 * address, a proxy setting or upstream text (D-14).
 */

export type WorkerDeps = {
  db: Kysely<Database>;
  /** Identifies this worker in the lease; unique per process start. */
  owner: string;
  clock: () => number;
  random: () => number;
  config: Pick<HavadisConfig, "ingestIntervalMs">;
  runCycle: (db: Kysely<Database>, now: number, onStage: (stage: CycleStage, runId: number) => Promise<void>) => Promise<CycleReport>;
  runEnrichment: (db: Kysely<Database>, clock: () => number, runId: number) => Promise<EnrichReport>;
  log: { log(level: LogLevel, event: LogEvent, fields?: LogFields): void };
};

export type Worker = {
  /** Beats idle at once and starts ticking after a random 0 to 5 s. */
  start(): void;
  /** Stops ticking, abandons a running cycle's row, releases the lease and beats stopped; does not wait for network calls. */
  stop(): Promise<void>;
  /** Resolves when no cycle is in flight. */
  idle(): Promise<void>;
};

/** The lease was lost (or the worker is stopping) before the cycle could write. */
class LeaseLostError extends Error {}

const isEgressCode = (code: string): boolean => (EGRESS_CODES as readonly string[]).includes(code);

const iso = (ms: number): string => new Date(ms).toISOString();

export function createWorker(deps: WorkerDeps): Worker {
  const { db, owner, clock, random, log } = deps;
  let heartbeatState: HeartbeatState = "idle";
  let started = false;
  let stopping = false;
  let stopPromise: Promise<void> | null = null;
  let inFlight: Promise<void> | null = null;
  let currentRunId: number | null = null;
  let leaseLost = false;
  let startTimer: ReturnType<typeof setTimeout> | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  /** A heartbeat failure is logged with a fixed code and never stops the loop. */
  async function writeBeat(state: HeartbeatState): Promise<void> {
    // Once stopping, only the final "stopped" beat is written, so a late "idle" cannot overwrite it.
    if (stopping && state !== "stopped") return;
    try {
      await beat(db, iso(clock()), state);
    } catch (err) {
      log.log("warn", "heartbeat_failed", { code: isBusyError(err) ? "db_busy" : "heartbeat_error" });
    }
  }

  async function onStage(stage: CycleStage, runId: number): Promise<void> {
    if (stage === "started") currentRunId = runId;
    if (stopping) throw new LeaseLostError();
    const now = clock();
    if (await renewLease(db, owner, iso(now), iso(now + LEASE_TTL_MS))) return;
    // After the write transaction there is nothing left to abort; remember it and skip the rest.
    if (stage === "written") {
      leaseLost = true;
      return;
    }
    throw new LeaseLostError();
  }

  async function release(nextRunAtIso: string, status: string): Promise<void> {
    try {
      await releaseLease(db, owner, { nextRunAtIso, status });
    } catch (err) {
      // The lease then expires by its TTL; nothing else to do.
      log.log("error", "cycle_failed", { code: isBusyError(err) ? "db_busy" : "cycle_error" });
    }
    heartbeatState = "idle";
    await writeBeat("idle");
  }

  async function runOnce(): Promise<void> {
    try {
      const claimedAt = clock();
      const claimed = await claimLease(db, owner, iso(claimedAt), iso(claimedAt + LEASE_TTL_MS));
      if (!claimed) {
        log.log("debug", "lease_busy");
        return;
      }
      if (stopping) {
        await releaseLease(db, owner, { status: "stopped" });
        return;
      }
      currentRunId = null;
      leaseLost = false;
      heartbeatState = "running";
      const abandoned = await abandonStaleRuns(db, iso(clock()));
      log.log("info", "lease_claimed", { owner, abandoned_runs: abandoned });
      await writeBeat("running");

      let cycle: CycleReport;
      try {
        cycle = await deps.runCycle(db, claimedAt, onStage);
      } catch (err) {
        if (stopping) return;
        const code = err instanceof LeaseLostError ? "lease_lost" : isBusyError(err) ? "db_busy" : "cycle_error";
        log.log("error", "cycle_failed", currentRunId === null ? { code } : { code, run_id: currentRunId });
        // runIngestCycle already closed its own run; this covers a runCycle that threw after beginRun on its own.
        if (currentRunId !== null) await finishRun(db, currentRunId, iso(clock()), "failed");
        await release(iso(clock() + deps.config.ingestIntervalMs), "failed");
        return;
      }
      if (stopping) return;

      for (const outcome of cycle.outcomes) {
        if (outcome.outcome !== "failed" || outcome.code === null) continue;
        log.log("warn", isEgressCode(outcome.code) ? "egress_denied" : "source_failed", { source_id: outcome.sourceId, code: outcome.code });
      }
      log.log("info", "cycle_finished", {
        run_id: cycle.runId,
        status: cycle.status,
        sources_total: cycle.sourcesTotal,
        sources_ok: cycle.sourcesOk,
        articles_new: cycle.articlesNew,
        articles_seen: cycle.articlesSeen,
        stories_created: cycle.storiesCreated,
        stories_merged: cycle.storiesMerged,
      });

      if (leaseLost) {
        log.log("warn", "lease_busy", { code: "lease_lost" });
      } else {
        try {
          const enrich = await deps.runEnrichment(db, clock, cycle.runId);
          if (stopping) return;
          log.log("info", "enrich_finished", {
            kev: enrich.kev,
            requested: enrich.requested,
            ssvc_lookups: enrich.ssvcLookups,
            epss_unavailable: enrich.epssUnavailable,
            ssvc_unavailable: enrich.ssvcUnavailable,
          });
        } catch (err) {
          if (stopping) return;
          log.log("warn", "enrich_provider_failed", { code: isBusyError(err) ? "db_busy" : "enrich_error" });
        }
        const renewedAt = clock();
        if (!(await renewLease(db, owner, iso(renewedAt), iso(renewedAt + LEASE_TTL_MS)))) {
          log.log("warn", "lease_busy", { code: "lease_lost" });
        }
      }

      const jitter = 1 + (random() * 2 - 1) * INTERVAL_JITTER_RATIO;
      await release(iso(clock() + Math.round(deps.config.ingestIntervalMs * jitter)), cycle.status);
    } catch {
      // Anything unexpected (the database closing under a stopped worker, a busy release) must not
      // become an unhandled rejection; the lease TTL bounds the damage, and a stopped worker is silent.
      if (!stopping) log.log("error", "cycle_failed", { code: "cycle_error" });
    }
  }

  function tick(): void {
    if (stopping || inFlight !== null) return;
    const flow: Promise<void> = runOnce().finally(() => {
      if (inFlight === flow) inFlight = null;
    });
    inFlight = flow;
  }

  function stop(): Promise<void> {
    if (stopPromise) return stopPromise;
    stopping = true;
    clearTimeout(startTimer);
    clearInterval(tickTimer);
    clearInterval(heartbeatTimer);
    stopPromise = (async () => {
      try {
        if (inFlight !== null) {
          // Serialized by Kysely's single connection behind any in-flight transaction; a run that already
          // committed is not 'running' any more, so it keeps its status.
          if (currentRunId !== null) await markRunAbandoned(db, currentRunId, iso(clock()));
          await releaseLease(db, owner, { status: "stopped" });
        }
      } catch {
        // Best effort: the lease expires by its TTL and the next claim abandons the orphaned row.
      }
      heartbeatState = "stopped";
      await writeBeat("stopped");
    })();
    return stopPromise;
  }

  return {
    start() {
      if (started || stopping) return;
      started = true;
      void writeBeat(heartbeatState);
      heartbeatTimer = setInterval(() => {
        if (!stopping) void writeBeat(heartbeatState);
      }, WORKER_HEARTBEAT_MS);
      startTimer = setTimeout(() => {
        if (stopping) return;
        tick();
        tickTimer = setInterval(tick, WORKER_TICK_MS);
      }, random() * WORKER_START_JITTER_MS);
    },
    stop,
    async idle() {
      while (inFlight !== null) await inFlight;
    },
  };
}
