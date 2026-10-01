/**
 * Complete Tailwind class strings for the front-page filter controls (D-08).
 *
 * Every constant is a whole literal, never concatenated fragments, because
 * Tailwind only emits classes it sees whole in source. Colours stay inside
 * the neutral zinc system (Phase 3 D-15: red is reserved for CVE chips; no
 * urgency colour cue).
 *
 * AMENDMENT to 04-UI-SPEC.md Color (flagged for sign-off): the unpressed
 * outline uses `ring-zinc-500` in both themes. The approved spec said
 * `ring-zinc-400` (light) and `dark:ring-zinc-600`, which measure about
 * 2.6:1 on white and 2.3:1 on zinc-900 -- under the 3:1 non-text contrast
 * target (WCAG 2.1 SC 1.4.11) for a control whose outline is its only
 * visible boundary (04-RESEARCH.md Pitfall 7). `filterControlStyles.test.ts`
 * enforces the new values against the installed palette. Reverting is a
 * one-constant edit (`NEUTRAL_CONTROL_CLASSES`).
 */

/** Visible keyboard focus ring shared by every filter control. */
export const CONTROL_FOCUS_CLASSES =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-50";

/**
 * Unpressed outline + text + hover, shared by the unpressed pill and by the
 * "Show all N" expander button (plan 04-02). zinc-500 amends the UI-SPEC's
 * zinc-400 / zinc-600 (see header, Pitfall 7).
 */
export const NEUTRAL_CONTROL_CLASSES =
  "text-zinc-700 ring-1 ring-inset ring-zinc-500 hover:bg-zinc-100 dark:text-zinc-300 dark:ring-zinc-500 dark:hover:bg-zinc-800";

/**
 * Pill geometry: 44px tall below 768px, 32px from 768px up; never wraps or
 * squashes its label (long-text row of the UI-SPEC UI Considerations).
 */
export const PILL_BASE_CLASSES =
  "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium whitespace-nowrap md:min-h-8";

export const PILL_UNPRESSED_CLASSES = "bg-white dark:bg-zinc-900";

/** Pressed state: neutral zinc inversion, no hue. */
export const PILL_PRESSED_CLASSES =
  "bg-zinc-900 text-zinc-50 ring-1 ring-inset ring-zinc-900 dark:bg-zinc-50 dark:text-zinc-900 dark:ring-zinc-50";

/** Muted text: unpressed pill count, and 04-02's "Updated" text. */
export const MUTED_CONTROL_TEXT_CLASSES = "text-zinc-600 dark:text-zinc-400";

/** Count text on the pressed (inverted) pill fill. */
export const PRESSED_COUNT_TEXT_CLASSES = "text-zinc-300 dark:text-zinc-600";
