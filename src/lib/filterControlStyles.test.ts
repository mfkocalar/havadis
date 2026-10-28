import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contrast, hexToLinear, paletteColor, type Rgb } from "../../test/fixtures/contrast.ts";
import {
  CONTROL_FOCUS_CLASSES,
  MUTED_CONTROL_TEXT_CLASSES,
  NEUTRAL_CONTROL_CLASSES,
  PILL_PRESSED_CLASSES,
  PILL_UNPRESSED_CLASSES,
  PRESSED_COUNT_TEXT_CLASSES,
  READ_ROW_CLASSES,
  ZERO_COUNT_CONTROL_CLASSES,
} from "./filterControlStyles.ts";

/**
 * WCAG contrast gate for the filter controls (D-08). Measures every control
 * colour pair against the REAL installed Tailwind palette (oklch values
 * parsed from tailwindcss/theme.css) and the real page grounds parsed from
 * globals.css (`bg-background`), in light and dark. Text pairs need 4.5:1 (SC 1.4.3);
 * non-text pairs (outlines, fills, focus ring) need 3:1 (SC 1.4.11). This is
 * what keeps the unpressed outline at 3:1 (RESEARCH Pitfall 7). Hermetic: no network, no clock.
 */

const globalsCss = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

const WHITE: Rgb = paletteColor("white");
const PAGE_LIGHT = hexToLinear(
  (globalsCss.match(/:root\s*\{[^}]*--background:\s*(#[0-9a-fA-F]{6})/) ?? [])[1],
);
const PAGE_DARK = hexToLinear(
  (globalsCss.match(
    /prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{[^}]*--background:\s*(#[0-9a-fA-F]{6})/,
  ) ?? [])[1],
);

function palette(name: string, context: string): Rgb {
  try {
    return paletteColor(name);
  } catch (err) {
    assert.fail(`${(err as Error).message} (${context})`);
  }
}

function zinc(step: string, context: string): Rgb {
  return palette(`zinc-${step}`, context);
}

/** First capture group of `re` in `classes`, or a failure naming the pattern. */
function token(classes: string, re: RegExp): string {
  const m = classes.match(re);
  assert.ok(m, `expected ${re} in "${classes}"`);
  return m[1];
}

type Theme = "light" | "dark";

/** A class colour name: "white", "background" (the theme's page ground) or a palette step. */
function color(name: string, theme: Theme): Rgb {
  if (name === "white") return WHITE;
  if (name === "background") return theme === "light" ? PAGE_LIGHT : PAGE_DARK;
  return palette(name, name);
}

const COLOR_NAME = "(white|background|[a-z]+-\\d+)";

/**
 * Resolve a class family to a colour for a theme, e.g. text / ring / bg. The
 * dark theme falls back to the light class when no `dark:` class is given
 * (`bg-background` already switches with the theme).
 */
function resolve(classes: string, family: string, theme: Theme): Rgb {
  const light = new RegExp(`(?:^|\\s)${family}-${COLOR_NAME}(?=\\s|$)`);
  const dark = new RegExp(`(?:^|\\s)dark:${family}-${COLOR_NAME}(?=\\s|$)`);
  if (theme === "dark" && classes.match(dark)) return color(token(classes, dark), theme);
  return color(token(classes, light), theme);
}

// Surfaces a control can sit on, per theme. The strip/rail is the page ground
// (95% opaque over rows that sit on the same ground), and <body> is
// `bg-background` in layout.tsx, so both resolve to the globals.css grounds.
const BAR: Record<Theme, Rgb[]> = {
  light: [PAGE_LIGHT],
  dark: [PAGE_DARK],
};
const PAGE: Record<Theme, Rgb[]> = {
  light: [PAGE_LIGHT],
  dark: [PAGE_DARK],
};

function assertRatio(
  label: string,
  fg: Rgb,
  bg: Rgb,
  min: number,
  theme: Theme,
): void {
  const ratio = contrast(fg, bg);
  assert.ok(
    ratio >= min,
    `${theme}: ${label} measures ${ratio.toFixed(2)}:1, needs ${min}:1`,
  );
}

const THEMES: Theme[] = ["light", "dark"];

for (const theme of THEMES) {
  test(`${theme}: control text pairs reach 4.5:1`, () => {
    const unpressed = resolve(PILL_UNPRESSED_CLASSES, "bg", theme);
    const hover =
      theme === "light"
        ? color(token(NEUTRAL_CONTROL_CLASSES, /(?:^|\s)hover:bg-([a-z]+-\d+)/), theme)
        : color(token(NEUTRAL_CONTROL_CLASSES, /dark:hover:bg-([a-z]+-\d+)/), theme);
    const neutralText = resolve(NEUTRAL_CONTROL_CLASSES, "text", theme);
    const mutedText = resolve(MUTED_CONTROL_TEXT_CLASSES, "text", theme);

    assertRatio("neutral text on unpressed pill", neutralText, unpressed, 4.5, theme);
    assertRatio("neutral text on hover surface", neutralText, hover, 4.5, theme);
    for (const page of PAGE[theme]) {
      assertRatio("neutral text on page (expander)", neutralText, page, 4.5, theme);
    }

    assertRatio("muted text on unpressed pill", mutedText, unpressed, 4.5, theme);
    assertRatio("muted text on hover surface", mutedText, hover, 4.5, theme);
    for (const bar of BAR[theme]) {
      assertRatio("muted text on bar", mutedText, bar, 4.5, theme);
    }

    const pressedFill = resolve(PILL_PRESSED_CLASSES, "bg", theme);
    assertRatio(
      "pressed pill text on pressed fill",
      resolve(PILL_PRESSED_CLASSES, "text", theme),
      pressedFill,
      4.5,
      theme,
    );
    assertRatio(
      "pressed count text on pressed fill",
      resolve(PRESSED_COUNT_TEXT_CLASSES, "text", theme),
      pressedFill,
      4.5,
      theme,
    );

    // The muted "of N" in a filtered section heading count (FrontPageFilter):
    // stone-600 light, stone-400 dark.
    const headingText =
      theme === "light" ? palette("stone-600", "heading") : palette("stone-400", "heading");
    for (const page of PAGE[theme]) {
      assertRatio("section heading count on page", headingText, page, 4.5, theme);
    }
  });

  test(`${theme}: control outlines, fills and focus ring reach 3:1`, () => {
    const ring = resolve(NEUTRAL_CONTROL_CLASSES, "ring", theme);
    const unpressed = resolve(PILL_UNPRESSED_CLASSES, "bg", theme);
    assertRatio("unpressed outline on unpressed pill", ring, unpressed, 3, theme);
    for (const surface of [...BAR[theme], ...PAGE[theme]]) {
      assertRatio("unpressed outline on bar/page surface", ring, surface, 3, theme);
    }

    const pressedFill = resolve(PILL_PRESSED_CLASSES, "bg", theme);
    for (const bar of BAR[theme]) {
      assertRatio("pressed fill on bar", pressedFill, bar, 3, theme);
    }

    const focus = color(
      token(
        CONTROL_FOCUS_CLASSES,
        theme === "light"
          ? /(?:^|\s)focus-visible:outline-((?!offset)[a-z]+-\d+)/
          : /dark:focus-visible:outline-((?!offset)[a-z]+-\d+)/,
      ),
      theme,
    );
    for (const bar of BAR[theme]) {
      assertRatio("focus outline on bar", focus, bar, 3, theme);
    }
  });
}

for (const theme of THEMES) {
  test(`${theme}: muted read-row and zero-count text reach 4.5:1 on the page`, () => {
    const zeroText = resolve(ZERO_COUNT_CONTROL_CLASSES, "text", theme);
    const readTitle = color(
      token(
        READ_ROW_CLASSES,
        theme === "light" ? /(?:^|\s)\[&_h3\]:text-([a-z]+-\d+)/ : /dark:\[&_h3\]:text-([a-z]+-\d+)/,
      ),
      theme,
    );
    const readBody = color(
      token(
        READ_ROW_CLASSES,
        theme === "light" ? /(?:^|\s)\[&_p\]:text-([a-z]+-\d+)/ : /dark:\[&_p\]:text-([a-z]+-\d+)/,
      ),
      theme,
    );
    for (const page of PAGE[theme]) {
      assertRatio("zero-count pill text on page", zeroText, page, 4.5, theme);
      assertRatio("read row headline on page", readTitle, page, 4.5, theme);
      assertRatio("read row body on page", readBody, page, 4.5, theme);
    }
    assertRatio("zero-count outline on page", resolve(ZERO_COUNT_CONTROL_CLASSES, "ring", theme), PAGE[theme][0], 3, theme);
  });
}

test("non-vacuity: the UI-SPEC's original ring values measure below 3:1", () => {
  // Proves the maths distinguishes the rejected values from the amendment.
  const lightRatio = contrast(zinc("400", "ring"), WHITE);
  const darkRatio = contrast(zinc("600", "ring"), zinc("900", "surface"));
  assert.ok(lightRatio < 3, `zinc-400 on white measured ${lightRatio.toFixed(2)}:1`);
  assert.ok(darkRatio < 3, `zinc-600 on zinc-900 measured ${darkRatio.toFixed(2)}:1`);
});

test("sanity: black on white measures 21:1 through the same maths", () => {
  assert.ok(Math.abs(contrast([0, 0, 0], WHITE) - 21) < 0.01);
});
