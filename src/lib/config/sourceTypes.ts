import type { SourceType } from "../types.ts";

/**
 * Every `SourceType`, in the order the plan lists them (Phase 5 D-01).
 * Tests use this to assert that each value is actually used by some source.
 */
export const SOURCE_TYPES: readonly SourceType[] = [
  "news",
  "research",
  "vendor",
  "cert",
  "government",
];

/**
 * Reader-facing label for each source type (UI-SPEC copywriting table).
 *
 * An exhaustive `Record` keyed by `SourceType`: adding a new type to the union
 * without a label here is a compile error (mirrors `TIER_STYLES` in
 * `SourceTierBadge.tsx`). The map lives in this plain `.ts` file rather than in
 * `SourceTypeLabel.tsx` because `node --test` cannot load `.tsx` files or the
 * `@/` alias; that is an intentional deviation from UI-SPEC, and the visible
 * contract (text, classes, order) is unchanged.
 *
 * Label text only ever comes from this map, keyed by the typed config value,
 * never from feed data (threat T-05-06, D-02).
 */
export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  news: "News",
  research: "Research",
  vendor: "Vendor",
  cert: "CERT",
  government: "Government",
};
