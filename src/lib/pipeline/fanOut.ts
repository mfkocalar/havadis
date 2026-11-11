import type { Article, FrontPageResult, SourceConfig } from "../types.ts";
import { fetchSource } from "./fetchSource.ts";

/**
 * Fans a list of sources out to `fetcher` concurrently via
 * `Promise.allSettled` and flattens the successful results into one
 * article array.
 *
 * `Promise.allSettled` (not `Promise.all`) is load-bearing here per
 * RESEARCH.md Pitfall 5: a rejected settlement is just another array
 * element to skip, so it can never reach `getFrontPage`'s outer `catch`
 * and collapse every source into the page-wide error variant.
 *
 * An error-variant value (`{status:"error"}`) and a rejected settlement
 * are swallowed identically here — both contribute zero articles and are
 * never surfaced to the caller. This is CONTEXT.md D-05's
 * silent-degradation behaviour, carried over verbatim from Phase 1's
 * sequential loop: a broken source and a quiet source must look the same.
 *
 * `fetcher` defaults to `fetchSource` but is an explicit parameter so a
 * caller (e.g. Plan 02-03's tests) can inject a fetcher that rejects, to
 * exercise the otherwise-unreachable rejected-settlement branch given
 * `fetchSource`'s own never-throws contract.
 */
export async function fanOut(
  sources: SourceConfig[],
  fetcher: (source: SourceConfig) => Promise<FrontPageResult> = fetchSource
): Promise<Article[]> {
  const settled = await Promise.allSettled(sources.map((source) => fetcher(source)));
  const articles: Article[] = [];
  for (const outcome of settled) {
    if (outcome.status === "fulfilled" && outcome.value.status === "ok") {
      articles.push(...outcome.value.articles);
    }
    // A rejected settlement or a fulfilled {status:"error"} value are both
    // swallowed here, identically — see header comment above.
  }
  return articles;
}

/**
 * Fans `sources` out to `fetcher` with at most `opts.concurrency` calls in flight, and keeps every
 * source's own result and wall time, in input order (the ingest cycle needs per-source outcomes,
 * which `fanOut` deliberately flattens away).
 *
 * A rejection is mapped through `opts.onRejected` rather than propagated, so one failing source
 * never collapses the batch (RESEARCH Pitfall 5, same isolation as `fanOut`). `fanOut` itself is
 * unchanged. `durationMs` is a monotonic measurement, not a wall-clock read the pipeline depends on.
 */
export function fanOutWithOutcomes<R>(
  sources: readonly SourceConfig[],
  fetcher: (source: SourceConfig) => Promise<R>,
  opts: { concurrency: number; onRejected: (source: SourceConfig) => R }
): Promise<Array<{ source: SourceConfig; result: R; durationMs: number }>> {
  return runWithOutcomes(sources, fetcher, opts);
}

async function runWithOutcomes<R>(
  sources: readonly SourceConfig[],
  fetcher: (source: SourceConfig) => Promise<R>,
  opts: { concurrency: number; onRejected: (source: SourceConfig) => R }
): Promise<Array<{ source: SourceConfig; result: R; durationMs: number }>> {
  const out: Array<{ source: SourceConfig; result: R; durationMs: number }> = new Array(sources.length);
  const limit = Math.max(1, Math.floor(opts.concurrency));
  let next = 0;

  async function worker(): Promise<void> {
    while (next < sources.length) {
      const index = next++;
      const source = sources[index];
      const started = performance.now();
      let result: R;
      try {
        result = await fetcher(source);
      } catch {
        result = opts.onRejected(source);
      }
      out[index] = { source, result, durationMs: Math.max(0, Math.round(performance.now() - started)) };
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, sources.length) }, () => worker()));
  return out;
}
