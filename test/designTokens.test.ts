import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { contrast, hexToLinear } from "./fixtures/contrast.ts";

/**
 * Contrast gate for the Phase 22 UI-SPEC colour roles, measured on the real
 * values in src/app/globals.css in both themes. Phases 23-26 inherit these
 * roles, so a later token edit cannot silently break the UI-SPEC table. Text
 * pairs need 4.5:1 (WCAG SC 1.4.3), the control outline 3:1 (SC 1.4.11).
 * Ground is --background and ink is --foreground. Hermetic: reads one file.
 */

const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

/** Every six-digit hex custom property declared in a CSS block. */
function hexProps(block: string): Record<string, string> {
  const props: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) props[m[1]] = m[2];
  return props;
}

function rootBlock(source: string): string {
  const m = source.match(/:root\s*\{([^}]*)\}/);
  assert.ok(m, "a :root block exists");
  return m[1];
}

const darkMedia = css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*(:root\s*\{[^}]*\})/);
assert.ok(darkMedia, "a dark :root block exists in globals.css");

const THEMES: Record<string, Record<string, string>> = {
  light: hexProps(rootBlock(css)),
  dark: hexProps(rootBlock(darkMedia[1])),
};

const ROLES = [
  "background",
  "foreground",
  "surface",
  "ink-muted",
  "ink-subtle",
  "edge",
  "rule",
  "accent",
  "accent-on",
];

for (const [theme, props] of Object.entries(THEMES)) {
  test(`${theme} theme: every UI-SPEC colour role is a six-digit hex`, () => {
    for (const role of ROLES) assert.ok(props[role], `--${role} missing in the ${theme} theme`);
  });

  test(`${theme} theme: every UI-SPEC text pair is at least 4.5:1 and the edge outline at least 3:1`, () => {
    const c = (name: string) => hexToLinear(props[name]);
    const ground = c("background");
    const ink = c("foreground");
    const text: Array<[string, ReturnType<typeof c>, ReturnType<typeof c>]> = [
      ["ink on ground", ink, ground],
      ["ink-muted on ground", c("ink-muted"), ground],
      ["ink-subtle on ground", c("ink-subtle"), ground],
      ["ink on surface", ink, c("surface")],
      ["ink-muted on surface", c("ink-muted"), c("surface")],
      ["ink-subtle on surface", c("ink-subtle"), c("surface")],
      ["accent on ground", c("accent"), ground],
      ["accent on surface", c("accent"), c("surface")],
      ["primary action label (ground on ink)", ground, ink],
      ["primary action hover label (ground on ink-muted)", ground, c("ink-muted")],
      ["accent-on on accent", c("accent-on"), c("accent")],
    ];
    for (const [label, fg, bg] of text) {
      const ratio = contrast(fg, bg);
      assert.ok(ratio >= 4.5, `${theme}: ${label} is ${ratio.toFixed(2)}, needs 4.5`);
    }
    for (const [label, bg] of [
      ["edge on ground", ground],
      ["edge on surface", c("surface")],
    ] as const) {
      const ratio = contrast(c("edge"), bg);
      assert.ok(ratio >= 3, `${theme}: ${label} is ${ratio.toFixed(2)}, needs 3`);
    }
  });
}
