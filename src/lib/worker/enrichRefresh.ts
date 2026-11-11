import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import type { EpssDeps } from "../enrichment/epss.ts";
import type { produceKev } from "../enrichment/kev.ts";
import type { produceSsvc } from "../enrichment/ssvc.ts";
import type { SafeFetch } from "../egress/safeFetch.ts";

// Skeleton: compiles and does nothing, so enrichRefresh.test.ts fails on its assertions until the
// real stage lands.

export type EnrichStageDeps = {
  fetcher: SafeFetch;
  enrichIntervalMs: number;
  cooldownMs: number;
  ssvcMaxLookups: number;
  ssvcBudgetMs: number;
  produceKev?: typeof produceKev;
  produceSsvc?: typeof produceSsvc;
  epss?: EpssDeps;
};

export type EnrichReport = {
  kev: "refreshed" | "fresh" | "failed";
  requested: number;
  ssvcLookups: number;
  epssUnavailable: number;
  ssvcUnavailable: number;
};

export async function runEnrichmentStage(
  _db: Kysely<Database>,
  _deps: EnrichStageDeps,
  _clock: () => number,
  _runId: number,
): Promise<EnrichReport> {
  return { kev: "failed", requested: 0, ssvcLookups: 0, epssUnavailable: 0, ssvcUnavailable: 0 };
}
