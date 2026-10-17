import { readFileSync } from "node:fs";

/**
 * Shared WCAG contrast maths over the REAL installed Tailwind palette (oklch
 * values parsed from tailwindcss/theme.css). Test-only: never imported from
 * src outside test files. Used by the filter-control and chip-tone contrast
 * gates so both measure with one implementation. Hermetic: no network, no clock.
 */

export type Rgb = [number, number, number];

const themeCss = readFileSync(
  new URL("../../node_modules/tailwindcss/theme.css", import.meta.url),
  "utf8",
);

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** oklch -> OKLab -> linear sRGB (Bjorn Ottosson's published matrices). */
export function oklchToLinear(l: number, c: number, hDeg: number): Rgb {
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

export function hexToLinear(hex: string): Rgb {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((ch) => ch + ch).join("") : h;
  const channel = (i: number) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return [channel(0), channel(2), channel(4)];
}

export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const PALETTE: Record<string, Rgb> = {};
for (const m of themeCss.matchAll(
  /--color-([a-z]+-\d+):\s*oklch\(\s*([\d.]+)%\s+([\d.]+)\s+(none|[\d.]+)\s*\)/g,
)) {
  PALETTE[m[1]] = oklchToLinear(
    parseFloat(m[2]) / 100,
    parseFloat(m[3]),
    m[4] === "none" ? 0 : parseFloat(m[4]),
  );
}
const WHITE: Rgb = hexToLinear(
  (themeCss.match(/--color-white:\s*(#[0-9a-fA-F]{3,6})/) ?? [])[1] ?? "#fff",
);

/**
 * Resolves "white" or any "<hue>-<step>" (for example "red-700", "zinc-50")
 * from the installed Tailwind theme, failing with a message naming the colour.
 */
export function paletteColor(name: string): Rgb {
  if (name === "white") return WHITE;
  const rgb = PALETTE[name];
  if (rgb === undefined) {
    throw new Error(`${name} not found in the installed Tailwind palette`);
  }
  return rgb;
}
