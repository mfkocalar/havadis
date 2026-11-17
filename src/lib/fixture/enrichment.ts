import { CVE_ID_SHAPE } from "../cveChips.ts";
import type { CacheableSsvcState, EpssState, KevMap } from "../types.ts";

/**
 * Committed KEV, EPSS and SSVC data for the fixture edition (Phase 22, D-01),
 * keyed by fictional CVE IDs in 2099 and read only behind the fixture switch
 * (`src/lib/config/fixtureMode.ts`). Hand-written, never a live capture.
 */

/**
 * A `KevMap` literal for the fixture stories. It never goes through
 * `parseKev`, which rejects fewer than `KEV_MIN_ENTRIES` entries. `fetchedAt`
 * comes from `now`, so the map reads `ok` and never `stale`.
 */
export function fixtureKevMap(now: number): KevMap {
  return {
    version: 1,
    fetchedAt: new Date(now).toISOString(),
    catalogVersion: "fixture",
    entries: {
      "CVE-2099-10001": { added: "2099-01-05", due: "2099-01-26", ransomware: true },
      "CVE-2099-10003": { added: "2099-01-12", due: "", ransomware: false },
    },
  };
}

const FIXTURE_EPSS: Readonly<Record<string, { score: number; date: string }>> = {
  "CVE-2099-10002": { score: 0.42, date: "2099-01-15" },
  "CVE-2099-10004": { score: 0.03, date: "2099-01-15" },
};

/**
 * A state for every input ID that matches `CVE_ID_SHAPE`, each ID once:
 * `scored` for the IDs in the table (one score at or above 0.1, one below),
 * `no-row` for every other valid ID. Never `unavailable`, so the page shows no
 * EPSS notice.
 */
export function fixtureEpssStates(ids: readonly string[]): Record<string, EpssState> {
  const out: Record<string, EpssState> = {};
  for (const id of ids) {
    if (typeof id !== "string" || !CVE_ID_SHAPE.test(id) || Object.hasOwn(out, id)) continue;
    const row = Object.hasOwn(FIXTURE_EPSS, id) ? FIXTURE_EPSS[id] : undefined;
    out[id] = row ? { state: "scored", score: row.score, date: row.date } : { state: "no-row" };
  }
  return out;
}

/**
 * `assessed` with exploitation `active` for CVE-2099-10002, `assessed` with
 * `poc` for CVE-2099-10004, and `not-assessed` for every other ID.
 */
export function fixtureSsvcState(id: string): CacheableSsvcState {
  if (id === "CVE-2099-10002") {
    return { state: "assessed", exploitation: "active", automatable: "yes", technicalImpact: "total" };
  }
  if (id === "CVE-2099-10004") {
    return { state: "assessed", exploitation: "poc", automatable: "no", technicalImpact: "partial" };
  }
  return { state: "not-assessed" };
}
