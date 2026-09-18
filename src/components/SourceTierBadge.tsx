import clsx from "clsx";
import type { SourceTier } from "@/lib/types";

/**
 * Tier-keyed colour classes for the pill. Only "Security Research" gets a
 * distinct colour in Phase 1 (CONTEXT.md D-04, Claude's Discretion) — the
 * other five tiers share a neutral default until Phase 2 wires up more
 * sources, or the Phase 4 polish pass finalizes the full six-colour
 * palette. Both variants below clear WCAG AA contrast (4.5:1) at this
 * pill's text size.
 */
const TIER_STYLES: Record<SourceTier, string> = {
  "Security Research":
    "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200",
  Government: "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200",
  "Enterprise Security":
    "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200",
  "Threat Intelligence":
    "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200",
  "Tech & General":
    "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200",
  "Executive News":
    "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200",
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
