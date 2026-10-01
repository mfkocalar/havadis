import type { Section } from "./types.ts";

/**
 * Pure filter logic for the front-page section pills (FILTER-01).
 *
 * D-09: selecting nothing means "no filter" -- every section is visible --
 * so deselecting the last pressed pill is the reset and an empty result is
 * unreachable. Copy strings follow the 04-UI-SPEC.md Copywriting Contract.
 *
 * This module has no runtime imports (the `Section` import is type-only), so
 * `node --test` can load it directly and it adds nothing but these functions
 * to the client bundle. It deliberately never imports the sections config,
 * which also exports every classification keyword list.
 */

/** One filter pill: all props are closed-enum / constant / number (T-01-07). */
export type FilterPill = { section: Section; emoji: string; count: number };

/** Returns a NEW set with `section` added when absent, removed when present. */
export function toggleSection(
  selected: ReadonlySet<Section>,
  section: Section,
): ReadonlySet<Section> {
  const next = new Set(selected);
  if (next.has(section)) {
    next.delete(section);
  } else {
    next.add(section);
  }
  return next;
}

/** D-09: an empty selection shows everything; otherwise only selected ones. */
export function isSectionVisible(
  selected: ReadonlySet<Section>,
  section: Section,
): boolean {
  return selected.size === 0 || selected.has(section);
}

/** Text for the visually hidden live region announced after each toggle. */
export function filterStatusMessage(
  selectedCount: number,
  sectionCount: number,
): string {
  const noun = sectionCount === 1 ? "section" : "sections";
  if (selectedCount === 0) {
    return `Showing all ${sectionCount} ${noun}`;
  }
  return `Showing ${selectedCount} of ${sectionCount} ${noun}`;
}

/** Visually hidden suffix that completes a control's accessible name. */
export function articleCountLabel(count: number): string {
  return `, ${count} ${count === 1 ? "article" : "articles"}`;
}
