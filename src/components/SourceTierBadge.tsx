import clsx from "clsx";
import type { SourceTier } from "@/lib/types";

/**
 * Tier-keyed colour classes for the pill. All six tiers now carry a
 * distinct hue (CONTEXT.md D-01, D-03 — this phase's deliverable): the
 * "Security Research" indigo row is locked from Phase 1 (D-04) and
 * untouched here; the other five hues were chosen this phase to
 * complement it, not the reverse. Every row uses the identical
 * `{hue}-50 / {hue}-700 / {hue}-200` shade-step construction, which is
 * what carries WCAG AA (4.5:1) text contrast across all six hues and
 * keeps them reading as one palette. Red and orange are deliberately
 * absent from every row (D-02) — reserved for Phase 3's CVE-ID chips and
 * Phase 4's urgency cues, so tier badges never visually compete with
 * those higher-signal elements.
 */
const TIER_STYLES: Record<SourceTier, string> = {
  "Security Research":
    "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200 dark:bg-indigo-400/10 dark:text-indigo-300 dark:ring-indigo-400/30",
  Government:
    "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200 dark:bg-blue-400/10 dark:text-blue-300 dark:ring-blue-400/30",
  "Enterprise Security":
    "bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200 dark:bg-teal-400/10 dark:text-teal-300 dark:ring-teal-400/30",
  "Threat Intelligence":
    "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200 dark:bg-violet-400/10 dark:text-violet-300 dark:ring-violet-400/30",
  "Tech & General":
    "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/30",
  "Executive News":
    "bg-fuchsia-50 text-fuchsia-700 ring-1 ring-inset ring-fuchsia-200 dark:bg-fuchsia-400/10 dark:text-fuchsia-300 dark:ring-fuchsia-400/30",
};

/**
 * The tier describes the source, not the story, and one tier name ("Threat
 * Intelligence") is also a section name. The title and the visually hidden
 * prefix say which one this is.
 */
export function SourceTierBadge({ tier }: { tier: SourceTier }) {
  return (
    <span
      title={`Source category: ${tier}`}
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TIER_STYLES[tier],
      )}
    >
      <span className="sr-only">Source category: </span>
      {tier}
    </span>
  );
}
