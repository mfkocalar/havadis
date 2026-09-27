import { SOURCES } from "../config/sources.ts";
import type { Article, SectionedFrontPageResult } from "../types.ts";
import { classify } from "./classify.ts";
import { dedupe } from "./dedupe.ts";
import { fanOut } from "./fanOut.ts";
import { filterLookback } from "./filterLookback.ts";
import { groupBySection } from "./groupBySection.ts";

/**
 * Pure, synchronous seam composing the post-fetch pipeline stages:
 * dedupe the same story arriving from more than one source down to its
 * earliest copy (NORM-02, D-01/D-02/D-03), then classify each surviving
 * article into its `Section`, then group into non-empty `SectionGroup`s,
 * ranked within each section by tier weight x recency decay (CLASSIFY-02)
 * and ordered by `SECTION_DISPLAY_ORDER` (D-12). `sections` is the runtime
 * authority; the flat `articles` field is always derived from it
 * (`sections.flatMap((g) => g.articles)`), never computed independently
 * (RESEARCH.md Open Question 1). `now` is threaded straight through to
 * `groupBySection`/`rankWithinSection` — nothing in this composition reads
 * the clock itself (D-09). Exists as its own export so later plans (and
 * this plan's own tests) can prove the composed pipeline hermetically,
 * without touching the network.
 *
 * Stage order: dedupe -> classify -> groupBySection (ranking within).
 * Dedupe runs first so classification and ranking only ever see one card
 * per story — this is also what makes `page.tsx`'s `key={article.url}`
 * safe to rely on for uniqueness (dedupe guarantees no two surviving
 * articles share a `url`).
 */
export function composeFrontPage(
  articles: Article[],
  now: number
): Extract<SectionedFrontPageResult, { status: "ok" }> {
  const deduped = dedupe(articles);
  const classified = deduped.map((article) => ({ ...article, section: classify(article) }));
  const sections = groupBySection(classified, now);
  return { status: "ok", articles: sections.flatMap((group) => group.articles), sections };
}

/**
 * The single orchestrator: fans `SOURCES` out concurrently via `fanOut`
 * (a `Promise.allSettled` fan-out over the never-throwing `fetchSource`),
 * applies the 24h lookback filter, then composes the classify/rank/group
 * stages via `composeFrontPage`, and returns the discriminated result.
 * Never throws. `now` defaults to `Date.now()`, sampled once per render
 * (D-09) — never read again inside the composed pipeline.
 *
 * A per-source failure is swallowed inside `fanOut` rather than
 * propagated here — a failure yields zero articles for that source and
 * the page renders CONTEXT.md D-03's quiet empty-state message, the same
 * treatment as a genuinely empty 24h window.
 */
export async function getFrontPage(now: number = Date.now()): Promise<SectionedFrontPageResult> {
  try {
    return composeFrontPage(filterLookback(await fanOut(SOURCES)), now);
  } catch (err) {
    return {
      status: "error",
      reason: err instanceof Error ? err.message : "unknown getFrontPage error",
    };
  }
}
