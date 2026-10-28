import clsx from "clsx";
import { SECTION_DISPLAY_ORDER } from "@/lib/config/sections";
import type { Section } from "@/lib/types";

/**
 * A section's hazard-class diamond: the section's place in urgency order
 * (SECTION_DISPLAY_ORDER, 1 = most urgent) on a placard-coloured diamond.
 * The number is stable across editions because it comes from the fixed
 * display order, not from which sections happen to be present today.
 *
 * Decorative only (`aria-hidden`): the section name always sits beside it.
 * Every fill/number pair is at least 4.5:1.
 */
const CLASS_TONE: Record<Section, { fill: string; ink: string }> = {
  Vulnerabilities: { fill: "bg-red-600", ink: "text-white" },
  Advisories: { fill: "bg-orange-500", ink: "text-stone-950" },
  // Class 3 is split like a corrosives placard: white over black. No single
  // ink reaches 4.5:1 on both halves, so its number sits on a small white plate.
  Ransomware: {
    fill: "bg-linear-to-br from-white from-50% to-stone-950 to-50%",
    ink: "rounded-[2px] bg-white px-[3px] text-stone-950 ring-1 ring-stone-950",
  },
  Breaches: { fill: "bg-yellow-400", ink: "text-stone-950" },
  "Threat Intelligence": { fill: "bg-blue-700", ink: "text-white" },
  "Tools/Techniques": { fill: "bg-white", ink: "text-stone-950" },
  "Industry/Policy": { fill: "bg-green-700", ink: "text-white" },
};

const SIZE = {
  sm: { box: "size-6", text: "text-[0.8125rem]" },
  lg: { box: "size-8 sm:size-9", text: "text-base sm:text-lg" },
} as const;

export function SectionMark({ section, size = "sm" }: { section: Section; size?: keyof typeof SIZE }) {
  const { box, text } = SIZE[size];
  const { fill, ink } = CLASS_TONE[section];
  return (
    <span aria-hidden="true" className={clsx("relative inline-grid shrink-0 place-items-center", box)}>
      <span
        className={clsx(
          "absolute inset-[14%] rotate-45 rounded-[2px] border-2 border-stone-950 dark:border-stone-400",
          fill,
        )}
      />
      <span className={clsx("relative font-display leading-none font-extrabold", text, ink)}>
        {SECTION_DISPLAY_ORDER.indexOf(section) + 1}
      </span>
    </span>
  );
}
