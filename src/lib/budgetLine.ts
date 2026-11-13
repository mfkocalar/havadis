import { EPSS_BATCH_SIZE, EPSS_MAX_IDS, SSVC_MAX_LOOKUPS } from "./enrichment/config.ts";
import type { EnrichmentHealth } from "./types.ts";

/**
 * The budget log line (PLAT-04, D-01 to D-04, D-13): one structured line per
 * producer call, so the platform budget table can be recomputed from runtime
 * logs. Hobby keeps runtime logs for one hour and has no drains, so a local
 * follower captures the lines; nothing here stores a counter anywhere.
 *
 * Format: the fixed prefix `budget ` and one JSON object whose keys always
 * appear in this order, ssvc lines adding `st` last:
 *
 *   budget {"p":"edition","ok":1,"ms":812,"cpuMs":371,"n":143,"bytes":205367,"rcW":1,"rcR":0,"kvCmd":0}
 *
 *   p      producer: edition, kev, ssvc, epss or render
 *   ok     1 when the producer resolved (epss: no batch failed), else 0
 *   ms     elapsed wall time of the producer, whole milliseconds
 *   cpuMs  process.cpuUsage() user plus system delta around the producer, whole ms
 *   n      items handled (articles, KEV entries, 1 CVE, EPSS ids, EPSS ids at render)
 *   bytes  JSON size of the stored or fetched payload, where the producer has one
 *   rcW    Runtime Cache writes (exact for the three unstable_cache producers,
 *          an upper bound for epss, where `fetch` cache hits are not observable)
 *   rcR    Runtime Cache reads, modelled; only the render line carries a value
 *   kvCmd  Upstash commands; always 0 in Phase 21 (D-07), the key keeps the
 *          schema stable for Phase 23
 *   st     ssvc only: assessed, not-assessed or failed
 *
 * ms and cpuMs are UPPER BOUNDS (D-13): Fluid Compute can run concurrent work
 * in one instance, and the process-wide CPU delta then includes that work. The
 * 373 ms local cold-compose figure in `snapshot.ts` (header item 8) is the
 * comparison point.
 *
 * A line never carries a CVE ID, URL, error message or any upstream text
 * (D-02): every value is a non-negative integer or an enum literal, and the
 * line is built from a fresh object, never by interpolating a field. A cache
 * hit logs nothing (D-04) because only producer bodies and `getFrontPageData`
 * call `withBudgetLine`, never the cached arrows in `snapshot.ts`.
 *
 * Hermetic: no Next import, so `test/nextCacheBoundary.test.ts` stays green.
 */

export const BUDGET_PREFIX = "budget ";

/** The producers that emit a line. `render` is one line per `/` render, not a producer. */
export type BudgetProducer = "edition" | "kev" | "ssvc" | "epss" | "render";

export type SsvcBudgetState = "assessed" | "not-assessed" | "failed";

/** Key order of every line; ssvc lines append `st`. */
export const BUDGET_KEYS = [
  "p",
  "ok",
  "ms",
  "cpuMs",
  "n",
  "bytes",
  "rcW",
  "rcR",
  "kvCmd",
] as const;

export type BudgetLine = {
  p: BudgetProducer;
  ok: 0 | 1;
  ms: number;
  cpuMs: number;
  n: number;
  bytes: number;
  rcW: number;
  rcR: number;
  kvCmd: number;
  st?: SsvcBudgetState;
};

/** What a producer reports about its own result; timings are measured by the helper. */
export type BudgetCounts = {
  n: number;
  bytes: number;
  rcW: number;
  rcR?: number;
  ok?: 0 | 1;
  st?: SsvcBudgetState;
};

const PRODUCERS: readonly BudgetProducer[] = ["edition", "kev", "ssvc", "epss", "render"];
const SSVC_STATES: readonly SsvcBudgetState[] = ["assessed", "not-assessed", "failed"];

/** Whole non-negative integer, or 0 for anything else (NaN, Infinity, negative). */
function count(v: number): number {
  return Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
}

/**
 * Builds the line from a fresh object in key order. Never throws on numeric
 * input; every number becomes a whole non-negative integer.
 */
export function formatBudgetLine(line: BudgetLine): string {
  const out: Record<string, unknown> = {};
  out.p = line.p;
  out.ok = line.ok === 1 ? 1 : 0;
  out.ms = count(line.ms);
  out.cpuMs = count(line.cpuMs);
  out.n = count(line.n);
  out.bytes = count(line.bytes);
  out.rcW = count(line.rcW);
  out.rcR = count(line.rcR);
  out.kvCmd = count(line.kvCmd);
  if (line.p === "ssvc") {
    out.st = line.st !== undefined && SSVC_STATES.includes(line.st) ? line.st : "failed";
  }
  return BUDGET_PREFIX + JSON.stringify(out);
}

/**
 * The strict inverse of `formatBudgetLine`. Anything that is not exactly a
 * line it would have written (prefix, key set and order, integer values, enum
 * literals) is null. Never throws.
 */
export function parseBudgetLine(message: string): BudgetLine | null {
  try {
    const text = message.trimEnd();
    if (!text.startsWith(BUDGET_PREFIX)) return null;
    const raw: unknown = JSON.parse(text.slice(BUDGET_PREFIX.length));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const obj = raw as Record<string, unknown>;

    const p = Object.hasOwn(obj, "p") ? obj.p : undefined;
    if (typeof p !== "string" || !PRODUCERS.includes(p as BudgetProducer)) return null;
    const expected: readonly string[] = p === "ssvc" ? [...BUDGET_KEYS, "st"] : BUDGET_KEYS;
    const keys = Object.keys(obj);
    if (keys.length !== expected.length || keys.some((k, i) => k !== expected[i])) return null;

    if (obj.ok !== 0 && obj.ok !== 1) return null;
    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
    const ms = num(obj.ms);
    const cpuMs = num(obj.cpuMs);
    const n = num(obj.n);
    const bytes = num(obj.bytes);
    const rcW = num(obj.rcW);
    const rcR = num(obj.rcR);
    const kvCmd = num(obj.kvCmd);
    if (
      ms === null ||
      cpuMs === null ||
      n === null ||
      bytes === null ||
      rcW === null ||
      rcR === null ||
      kvCmd === null
    ) {
      return null;
    }

    const parsed: BudgetLine = {
      p: p as BudgetProducer,
      ok: obj.ok,
      ms,
      cpuMs,
      n,
      bytes,
      rcW,
      rcR,
      kvCmd,
    };
    if (p === "ssvc") {
      if (typeof obj.st !== "string" || !SSVC_STATES.includes(obj.st as SsvcBudgetState)) {
        return null;
      }
      parsed.st = obj.st as SsvcBudgetState;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Runs `run`, measures it, and logs exactly one budget line. It returns the
 * very value `run` resolved to, or rethrows the very error `run` rejected with
 * (never wrapped, never inspected, never logged): a rejected `unstable_cache`
 * producer must still throw so the last good entry is kept (`snapshot.ts`
 * header item 7). Elapsed time and CPU are sampled right after `run` settles
 * and before `describe`, so any serialisation inside `describe` stays outside
 * the measurement. `describe`, formatting and `emit` run inside a swallowing
 * try/catch: logging can never change a producer's outcome.
 */
export async function withBudgetLine<T>(
  p: BudgetProducer,
  run: () => Promise<T>,
  describe: (value: T) => BudgetCounts,
  emit: (line: string) => void = (line) => console.info(line)
): Promise<T> {
  const t0 = performance.now();
  const c0 = process.cpuUsage();
  let value: T;
  try {
    value = await run();
  } catch (err) {
    const ms = performance.now() - t0;
    const cpu = process.cpuUsage(c0);
    try {
      emit(
        formatBudgetLine({
          p,
          ok: 0,
          ms,
          cpuMs: (cpu.user + cpu.system) / 1000,
          n: 0,
          bytes: 0,
          rcW: 0,
          rcR: 0,
          kvCmd: 0,
          st: p === "ssvc" ? "failed" : undefined,
        })
      );
    } catch {
      // logging must never change the producer's error
    }
    throw err;
  }
  const ms = performance.now() - t0;
  const cpu = process.cpuUsage(c0);
  try {
    const counts = describe(value);
    emit(
      formatBudgetLine({
        p,
        ok: counts.ok ?? 1,
        ms,
        cpuMs: (cpu.user + cpu.system) / 1000,
        n: counts.n,
        bytes: counts.bytes,
        rcW: counts.rcW,
        rcR: counts.rcR ?? 0,
        kvCmd: 0,
        st: counts.st,
      })
    );
  } catch {
    // logging must never change the producer's value
  }
  return value;
}

/**
 * The modelled Runtime Cache read operations of one `/` render: the edition
 * (1), the KEV map (1), one per SSVC lookup and one per EPSS batch fetch.
 */
export function renderReadOps(health: EnrichmentHealth): number {
  return (
    2 +
    Math.min(health.ssvc.requested, SSVC_MAX_LOOKUPS) +
    Math.ceil(Math.min(health.epss.requested, EPSS_MAX_IDS) / EPSS_BATCH_SIZE)
  );
}
