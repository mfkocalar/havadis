/**
 * Complete Tailwind class strings for the KEV and EPSS chips (D-04, D-06).
 *
 * Every constant is a whole literal, never concatenated fragments, because
 * Tailwind only emits classes it sees whole in source. The chips share the
 * square-shouldered placard geometry of the CVE identification panel. KEV is
 * the strongest signal and inverts to solid ink (black on the light ground,
 * white on the dark one); EPSS stays outlined and neutral, with hazard yellow
 * for a score at or above `EPSS_EMPHASIS_THRESHOLD`. `cveChipStyles.test.ts`
 * measures every text and background pair against the installed Tailwind
 * palette in light and dark (4.5:1, WCAG SC 1.4.3), so a tone edit that loses
 * contrast fails the suite.
 */

/** KEV chip: solid ink, inverted per theme. */
export const KEV_CHIP_CLASSES =
  "inline-flex items-center rounded-xs px-1.5 py-0.5 font-mono text-xs leading-5 font-bold whitespace-nowrap bg-stone-950 text-white dark:bg-stone-100 dark:text-stone-950";

/** EPSS score below the emphasis threshold: neutral outline, still shown (D-06). */
export const EPSS_CHIP_CLASSES =
  "inline-flex items-center rounded-xs px-1.5 py-0.5 font-mono text-xs leading-5 font-bold whitespace-nowrap bg-white text-stone-800 ring-1 ring-inset ring-stone-400 dark:bg-stone-900 dark:text-stone-200 dark:ring-stone-600";

/** EPSS score at or above the emphasis threshold: hazard yellow (D-06). */
export const EPSS_STRONG_CHIP_CLASSES =
  "inline-flex items-center rounded-xs px-1.5 py-0.5 font-mono text-xs leading-5 font-bold whitespace-nowrap bg-yellow-300 text-stone-950 ring-1 ring-inset ring-stone-950 dark:bg-yellow-300 dark:text-stone-950";

/** "no EPSS yet": the same geometry in a muted, dashed tone (D-07). */
export const EPSS_NONE_YET_CHIP_CLASSES =
  "inline-flex items-center rounded-xs px-1.5 py-0.5 font-mono text-xs leading-5 font-bold whitespace-nowrap bg-stone-100 text-stone-600 outline-1 -outline-offset-1 outline-dashed outline-stone-400 dark:bg-stone-900 dark:text-stone-400 dark:outline-stone-600";
