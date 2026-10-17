import { CVE_ID_SHAPE } from "../cveChips.ts";
import type {
  CveEnrichment,
  EnrichmentHealth,
  EnrichmentSnapshot,
  EpssState,
  KevRead,
  KevState,
} from "../types.ts";
import { KEV_MAX_AGE_HOURS } from "./config.ts";
import { fetchEpss, type EpssDeps } from "./epss.ts";

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
    byCve[id] = { kev: { state: "unavailable" }, epss: { state: "unavailable" } };
  }
  return {
    byCve,
    health: {
      kev: { status: "unavailable", fetchedAt: null },
      epss: { status: "unavailable", requested: ids.length, unavailable: ids.length },
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

/** Injectable pieces of `enrichCves`, for hermetic tests. */
export type EnrichDeps = { epss?: EpssDeps };

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
 * Never throws: on any unexpected error every ID comes back `unavailable` in
 * both providers. Never reads the clock.
 */
export async function enrichCves(
  cves: readonly string[],
  sources: { kev: KevRead },
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

    const byCve: Record<string, CveEnrichment> = {};
    let epssUnavailable = 0;
    for (const id of ids) {
      let kev: KevState;
      if (entries === null) {
        kev = { state: "unavailable" };
      } else if (Object.hasOwn(entries, id)) {
        const e = entries[id];
        kev = { state: "listed", added: e.added, due: e.due, ransomware: e.ransomware };
      } else {
        kev = { state: "not-listed" };
      }
      const e: EpssState = Object.hasOwn(epss, id) ? epss[id] : { state: "unavailable" };
      if (e.state === "unavailable") epssUnavailable++;
      byCve[id] = { kev, epss: e };
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
      },
    };
  } catch {
    return unavailableSnapshot(safeIds(cves));
  }
}
