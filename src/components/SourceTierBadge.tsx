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
    "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200",
  Government: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200",
  "Enterprise Security":
    "bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200",
  "Threat Intelligence":
    "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200",
  "Tech & General":
    "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
  "Executive News":
    "bg-fuchsia-50 text-fuchsia-700 ring-1 ring-inset ring-fuchsia-200",
};

export function SourceTierBadge({ tier }: { tier: SourceTier }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TIER_STYLES[tier],
      )}
    >
      {tier}
    </span>
  );
}
