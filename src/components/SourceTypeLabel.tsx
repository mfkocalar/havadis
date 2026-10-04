import { SOURCE_TYPE_LABEL } from "@/lib/config/sourceTypes";
import type { SourceType } from "@/lib/types";

/**
 * The plain-text source-type label shown on every article card (SRC-01).
 *
 * Deliberately quieter than the tier pill (UI-SPEC): no pill geometry and no
 * hue, so a reader sees one coloured pill per card and one neutral word beside
 * it (D-02). `text-zinc-600` on white is about 7.7:1 and `text-zinc-400` on
 * zinc-900 about 7:1, both above WCAG AA at 12px. `whitespace-nowrap` keeps the
 * longest value, "Government", from splitting; the card's meta row is
 * `flex-wrap`, so the label wraps as a unit instead.
 *
 * The visible word is a plain JSX text node from the typed
 * `SOURCE_TYPE_LABEL` map, never from feed text (threat T-05-06). The sr-only
 * prefix tells screen-reader users what the word means.
 */
export function SourceTypeLabel({ type }: { type: SourceType }) {
  return (
    <span className="text-xs font-medium whitespace-nowrap text-zinc-600 dark:text-zinc-400">
      <span className="sr-only">Source type: </span>
      {SOURCE_TYPE_LABEL[type]}
    </span>
  );
}
