import { CVE_ID_SHAPE } from "../cveChips.ts";
import { boundedFetchJson } from "../pipeline/boundedFetch.ts";
import type { fetchWithValidatedRedirect } from "../pipeline/fetchWithValidatedRedirect.ts";
import type { EpssState } from "../types.ts";
import {
  EPSS_BATCH_SIZE,
  EPSS_MAX_BYTES,
  EPSS_MAX_IDS,
  EPSS_REVALIDATE_SECONDS,
  EPSS_TIMEOUT_MS,
  EPSS_URL,
} from "./config.ts";

/**
 * EPSS lookups from FIRST (ENR-02, ENR-03). Plain TypeScript, no React import,
 * never reads the clock and never throws.
 *
 * The endpoint is marked BETA. Its `cve` value is capped at 2000 characters and
 * an over-length request comes back as an empty OK answer (`status: "OK"`,
 * `total: 0`), which would read as "no EPSS yet" for every CVE (Pitfall 2).
 * Hence at most `EPSS_BATCH_SIZE` IDs per request, and a URL built by string
 * join: a URL search-parameter builder would percent-encode each comma and
 * lengthen it. Unknown or unscored CVEs are simply absent rows, so "no row" is
 * only believed from an answer that passes the consistency rule in
 * `parseEpssChunk`.
 *
 * Requests go through `fetch` with `next.revalidate` outside every cached
 * callback. A hostile or glitched 200 can therefore be cached for up to
 * `EPSS_REVALIDATE_SECONDS` (Pitfall 7): accepted for a trusted host and
 * mitigated by the strict row validation below.
 */

const EPSS_ROW_NUMBER = /^\d+(\.\d+)?$/;
const EPSS_ROW_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The IDs to look up: de-duplicated, only anchored CVE-ID shapes, in
 * first-appearance order, split at `cap`. `overflow` is past the cap and is
 * never requested (D-13).
 */
export function selectEpssIds(
  ids: readonly string[],
  cap: number
): { kept: string[]; overflow: string[] } {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    if (typeof id === "string" && CVE_ID_SHAPE.test(id) && !seen.has(id)) {
      seen.add(id);
      unique.push(id);
    }
  }
  return { kept: unique.slice(0, cap), overflow: unique.slice(cap) };
}

/**
 * Sorts a copy of `ids` ascending and splits it into batches of at most
 * `size`, so the same set in any input order yields the same batches and
 * therefore the same request URLs (one Data Cache key per batch).
 */
export function sortedBatches(ids: readonly string[], size: number): string[][] {
  const sorted = [...new Set(ids)].sort();
  const out: string[][] = [];
  for (let i = 0; i < sorted.length; i += size) out.push(sorted.slice(i, i + size));
  return out;
}

/** The request URL for one batch: literal commas, `limit=100` above the batch size. */
export function epssUrl(batch: readonly string[], base: string): string {
  return `${base}?cve=${batch.join(",")}&limit=100`;
}

/** One parsed batch: a state for every requested ID, or the whole batch failed the consistency rule. */
export type EpssChunk = { ok: true; states: Record<string, EpssState> } | { ok: false };

/**
 * Validates one FIRST answer against the IDs that were requested. The answer
 * counts only when `status` is `"OK"`, `data` is an array, `total` is a number
 * equal to `data.length`, and `data.length` is at most `batch.length`; anything
 * else is `{ ok: false }` and every ID of the batch becomes unavailable.
 *
 * In a consistent answer, a requested ID with a valid row is `scored`, one with
 * only invalid rows is `unavailable`, and one with no row is `no-row`. A row is
 * considered only when its `cve`, uppercased, is a requested ID; it is valid
 * when `epss` is a plain non-negative decimal (clamped to [0, 1]) and `date` is
 * `YYYY-MM-DD`. The first valid row for an ID wins. `percentile` is ignored
 * (D-05). States are written into a fresh object only under requested IDs, so a
 * hostile row can never add a key.
 */
export function parseEpssChunk(json: unknown, batch: readonly string[]): EpssChunk {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return { ok: false };
  const body = json as { status?: unknown; total?: unknown; data?: unknown };
  if (body.status !== "OK" || !Array.isArray(body.data)) return { ok: false };
  const data: unknown[] = body.data;
  if (typeof body.total !== "number" || body.total !== data.length) return { ok: false };
  if (data.length > batch.length) return { ok: false };

  const requested = new Set(batch);
  const scored = new Map<string, { score: number; date: string }>();
  const sawRow = new Set<string>();
  for (const row of data) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) continue;
    const r = row as { cve?: unknown; epss?: unknown; date?: unknown };
    if (typeof r.cve !== "string") continue;
    const id = r.cve.toUpperCase();
    if (!requested.has(id)) continue;
    sawRow.add(id);
    if (scored.has(id)) continue;
    const epss = typeof r.epss === "string" || typeof r.epss === "number" ? String(r.epss) : "";
    if (!EPSS_ROW_NUMBER.test(epss)) continue;
    const n = Number(epss);
    if (!Number.isFinite(n)) continue;
    if (typeof r.date !== "string" || !EPSS_ROW_DATE.test(r.date)) continue;
    scored.set(id, { score: Math.min(1, Math.max(0, n)), date: r.date });
  }

  const states: Record<string, EpssState> = {};
  for (const id of batch) {
    const hit = scored.get(id);
    if (hit !== undefined) {
      states[id] = { state: "scored", score: hit.score, date: hit.date };
    } else if (sawRow.has(id)) {
      states[id] = { state: "unavailable" };
    } else {
      states[id] = { state: "no-row" };
    }
  }
  return { ok: true, states };
}

/** Injectable pieces of `fetchEpss`, for hermetic tests. */
export type EpssDeps = {
  url?: string;
  fetcher?: typeof fetchWithValidatedRedirect;
  batchSize?: number;
  maxIds?: number;
  timeoutMs?: number;
  maxBytes?: number;
};

/**
 * Looks up EPSS for `ids` in sorted batches, one `boundedFetchJson` per batch
 * inside one `Promise.allSettled`, so a slow or broken batch affects only its
 * own IDs. Resolves to a state for every valid unique input ID: `scored`,
 * `no-row` (only from a consistent answer), or `unavailable` (failed, timed
 * out, inconsistent, malformed, oversized, or past the per-edition cap).
 * Never throws.
 */
export async function fetchEpss(
  ids: readonly string[],
  deps: EpssDeps = {}
): Promise<Record<string, EpssState>> {
  const out: Record<string, EpssState> = {};
  const markUnavailable = (list: readonly string[]) => {
    for (const id of list) out[id] = { state: "unavailable" };
  };
  let valid: string[] = [];
  try {
    const { kept, overflow } = selectEpssIds(ids, deps.maxIds ?? EPSS_MAX_IDS);
    valid = [...kept, ...overflow];
    const base = deps.url ?? EPSS_URL;
    const batches = sortedBatches(kept, deps.batchSize ?? EPSS_BATCH_SIZE);
    const settled = await Promise.allSettled(
      batches.map(async (batch): Promise<EpssChunk> => {
        const res = await boundedFetchJson(
          epssUrl(batch, base),
          {
            maxBytes: deps.maxBytes ?? EPSS_MAX_BYTES,
            timeoutMs: deps.timeoutMs ?? EPSS_TIMEOUT_MS,
            revalidate: EPSS_REVALIDATE_SECONDS,
          },
          { fetcher: deps.fetcher }
        );
        return res.ok ? parseEpssChunk(res.json, batch) : { ok: false };
      })
    );
    settled.forEach((outcome, i) => {
      const chunk = outcome.status === "fulfilled" ? outcome.value : null;
      if (chunk !== null && chunk.ok) {
        for (const id of batches[i]) out[id] = chunk.states[id] ?? { state: "unavailable" };
      } else {
        markUnavailable(batches[i]);
      }
    });
    markUnavailable(overflow);
    return out;
  } catch {
    const all: Record<string, EpssState> = {};
    for (const id of valid) all[id] = { state: "unavailable" };
    return all;
  }
}
