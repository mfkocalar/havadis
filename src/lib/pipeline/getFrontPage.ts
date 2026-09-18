import { SOURCES } from "../config/sources.ts";
import type { Article, FrontPageResult } from "../types.ts";
import { fetchSource } from "./fetchSource.ts";
import { filterLookback } from "./filterLookback.ts";

/**
 * The single orchestrator: iterates `SOURCES`, awaits `fetchSource` for
 * each, applies the 24h lookback filter, and returns the discriminated
 * result. Never throws.
 *
 * Phase 1 iterates sequentially over one source. The loop shape is kept
 * so Phase 2 can switch this to a parallel fan-out over thirteen entries
 * (e.g. `Promise.all`) without reshaping the return value.
 */
export async function getFrontPage(): Promise<FrontPageResult> {
  try {
    const articles: Article[] = [];
    for (const source of SOURCES) {
      const result = await fetchSource(source);
      if (result.status === "ok") {
        articles.push(...result.articles);
      }
      // A per-source failure is swallowed here rather than propagated:
      // with Phase 1's single source, a failure yields zero articles and
      // the page renders CONTEXT.md D-03's quiet empty-state message —
      // the same treatment as a genuinely empty 24h window.
    }
    return { status: "ok", articles: filterLookback(articles) };
  } catch (err) {
    return {
      status: "error",
      reason: err instanceof Error ? err.message : "unknown getFrontPage error",
    };
  }
}
