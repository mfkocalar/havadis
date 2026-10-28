import { SOURCE_TYPE_LABEL } from "@/lib/config/sourceTypes";
import type { SourceType } from "@/lib/types";

/**
 * The plain-text source-type label shown on every article card (SRC-01).
 *
 * Deliberately quieter than the tier tag (UI-SPEC): no tag geometry and no
 * hue, just one neutral word beside it (D-02). `text-stone-600` on the light
 * ground and `text-stone-400` on the dark one are both above WCAG AA at 12px. `whitespace-nowrap` keeps the
 * longest value, "Government", from splitting; the card's meta row is
 * `flex-wrap`, so the label wraps as a unit instead.
 *
 * The visible word is a plain JSX text node from the typed
 * `SOURCE_TYPE_LABEL` map, never from feed text (threat T-05-06). The sr-only
 * prefix tells screen-reader users what the word means.
 */
export function SourceTypeLabel({ type }: { type: SourceType }) {
  return (
    <span className="text-xs font-semibold whitespace-nowrap text-stone-600 dark:text-stone-400">
      <span className="sr-only">Source type: </span>
      {SOURCE_TYPE_LABEL[type]}
    </span>
  );
}
