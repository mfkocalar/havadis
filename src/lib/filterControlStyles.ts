/**
 * Complete Tailwind class strings for the front-page filter controls (D-08).
 *
 * Every constant is a whole literal, never concatenated fragments, because
 * Tailwind only emits classes it sees whole in source. Controls stay in the
 * warm `stone` ink system of the hazard-placard world: colour is reserved for
 * section class, importance and exploitation signals, never for a control's
 * own state.
 *
 * The unpressed outline is `ring-stone-500` in both themes, at least 3:1
 * against the page ground (WCAG 2.1 SC 1.4.11) because it is the control's
 * only visible boundary (04-RESEARCH.md Pitfall 7).
 * `filterControlStyles.test.ts` enforces every pair against the installed
 * palette and the real page grounds in globals.css.
 */

/** Visible keyboard focus ring shared by every filter control. */
export const CONTROL_FOCUS_CLASSES =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-950 dark:focus-visible:outline-stone-100";

/**
 * Unpressed outline + text + hover, shared by the unpressed pill and by the
 * "Show all N" expander button (plan 04-02).
 */
export const NEUTRAL_CONTROL_CLASSES =
  "text-stone-800 ring-1 ring-inset ring-stone-500 hover:bg-stone-200 dark:text-stone-200 dark:ring-stone-500 dark:hover:bg-stone-800";

/**
 * Pill geometry: 44px tall below 768px, 32px from 768px up; never wraps or
 * squashes its label (long-text row of the UI-SPEC UI Considerations).
 * Square-shouldered like a placard, not a rounded pill.
 */
export const PILL_BASE_CLASSES =
  "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xs px-3 text-sm font-semibold whitespace-nowrap md:min-h-8";

export const PILL_UNPRESSED_CLASSES = "bg-background";

/** Pressed state: ink inversion, no hue. */
export const PILL_PRESSED_CLASSES =
  "bg-stone-950 text-stone-50 ring-1 ring-inset ring-stone-950 dark:bg-stone-100 dark:text-stone-950 dark:ring-stone-100";

/** Muted text: unpressed pill count, and 04-02's "Updated" text. */
export const MUTED_CONTROL_TEXT_CLASSES = "text-stone-600 dark:text-stone-400";

/** Count text on the pressed (inverted) pill fill. */
export const PRESSED_COUNT_TEXT_CLASSES = "text-stone-300 dark:text-stone-600";

/**
 * A section pill whose filtered count is zero: muted ink instead of opacity
 * dimming, so its label still reaches 4.5:1 on the page ground, with the
 * class diamond drained of colour. Replaces NEUTRAL_CONTROL_CLASSES.
 */
export const ZERO_COUNT_CONTROL_CLASSES =
  "text-stone-600 ring-1 ring-inset ring-stone-500 dark:text-stone-400 dark:ring-stone-500 [&>span:first-child]:grayscale";

/**
 * A row the reader has marked read: the whole row drains to greyscale (which
 * keeps each placard's luminance contrast) and its headline, reason and
 * summary drop to muted ink that still reaches 4.5:1 on the page ground.
 */
export const READ_ROW_CLASSES =
  "grayscale [&_h3]:text-stone-600 [&_p]:text-stone-600 dark:[&_h3]:text-stone-400 dark:[&_p]:text-stone-400";
