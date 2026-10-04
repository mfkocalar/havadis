import { LOOKBACK_HOURS } from "../config/sourceTypes.ts";
import type { Article, FrontPageResult, SourceConfig } from "../types.ts";
import { filterLookback } from "./filterLookback.ts";

/**
 * Applies one source's lookback window, resolved from its `sourceType`
 * (`LOOKBACK_HOURS`, D-05), to the articles that source produced.
 *
 * When `source.maxItems` is a positive integer, the in-window articles are
 * additionally capped to the newest `maxItems` (D-07, T-05-12). The lookback
 * runs before the cap, because capping first would let old stragglers
 * occupy the cap (RESEARCH anti-pattern). The input is never mutated.
 *
 * Needs per-source grouping, which only exists before `fanOut` flattens the
 * results. Never reads the wall clock: the caller passes `now`.
 */
export function applySourceWindow(
  articles: Article[],
  source: SourceConfig,
  now: number
): Article[] {
  const kept = filterLookback(articles, LOOKBACK_HOURS[source.sourceType], now);
  const cap = source.maxItems;
  if (cap === undefined || !Number.isInteger(cap) || cap <= 0) return kept;
  return [...kept]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, cap);
}

/**
 * Wraps a per-source fetcher so each source's articles are windowed by its
 * own type before `fanOut` flattens them.
 *
 * Windowing wraps the fetcher instead of living in `fanOut` because
 * `fanOut`'s tests inject 2026-01-01 fixtures that must survive (RESEARCH
 * Pattern 1). An "error" result is returned unchanged; a rejection is not
 * caught here, since `fanOut`'s `Promise.allSettled` already swallows it.
 * Never reads the wall clock.
 */
export function withSourceWindow(
  fetcher: (source: SourceConfig) => Promise<FrontPageResult>,
  now: number
): (source: SourceConfig) => Promise<FrontPageResult> {
  return async (source) => {
    const result = await fetcher(source);
    if (result.status !== "ok") return result;
    return { status: "ok", articles: applySourceWindow(result.articles, source, now) };
  };
}
