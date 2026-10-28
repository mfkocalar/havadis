import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contrast, paletteColor } from "../../test/fixtures/contrast.ts";
import {
  EPSS_CHIP_CLASSES,
  EPSS_NONE_YET_CHIP_CLASSES,
  EPSS_STRONG_CHIP_CLASSES,
  KEV_CHIP_CLASSES,
} from "./cveChipStyles.ts";

/**
 * WCAG text-contrast gate for every chip tone (D-04, D-06). Each constant's
 * text colour is measured against its background colour on the REAL installed
 * Tailwind palette, in light (`bg-`, `text-`) and dark (`dark:bg-`,
 * `dark:text-`, falling back to the light class when no dark one is given).
 * Text needs 4.5:1 (SC 1.4.3). Hermetic: no network, no clock.
 */

const PILL_GEOMETRY =
  "inline-flex items-center rounded-xs px-1.5 py-0.5 font-mono text-xs leading-5 font-bold whitespace-nowrap";

const TONES: Record<string, string> = {
  KEV_CHIP_CLASSES,
  EPSS_CHIP_CLASSES,
  EPSS_STRONG_CHIP_CLASSES,
  EPSS_NONE_YET_CHIP_CLASSES,
};

/** The colour name of one class family for a theme, with the light class as the dark fallback. */
function colourName(classes: string, family: "bg" | "text", theme: "light" | "dark"): string {
  const light = classes.match(new RegExp(`(?:^|\\s)${family}-([a-z]+-\\d+|white)(?=\\s|$)`));
  if (theme === "light") {
    assert.ok(light, `expected ${family}-<colour> in "${classes}"`);
    return light[1];
  }
  const dark = classes.match(new RegExp(`(?:^|\\s)dark:${family}-([a-z]+-\\d+|white)(?=\\s|$)`));
  const picked = dark ?? light;
  assert.ok(picked, `expected ${family}-<colour> in "${classes}"`);
  return picked[1];
}

for (const [name, classes] of Object.entries(TONES)) {
  for (const theme of ["light", "dark"] as const) {
    test(`${name} text reaches 4.5:1 in ${theme}`, () => {
      const bg = colourName(classes, "bg", theme);
      const fg = colourName(classes, "text", theme);
      const ratio = contrast(paletteColor(fg), paletteColor(bg));
      assert.ok(
        ratio >= 4.5,
        `${theme}: ${name} ${fg} on ${bg} measures ${ratio.toFixed(2)}:1, needs 4.5:1`,
      );
    });
  }

  test(`${name} carries the chip geometry`, () => {
    assert.ok(classes.startsWith(PILL_GEOMETRY), `${name} must begin with the chip geometry`);
  });
}

test("every tone constant is one string literal, never a concatenation", () => {
  const source = readFileSync(new URL("./cveChipStyles.ts", import.meta.url), "utf8");
  const decls = [...source.matchAll(/^export const (\w+) =\s*([^;]*);/gm)];
  assert.equal(decls.length, 4);
  for (const [, name, rhs] of decls) {
    assert.match(rhs.trim(), /^"[^"+`$]*"$/, `${name} must be a single double-quoted literal`);
  }
});

test("non-vacuity: a light zinc-300 on zinc-100 pair measures below 4.5:1", () => {
  assert.ok(contrast(paletteColor("zinc-300"), paletteColor("zinc-100")) < 4.5);
});
