import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import type { FetchErrorCode } from "../reasonCodes.ts";
import type { CacheableSsvcState, EnrichmentSnapshot, KevMap, KevRead } from "../types.ts";

// Skeleton: the exports below compile and do nothing, so signals.test.ts fails on its assertions
// until the real implementation lands.

type Db = Kysely<Database>;

export type ProviderErrorCode = FetchErrorCode | "validation_failed";
export type ProviderOutcome = { ok: true; catalogVersion?: string } | { ok: false; code: ProviderErrorCode };
export type EnrichmentCandidates = { staleIds: string[]; cardCves: string[][]; ssvcDue: ReadonlySet<string> };

export async function readKevFromDb(_db: Db): Promise<KevRead> {
  return { status: "unavailable" };
}

export async function replaceKevCatalog(_db: Db, _map: KevMap): Promise<number> {
  return 0;
}

export async function applyKevToSignals(
  _db: Db,
  _nowIso: string,
  _runId: number,
  _opts: { onlyUnavailable?: boolean } = {},
): Promise<{ checked: number; changed: number }> {
  return { checked: 0, changed: 0 };
}

export async function persistSsvcPositive(
  _db: Db,
  _cveId: string,
  _state: CacheableSsvcState,
  _nowIso: string,
  _runId: number,
): Promise<boolean> {
  return false;
}

export async function persistPostEnrich(
  _db: Db,
  _snapshot: EnrichmentSnapshot,
  _nowIso: string,
  _runId: number,
): Promise<{ changed: number }> {
  return { changed: 0 };
}

export async function recordProviderAttempt(
  _db: Db,
  _provider: "kev" | "epss" | "ssvc",
  _outcome: ProviderOutcome,
  _nowIso: string,
): Promise<void> {}

export async function selectEnrichmentCandidates(
  _db: Db,
  _now: number,
  _ttlMs: number,
  _cooldownMs: number,
): Promise<EnrichmentCandidates> {
  return { staleIds: [], cardCves: [], ssvcDue: new Set() };
}
