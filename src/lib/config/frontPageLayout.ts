/**
 * Front-page section length config (Phase 4 D-05, D-06). Pure data: no
 * imports, no logic. Consumed by `planSectionCap`.
 */

/**
 * D-05: a long section shows only its top 6 cards before "Show all N". 6 fills
 * whole rows at both the 2-column and 3-column grid widths.
 */
export const SECTION_CARD_CAP = 6;

/**
 * D-06: hiding fewer than 3 cards is not worth a click, so a section only
 * collapses when at least this many cards would be hidden. Totals 7 and 8
 * therefore render in full.
 */
export const MIN_HIDDEN_TO_COLLAPSE = 3;
