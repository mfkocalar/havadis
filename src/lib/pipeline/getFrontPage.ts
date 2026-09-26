import { SOURCES } from "../config/sources.ts";
import type { Article, SectionedFrontPageResult } from "../types.ts";
import { classify } from "./classify.ts";
import { fanOut } from "./fanOut.ts";
import { filterLookback } from "./filterLookback.ts";
import { groupBySection } from "./groupBySection.ts";
import { sortByRecencyDesc } from "./sortByRecencyDesc.ts";

/**
 * Pure, synchronous seam composing the post-fetch pipeline stages:
 * recency-sort (interim within-section order — Task 2 replaces this with
 * `rankWithinSection`), classify each article into its `Section`, then
 * group into non-empty `SectionGroup`s in `SECTION_DISPLAY_ORDER` (D-12).
 * `sections` is the runtime authority; the flat `articles` field is always
 * derived from it (`sections.flatMap((g) => g.articles)`), never computed
 * independently (RESEARCH.md Open Question 1). Exists as its own export so
 * later plans (and this plan's own tests) can prove the composed pipeline
 * hermetically, without touching the network.
 */
export function composeFrontPage(
  articles: Article[]
): Extract<SectionedFrontPageResult, { status: "ok" }> {
  const classified = sortByRecencyDesc(articles).map((article) => ({
    ...article,
    section: classify(article),
  }));
  const sections = groupBySection(classified);
  return { status: "ok", articles: sections.flatMap((group) => group.articles), sections };
}

/**
 * The single orchestrator: fans `SOURCES` out concurrently via `fanOut`
 * (a `Promise.allSettled` fan-out over the never-throwing `fetchSource`),
 * applies the 24h lookback filter, then composes the classify/group stages
 * via `composeFrontPage`, and returns the discriminated result. Never
 * throws.
 *
 * A per-source failure is swallowed inside `fanOut` rather than
 * propagated here — a failure yields zero articles for that source and
 * the page renders CONTEXT.md D-03's quiet empty-state message, the same
 * treatment as a genuinely empty 24h window.
 */
export async function getFrontPage(): Promise<SectionedFrontPageResult> {
  try {
    return composeFrontPage(filterLookback(await fanOut(SOURCES)));
  } catch (err) {
    return {
      status: "error",
      reason: err instanceof Error ? err.message : "unknown getFrontPage error",
    };
  }
}
