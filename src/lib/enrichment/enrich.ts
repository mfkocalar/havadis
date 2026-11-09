import { CVE_ID_SHAPE } from "../cveChips.ts";
import type {
  CveEnrichment,
  EnrichmentHealth,
  EnrichmentSnapshot,
  EpssState,
  KevRead,
  KevState,
  SsvcState,
} from "../types.ts";
import { KEV_MAX_AGE_HOURS, SSVC_MAX_LOOKUPS } from "./config.ts";
import { fetchEpss, type EpssDeps } from "./epss.ts";
import { fetchSsvc, selectSsvcIds, type SsvcDeps } from "./ssvc.ts";

/**
 * The render-time join of an edition's CVEs with KEV and EPSS. Plain
 * TypeScript, no React import, so `node --test` can exercise it hermetically.
 * Never throws and never reads the clock: `now` is the caller's.
 */

const KEV_MAX_AGE_MS = KEV_MAX_AGE_HOURS * 60 * 60 * 1000;

/**
 * Every valid CVE ID across the articles, once each, in first-appearance
 * order. Only IDs matching the anchored `CVE_ID_SHAPE` survive, so a
 * malformed ID can never become an enrichment key.
 */
export function uniqueCves(articles: ReadonlyArray<{ cves: readonly string[] }>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const article of articles) {
    for (const id of article.cves) {
      if (typeof id === "string" && CVE_ID_SHAPE.test(id) && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

/**
 * KEV health for the page notice (D-10). `unavailable` (with a null
 * `fetchedAt`) unless a well-formed map was read. A map aged at most
 * `KEV_MAX_AGE_HOURS` is `ok`, any older one is `stale`: it is still used and
 * never dropped for age. A `fetchedAt` in the future counts as age 0 (the map
 * can be fetched after the edition's own timestamp).
 */
export function kevHealth(read: KevRead, now: number): EnrichmentHealth["kev"] {
  const unavailable = { status: "unavailable", fetchedAt: null } as const;
  if (read.status !== "ok") return unavailable;
  const map = read.map as unknown;
  if (typeof map !== "object" || map === null) return unavailable;
  const m = map as { version?: unknown; entries?: unknown; fetchedAt?: unknown };
  if (m.version !== 1 || typeof m.entries !== "object" || m.entries === null) return unavailable;
  if (typeof m.fetchedAt !== "string") return unavailable;
  const fetchedMs = Date.parse(m.fetchedAt);
  if (!Number.isFinite(fetchedMs)) return unavailable;
  const age = Math.max(0, now - fetchedMs);
  return { status: age <= KEV_MAX_AGE_MS ? "ok" : "stale", fetchedAt: m.fetchedAt };
}

function unavailableSnapshot(ids: readonly string[]): EnrichmentSnapshot {
  const byCve: Record<string, CveEnrichment> = {};
  for (const id of ids) {
    byCve[id] = {
      kev: { state: "unavailable" },
      epss: { state: "unavailable" },
      ssvc: { state: "unavailable" },
    };
  }
  return {
    byCve,
    health: {
      kev: { status: "unavailable", fetchedAt: null },
      epss: { status: "unavailable", requested: ids.length, unavailable: ids.length },
      ssvc: { status: "unavailable", requested: ids.length, unavailable: ids.length },
    },
  };
}

/** The unique valid IDs of `cves`, or none if even that cannot be computed. */
function safeIds(cves: readonly string[]): string[] {
  try {
    return uniqueCves([{ cves }]);
  } catch {
    return [];
  }
}

/**
 * The page's one-line notice about degraded enrichment (ENR-05, D-08, D-10,
 * D-11), or null when every provider is healthy. Built from a fixed
 * vocabulary plus one date re-serialised by `toISOString`, so no upstream text
 * or error message can reach a visitor. The parts come in the order KEV, EPSS,
 * SSVC, joined with " · ". Pure and clock-free.
 *
 * The wording describes the availability of a data source only. It never says
 * or implies anything about a CVE's KEV membership or safety (D-09): a CVE
 * that is simply not listed has no visual at all.
 */
export function enrichmentNotice(health: EnrichmentHealth): string | null {
  const parts: string[] = [];

  if (health.kev.status === "unavailable") {
    parts.push("KEV data unavailable");
  } else if (health.kev.status === "stale") {
    const fetchedMs =
      typeof health.kev.fetchedAt === "string" ? Date.parse(health.kev.fetchedAt) : NaN;
    parts.push(
      Number.isFinite(fetchedMs)
        ? `KEV data from ${new Date(fetchedMs).toISOString().slice(0, 10)}`
        : "KEV data unavailable"
    );
  }

  if (health.epss.status === "unavailable") {
    parts.push("EPSS data unavailable");
  } else if (health.epss.status === "partial") {
    parts.push("EPSS partially unavailable");
  }

  if (health.ssvc.status === "unavailable") {
    parts.push("SSVC data unavailable");
  } else if (health.ssvc.status === "partial") {
    parts.push("SSVC partially unavailable");
  }

  return parts.length === 0 ? null : parts.join(" · ");
}

/** Injectable pieces of `enrichCves`, for hermetic tests. */
export type EnrichDeps = { epss?: EpssDeps; ssvc?: SsvcDeps };

/**
 * Joins the edition's CVEs with the KEV read (ENR-03). Each unique valid ID
 * gets `listed` (fields copied into a fresh literal, looked up with
 * `Object.hasOwn`), or `not-listed` when a KEV map was read (health `ok` or
 * `stale`), or `unavailable` otherwise: `not-listed` is never produced on a
 * failed read, so an outage can never read as "not exploited" (D-09).
 *
 * EPSS comes from `fetchEpss` (sorted batches, per-batch failure isolation):
 * each ID is `scored`, `no-row` (only after a consistent FIRST answer) or
 * `unavailable`, which shows no EPSS chip (D-07, D-11). `health.epss` is `ok`
 * when nothing was requested or nothing is unavailable, `unavailable` when
 * every ID is, and `partial` otherwise.
 *
 * SSVC (ENR-06, ENR-07) comes from the injected `deps.ssvc.lookup`; without
 * one nothing is requested and every candidate is `unavailable`, so no caller
 * can reach a live host by omission (D-10). When the KEV map is known (`ok` or
 * `stale`), KEV-listed CVEs are `skipped` and never looked up (D-05); at most
 * the cap are looked up, cached or not (D-06, D-08), and the rest are
 * `unavailable`. `health.ssvc.requested` is the valid IDs minus the skipped
 * ones; `not-assessed` and `skipped` never count as unavailable (ENR-07).
 *
 * Never throws: on any unexpected error every ID comes back `unavailable` in
 * all three providers. Never reads the clock.
 */
export async function enrichCves(
  cves: readonly string[],
  sources: { kev: KevRead; cardCves?: ReadonlyArray<readonly string[]> },
  now: number,
  deps: EnrichDeps = {}
): Promise<EnrichmentSnapshot> {
  try {
    const ids = uniqueCves([{ cves }]);
    const health = kevHealth(sources.kev, now);
    const entries =
      health.status !== "unavailable" && sources.kev.status === "ok"
        ? sources.kev.map.entries
        : null;

    const epss = await fetchEpss(ids, deps.epss);

    const kevOf = (id: string): KevState => {
      if (entries === null) return { state: "unavailable" };
      if (Object.hasOwn(entries, id)) {
        const e = entries[id];
        return { state: "listed", added: e.added, due: e.due, ransomware: e.ransomware };
      }
      return { state: "not-listed" };
    };
    const pre: Record<string, { kev: KevState; epss: EpssState }> = {};
    for (const id of ids) {
      pre[id] = {
        kev: kevOf(id),
        epss: Object.hasOwn(epss, id) ? epss[id] : { state: "unavailable" },
      };
    }
    const selection = selectSsvcIds(ids, pre, {
      kevKnown: entries !== null,
      cap: deps.ssvc?.maxLookups ?? SSVC_MAX_LOOKUPS,
      cardCves: sources.cardCves,
    });
    const looked = await fetchSsvc(selection.lookups, deps.ssvc);
    const skipped = new Set(selection.skipped);

    const byCve: Record<string, CveEnrichment> = {};
    let epssUnavailable = 0;
    let ssvcRequested = 0;
    let ssvcUnavailable = 0;
    for (const id of ids) {
      const { kev, epss: e } = pre[id];
      if (e.state === "unavailable") epssUnavailable++;
      let ssvc: SsvcState;
      if (skipped.has(id)) {
        ssvc = { state: "skipped" };
      } else {
        ssvcRequested++;
        ssvc = Object.hasOwn(looked, id) ? looked[id] : { state: "unavailable" };
        if (ssvc.state === "unavailable") ssvcUnavailable++;
      }
      byCve[id] = { kev, epss: e, ssvc };
    }

    return {
      byCve,
      health: {
        kev: health,
        epss: {
          status:
            ids.length === 0 || epssUnavailable === 0
              ? "ok"
              : epssUnavailable === ids.length
                ? "unavailable"
                : "partial",
          requested: ids.length,
          unavailable: epssUnavailable,
        },
        ssvc: {
          status:
            ssvcRequested === 0 || ssvcUnavailable === 0
              ? "ok"
              : ssvcUnavailable === ssvcRequested
                ? "unavailable"
                : "partial",
          requested: ssvcRequested,
          unavailable: ssvcUnavailable,
        },
      },
    };
  } catch {
    return unavailableSnapshot(safeIds(cves));
  }
}
