import { SOURCES } from "../config/sources.ts";
import type { FrontPageResult } from "../types.ts";
import { fanOut } from "./fanOut.ts";
import { filterLookback } from "./filterLookback.ts";
import { sortByRecencyDesc } from "./sortByRecencyDesc.ts";

/**
 * The single orchestrator: fans `SOURCES` out concurrently via `fanOut`
 * (a `Promise.allSettled` fan-out over the never-throwing `fetchSource`),
 * applies the 24h lookback filter, sorts the survivors newest-first, and
 * returns the discriminated result. Never throws.
 *
 * A per-source failure is swallowed inside `fanOut` rather than
 * propagated here — a failure yields zero articles for that source and
 * the page renders CONTEXT.md D-03's quiet empty-state message, the same
 * treatment as a genuinely empty 24h window.
 */
export async function getFrontPage(): Promise<FrontPageResult> {
  try {
    return { status: "ok", articles: sortByRecencyDesc(filterLookback(await fanOut(SOURCES))) };
  } catch (err) {
    return {
      status: "error",
      reason: err instanceof Error ? err.message : "unknown getFrontPage error",
    };
  }
}
