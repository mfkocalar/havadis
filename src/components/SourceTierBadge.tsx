import type { SourceTier } from "@/lib/types";

/**
 * The tier is context, not a signal: in the hazard-placard world colour is
 * reserved for section class, importance and exploitation, so every tier
 * shares one neutral outlined tag in condensed caps (ink on the page ground,
 * 4.5:1 or better in both themes).
 */
const TIER_TAG_CLASSES =
  "inline-flex items-center rounded-xs px-1.5 font-display text-xs leading-5 font-bold tracking-wider whitespace-nowrap text-stone-700 uppercase ring-1 ring-inset ring-stone-400 dark:text-stone-300 dark:ring-stone-600";

/**
 * The tier describes the source, not the story, and one tier name ("Threat
 * Intelligence") is also a section name. The title and the visually hidden
 * prefix say which one this is.
 */
export function SourceTierBadge({ tier }: { tier: SourceTier }) {
  return (
    <span
      title={`Source category: ${tier}`}
      className={TIER_TAG_CLASSES}
    >
      <span className="sr-only">Source category: </span>
      {tier}
    </span>
  );
}
