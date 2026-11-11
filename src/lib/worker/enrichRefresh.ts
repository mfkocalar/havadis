import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { enrichCves } from "../enrichment/enrich.ts";
import type { EpssDeps } from "../enrichment/epss.ts";
import { produceKev } from "../enrichment/kev.ts";
import { produceSsvc } from "../enrichment/ssvc.ts";
import type { SafeFetch } from "../egress/safeFetch.ts";
import {
  applyKevToSignals,
  persistPostEnrich,
  persistSsvcPositive,
  readKevFromDb,
  readStoredSsvc,
  recordProviderAttempt,
  replaceKevCatalog,
  selectEnrichmentCandidates,
} from "../store/signals.ts";
import type { ProviderErrorCode } from "../store/signals.ts";
import type { CacheableSsvcState, KevMap } from "../types.ts";

/**
 * The enrichment stage behind the unchanged `enrichCves` (spike verdict a, PLAT-06 enrichment half):
 * refresh KEV, EPSS and SSVC for the CVEs of the stories readers see, keep last good, and persist
 * with exact-change observations. Run by the worker after every ingest cycle (Plan 13); a TTL of
 * `enrichIntervalMs` gates every provider (KEV per provider, EPSS and SSVC per CVE), so a CVE that
 * first appears in a cycle is enriched in that cycle, and a failed provider is retried no sooner
 * than `cooldownMs` later.
 *
 * No transaction spans a network call (T-14-26): `produceKev`, the EPSS fetch and `produceSsvc` all
 * run outside any transaction, and every write is its own short transaction after the call (or, for
 * an SSVC answer, inside the lookup callback, so an answer that lands after the time budget is still
 * stored). Timestamps come from `clock` only. Failures are recorded as fixed codes, never text.
 */

export type EnrichStageDeps = {
  fetcher: SafeFetch;
  /** TTL of every provider, in milliseconds (HAVADIS_ENRICH_INTERVAL_HOURS). */
  enrichIntervalMs: number;
  /** A failed provider or CVE waits this long before the next try. */
  cooldownMs: number;
  ssvcMaxLookups: number;
  ssvcBudgetMs: number;
  produceKev?: typeof produceKev;
  produceSsvc?: typeof produceSsvc;
  epss?: EpssDeps;
};

export type EnrichReport = {
  kev: "refreshed" | "fresh" | "failed";
  /** CVEs handed to the engine this pass. */
  requested: number;
  /** SSVC network lookups started this pass (a late one may still finish after the pass returns). */
  ssvcLookups: number;
  epssUnavailable: number;
  ssvcUnavailable: number;
};

const elapsed = (now: number, then: string | null, ms: number): boolean => then === null || now - Date.parse(then) >= ms;

export async function runEnrichmentStage(
  db: Kysely<Database>,
  deps: EnrichStageDeps,
  clock: () => number,
  runId: number,
): Promise<EnrichReport> {
  const iso = (): string => new Date(clock()).toISOString();
  const fetchKev = deps.produceKev ?? produceKev;
  const fetchSsvc = deps.produceSsvc ?? produceSsvc;

  // (1) KEV, per provider.
  const kevState = await db
    .selectFrom("provider_state")
    .where("provider", "=", "kev")
    .select(["last_success_at", "last_attempt_at"])
    .executeTakeFirst();
  const hasCatalog = kevState?.last_success_at != null;
  const kevDue =
    elapsed(clock(), kevState?.last_success_at ?? null, deps.enrichIntervalMs) &&
    elapsed(clock(), kevState?.last_attempt_at ?? null, deps.cooldownMs);

  let kev: EnrichReport["kev"];
  if (kevDue) {
    let map: KevMap | null = null;
    let code: ProviderErrorCode = "network_error";
    try {
      map = await fetchKev(clock(), { fetcher: deps.fetcher });
    } catch (err) {
      code = err instanceof Error && err.message.startsWith("kev rejected") ? "validation_failed" : "network_error";
    }
    if (map !== null) {
      const fetched = map;
      await db.transaction().execute(async (trx) => {
        const at = iso();
        await replaceKevCatalog(trx, fetched);
        await applyKevToSignals(trx, at, runId);
        await recordProviderAttempt(trx, "kev", { ok: true, catalogVersion: fetched.catalogVersion }, at);
      });
      kev = "refreshed";
    } else {
      await db.transaction().execute((trx) => recordProviderAttempt(trx, "kev", { ok: false, code }, iso()));
      kev = "failed";
    }
  } else if (hasCatalog) {
    // CVEs first seen between refreshes get their state from the stored catalog.
    await db.transaction().execute((trx) => applyKevToSignals(trx, iso(), runId, { onlyUnavailable: true }));
    kev = "fresh";
  } else {
    kev = "failed";
  }

  // (2) The CVEs of the stories readers see that are due.
  const candidates = await selectEnrichmentCandidates(db, clock(), deps.enrichIntervalMs, deps.cooldownMs);
  if (candidates.staleIds.length === 0) {
    return { kev, requested: 0, ssvcLookups: 0, epssUnavailable: 0, ssvcUnavailable: 0 };
  }

  // (3) The SSVC lookup: a CVE whose own SSVC check is still fresh answers from the store; otherwise
  // the network answer is persisted in its own short transaction before it is handed back.
  let ssvcLookups = 0;
  const lookup = async (cveId: string): Promise<CacheableSsvcState> => {
    if (!candidates.ssvcDue.has(cveId)) {
      const stored = await readStoredSsvc(db, cveId);
      if (stored !== null) return stored;
    }
    ssvcLookups++;
    const state = await fetchSsvc(cveId, { fetcher: deps.fetcher });
    await db.transaction().execute((trx) => persistSsvcPositive(trx, cveId, state, iso(), runId));
    return state;
  };

  // (4) The engine, unchanged.
  const snapshot = await enrichCves(
    candidates.staleIds,
    { kev: await readKevFromDb(db), cardCves: candidates.cardCves },
    clock(),
    {
      epss: { ...deps.epss, fetcher: deps.fetcher },
      ssvc: { lookup, maxLookups: deps.ssvcMaxLookups, totalBudgetMs: deps.ssvcBudgetMs },
    },
  );

  // (5) One transaction: EPSS, skipped SSVC and the attempt bookkeeping.
  const { epss, ssvc } = snapshot.health;
  await db.transaction().execute(async (trx) => {
    const at = iso();
    await persistPostEnrich(trx, snapshot, at, runId);
    // A provider counts as reached when nothing was asked of it or at least one answer was positive.
    const reached = (h: { requested: number; unavailable: number }): boolean => h.requested === 0 || h.unavailable < h.requested;
    await recordProviderAttempt(trx, "epss", reached(epss) ? { ok: true } : { ok: false, code: "network_error" }, at);
    await recordProviderAttempt(trx, "ssvc", reached(ssvc) ? { ok: true } : { ok: false, code: "network_error" }, at);
  });

  return {
    kev,
    requested: candidates.staleIds.length,
    ssvcLookups,
    epssUnavailable: epss.unavailable,
    ssvcUnavailable: ssvc.unavailable,
  };
}
