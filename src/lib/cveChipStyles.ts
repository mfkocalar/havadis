/**
 * Complete Tailwind class strings for the KEV and EPSS chips (D-04, D-06).
 *
 * Every constant is a whole literal, never concatenated fragments, because
 * Tailwind only emits classes it sees whole in source. Red is reserved for the
 * CVE chip (light red) and the KEV chip (filled red); EPSS stays in the
 * neutral pill family, with amber for a score at or above
 * `EPSS_EMPHASIS_THRESHOLD`. `cveChipStyles.test.ts` measures every text and
 * background pair against the installed Tailwind palette in light and dark
 * (4.5:1, WCAG SC 1.4.3), so a tone edit that loses contrast fails the suite.
 */

/** KEV chip: filled red with white text (6.42:1, same tone in both themes). */
export const KEV_CHIP_CLASSES =
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap bg-red-700 text-white tabular-nums";

/** EPSS score below the emphasis threshold: neutral zinc, still shown (D-06). */
export const EPSS_CHIP_CLASSES =
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap bg-zinc-100 text-zinc-700 ring-1 ring-inset ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700 tabular-nums";

/** EPSS score at or above the emphasis threshold: amber (D-06). */
export const EPSS_STRONG_CHIP_CLASSES =
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800 tabular-nums";

/** "no EPSS yet": the same geometry in a muted tone (D-07). */
export const EPSS_NONE_YET_CHIP_CLASSES =
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap bg-zinc-50 text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-700";
