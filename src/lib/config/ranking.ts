import type { SourceTier } from "../types.ts";

/**
 * Within-section ranking config (CLASSIFY-02, D-09/D-10). `score =
 * TIER_WEIGHT[sourceTier] * recencyDecay(age)`; only tier weight and
 * recency count — no multi-outlet coverage boost, no source-diversity
 * penalty (D-11). Weight is a ranking input only and is never rendered —
 * tier badges stay visually equal (Phase 2 D-01/D-03).
 */

/**
 * D-10 rough ordering: Government highest; Security Research and Threat
 * Intelligence high; Enterprise Security and Executive News mid; Tech &
 * General lowest. Exact numbers are Claude's discretion per CONTEXT.md.
 */
export const TIER_WEIGHT: Record<SourceTier, number> = {
  Government: 1.5,
  "Security Research": 1.3,
  "Threat Intelligence": 1.3,
  "Enterprise Security": 1.15,
  "Executive News": 1.15,
  "Tech & General": 1.0,
};

/**
 * Half-life decay chosen over linear decay so no article ever scores
 * exactly zero at the 24h lookback boundary (that cutoff belongs to
 * `filterLookback`, a separate concern). With this half-life, a
 * Government-tier item stays above a brand-new Tech & General item until
 * roughly 3.5 hours old — matching D-09's "a high-weight article a few
 * hours old can outrank a low-weight one from minutes ago."
 */
export const RANK_HALF_LIFE_HOURS = 6;

/**
 * `ageMs` is clamped with `Math.max(0, ageMs)` BEFORE the exponent: a
 * future `publishedAt` (RESEARCH.md Pitfall 1 — live evidence: Dark
 * Reading's "[Virtual Event] Cybersecurity Outlook 2027" item, dated 71
 * days ahead of the fetch instant) would otherwise produce a negative age
 * and an astronomically large, permanently top-ranked score for a
 * non-news item (threat T-03-03). `formatRelativeTime.ts` already does the
 * display-layer equivalent clamp — this is precedent, not novel territory.
 * A non-finite `ageMs` (an unparseable `publishedAt`) also returns 0 rather
 * than NaN, so a malformed date sinks to the bottom instead of poisoning
 * the sort comparator.
 */
export function recencyDecay(ageMs: number): number {
  if (!Number.isFinite(ageMs)) return 0;
  const clampedAgeHours = Math.max(0, ageMs) / 3_600_000;
  return Math.pow(0.5, clampedAgeHours / RANK_HALF_LIFE_HOURS);
}
