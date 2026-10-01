import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CONTROL_FOCUS_CLASSES,
  MUTED_CONTROL_TEXT_CLASSES,
  NEUTRAL_CONTROL_CLASSES,
  PILL_PRESSED_CLASSES,
  PILL_UNPRESSED_CLASSES,
  PRESSED_COUNT_TEXT_CLASSES,
} from "./filterControlStyles.ts";

/**
 * WCAG contrast gate for the filter controls (D-08). Measures every control
 * colour pair against the REAL installed Tailwind zinc palette (oklch values
 * parsed from tailwindcss/theme.css) and the real page backgrounds parsed
 * from globals.css, in light and dark. Text pairs need 4.5:1 (SC 1.4.3);
 * non-text pairs (outlines, fills, focus ring) need 3:1 (SC 1.4.11). This is
 * what enforces the ring-zinc-500 amendment of the UI-SPEC (RESEARCH
 * Pitfall 7). Hermetic: no network, no clock.
 */

type Rgb = [number, number, number];

const themeCss = readFileSync(
  new URL("../../node_modules/tailwindcss/theme.css", import.meta.url),
  "utf8",
);
const globalsCss = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** oklch -> OKLab -> linear sRGB (Bjorn Ottosson's published matrices). */
function oklchToLinear(l: number, c: number, hDeg: number): Rgb {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  return [
    clamp01(4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S),
    clamp01(-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S),
    clamp01(-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S),
  ];
}

function hexToLinear(hex: string): Rgb {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((ch) => ch + ch).join("") : h;
  const channel = (i: number) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return [channel(0), channel(2), channel(4)];
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const ZINC: Record<string, Rgb> = {};
for (const m of themeCss.matchAll(
  /--color-zinc-(\d+):\s*oklch\(\s*([\d.]+)%\s+([\d.]+)\s+(none|[\d.]+)\s*\)/g,
)) {
  ZINC[m[1]] = oklchToLinear(
    parseFloat(m[2]) / 100,
    parseFloat(m[3]),
    m[4] === "none" ? 0 : parseFloat(m[4]),
  );
}
const WHITE: Rgb = hexToLinear(
  (themeCss.match(/--color-white:\s*(#[0-9a-fA-F]{3,6})/) ?? [])[1] ?? "#fff",
);
const PAGE_LIGHT = hexToLinear(
  (globalsCss.match(/:root\s*\{[^}]*--background:\s*(#[0-9a-fA-F]{6})/) ?? [])[1],
);
const PAGE_DARK = hexToLinear(
  (globalsCss.match(
    /prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{[^}]*--background:\s*(#[0-9a-fA-F]{6})/,
  ) ?? [])[1],
);

function zinc(step: string, context: string): Rgb {
  const rgb = ZINC[step];
  assert.ok(rgb, `zinc-${step} not found in the installed palette (${context})`);
  return rgb;
}

/** First capture group of `re` in `classes`, or a failure naming the pattern. */
function token(classes: string, re: RegExp): string {
  const m = classes.match(re);
  assert.ok(m, `expected ${re} in "${classes}"`);
  return m[1];
}

function color(name: string): Rgb {
  return name === "white" ? WHITE : zinc(name.replace("zinc-", ""), name);
}

type Theme = "light" | "dark";

/** Resolve a class family to a colour for a theme, e.g. text / ring / bg. */
function resolve(classes: string, family: string, theme: Theme): Rgb {
  const re =
    theme === "light"
      ? new RegExp(`(?:^|\\s)${family}-(white|zinc-\\d+)(?=\\s|$)`)
      : new RegExp(`(?:^|\\s)dark:${family}-(white|zinc-\\d+)(?=\\s|$)`);
  return color(token(classes, re));
}

// Surfaces a control can sit on, per theme. The bar is 90% opaque, so the
// worst cases are the page itself and (dark) zinc-900 cards beneath it.
const BAR: Record<Theme, Rgb[]> = {
  light: [WHITE],
  dark: [zinc("950", "bar"), zinc("900", "bar")],
};
const PAGE: Record<Theme, Rgb[]> = { light: [PAGE_LIGHT], dark: [PAGE_DARK] };

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
        ? color(token(NEUTRAL_CONTROL_CLASSES, /(?:^|\s)hover:bg-(zinc-\d+)/))
        : color(token(NEUTRAL_CONTROL_CLASSES, /dark:hover:bg-(zinc-\d+)/));
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

    // Section heading + count pair used in page.tsx: zinc-500 light, zinc-400 dark.
    const headingText = theme === "light" ? zinc("500", "heading") : zinc("400", "heading");
    for (const page of PAGE[theme]) {
      assertRatio("section heading and count on page", headingText, page, 4.5, theme);
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
          ? /(?:^|\s)focus-visible:outline-(zinc-\d+)/
          : /dark:focus-visible:outline-(zinc-\d+)/,
      ),
    );
    for (const bar of BAR[theme]) {
      assertRatio("focus outline on bar", focus, bar, 3, theme);
    }
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
