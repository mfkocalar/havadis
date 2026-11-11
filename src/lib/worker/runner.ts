import type { Kysely } from "kysely";
import type { HavadisConfig } from "../config/env.ts";
import type { Database } from "../db/schema.ts";
import type { LogEvent, LogFields, LogLevel } from "../log/logger.ts";
import type { CycleReport, CycleStage } from "./cycle.ts";
import type { EnrichReport } from "./enrichRefresh.ts";

// Skeleton so the tests compile and fail on their assertions (RED); replaced in the next commit.
export type WorkerDeps = {
  db: Kysely<Database>;
  owner: string;
  clock: () => number;
  random: () => number;
  config: Pick<HavadisConfig, "ingestIntervalMs">;
  runCycle: (db: Kysely<Database>, now: number, onStage: (stage: CycleStage, runId: number) => Promise<void>) => Promise<CycleReport>;
  runEnrichment: (db: Kysely<Database>, clock: () => number, runId: number) => Promise<EnrichReport>;
  log: { log(level: LogLevel, event: LogEvent, fields?: LogFields): void };
};

export function createWorker(_deps: WorkerDeps): { start(): void; stop(): Promise<void>; idle(): Promise<void> } {
  return { start() {}, async stop() {}, async idle() {} };
}
