import { MIN_HIDDEN_TO_COLLAPSE, SECTION_CARD_CAP } from "./config/frontPageLayout.ts";

/**
 * Pure cap planner for one section (D-05, D-06, D-07). Given the section's
 * full article count it says how many cards render up front and how many go
 * behind "Show all N". Only totals of `SECTION_CARD_CAP + MIN_HIDDEN_TO_COLLAPSE`
 * (9) or more collapse; smaller sections render in full.
 *
 * The split never reorders: the caller slices the already-ranked list at
 * `visibleCount`, so the visible cards are always the highest-ranked (D-07).
 * A negative or non-integer total returns `{0, 0}` without throwing.
 */
export function planSectionCap(total: number): { visibleCount: number; hiddenCount: number } {
  if (!Number.isInteger(total) || total < 0) return { visibleCount: 0, hiddenCount: 0 };

  const hidden = total - SECTION_CARD_CAP;
  if (hidden >= MIN_HIDDEN_TO_COLLAPSE) {
    return { visibleCount: SECTION_CARD_CAP, hiddenCount: hidden };
  }
  return { visibleCount: total, hiddenCount: 0 };
}
