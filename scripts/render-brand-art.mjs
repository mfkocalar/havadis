/**
 * One-off, off-line renderer for Havadis brand art (22-UI-SPEC "Share image").
 *
 * Renders hand-authored HTML with the Playwright devDependency and writes the
 * result into the repo, where it is committed. Builds and CI never run this
 * script and never render or fetch anything for these images: the committed
 * PNG is a static asset served through the Next.js file convention.
 *
 * Usage (on a developer machine with network access, once):
 *
 *     node scripts/render-brand-art.mjs og
 *
 * Targets:
 *   og   src/app/opengraph-image.png, the 1200x630 share image.
 *
 * Re-render when the production hostname changes: the host line
 * ("havadis-news.vercel.app") is baked into the PNG. Barlow and JetBrains Mono
 * come from the Google Fonts stylesheet at render time; the script exits
 * non-zero unless the real faces loaded, so a system-fallback render can never
 * be committed.
 *
 * It lives in scripts/, not test/, because `node --test` runs every .mjs file
 * under test/.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OG_OUT = path.join(REPO_ROOT, "src/app/opengraph-image.png");

const FONTS_CSS_URL =
  "https://fonts.googleapis.com/css2?family=Barlow:wght@400;600&family=JetBrains+Mono:wght@400&display=block";

// Share image geometry (UI-SPEC): canvas 1200x630, safe area 80 px left and
// right, 72 px top and bottom. Brand tile 112x112 at (80, 104).
const HOST = "havadis-news.vercel.app";
const TAGLINE = "A source-independent security newspaper for practitioners.";
const HOST_BASELINE_Y = 538;

// Brand mark on the 512 grid (UI-SPEC "Brand mark and icon set"), full-bleed.
const BRAND_TILE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#1c1917"/>
  <rect x="160" y="144" width="48" height="224" fill="#f2f0e9"/>
  <rect x="304" y="144" width="48" height="224" fill="#f2f0e9"/>
  <rect x="208" y="232" width="96" height="48" fill="#f2f0e9"/>
  <circle cx="392" cy="136" r="28" fill="#f87171"/>
</svg>`;

function ogHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="${FONTS_CSS_URL}">
<style>
  html, body { margin: 0; padding: 0; }
  body { width: 1200px; height: 630px; position: relative; overflow: hidden; background: #f2f0e9; }
  .tile { position: absolute; left: 80px; top: 104px; width: 112px; height: 112px; border-radius: 24px; overflow: hidden; }
  .tile svg { display: block; }
  .wordmark {
    position: absolute; left: 224px; top: 104px; height: 112px; line-height: 112px;
    font: 600 96px/112px Barlow; color: #1c1917; white-space: nowrap;
  }
  .tagline {
    position: absolute; left: 80px; top: 264px; width: 880px;
    font: 400 48px/60px Barlow; color: #44403c;
  }
  .host {
    position: absolute; left: 80px; top: 0;
    font: 400 28px/28px "JetBrains Mono"; color: #57534e; white-space: nowrap;
  }
  .host .probe { display: inline-block; width: 0; height: 0; }
</style>
</head>
<body>
  <div class="tile">${BRAND_TILE_SVG}</div>
  <div class="wordmark">Havadis</div>
  <div class="tagline">${TAGLINE}</div>
  <div class="host" id="host">${HOST}<span class="probe" id="probe"></span></div>
</body>
</html>`;
}

async function loadChromium() {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    console.error(
      "Playwright is not installed: run npm ci (playwright is a pinned devDependency), " +
        "then npx playwright install --only-shell chromium.",
    );
    process.exit(2);
  }
  return playwright.chromium ?? playwright.default?.chromium;
}

async function renderOg() {
  const chromium = await loadChromium();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.setContent(ogHtml(), { waitUntil: "networkidle" });
    await page.evaluate(() =>
      Promise.all([
        document.fonts.load("600 96px Barlow"),
        document.fonts.load("400 48px Barlow"),
        document.fonts.load("400 28px 'JetBrains Mono'"),
      ]),
    );
    await page.evaluate(() => document.fonts.ready);

    const fontsOk = await page.evaluate(() => ({
      barlow600: document.fonts.check("600 96px Barlow"),
      barlow400: document.fonts.check("400 48px Barlow"),
      mono400: document.fonts.check("400 28px 'JetBrains Mono'"),
      loaded: [...document.fonts].filter((f) => f.status === "loaded").length,
    }));
    if (!fontsOk.barlow600 || !fontsOk.barlow400 || !fontsOk.mono400 || fontsOk.loaded === 0) {
      console.error(
        `Fonts did not load (${JSON.stringify(fontsOk)}); refusing to render a system-fallback image. ` +
          "Check network access to fonts.googleapis.com and retry.",
      );
      process.exit(1);
    }

    // Place the host line so its baseline sits at y=538: an empty inline-block
    // rests on the baseline, so its rect bottom is the baseline position.
    await page.evaluate((baselineY) => {
      const host = document.getElementById("host");
      const probe = document.getElementById("probe");
      const offset = probe.getBoundingClientRect().bottom - host.getBoundingClientRect().top;
      host.style.top = `${baselineY - offset}px`;
    }, HOST_BASELINE_Y);

    const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1200, height: 630 } });
    await mkdir(path.dirname(OG_OUT), { recursive: true });
    await writeFile(OG_OUT, png);
    console.log(`WROTE ${path.relative(REPO_ROOT, OG_OUT)} ${png.length}`);
  } finally {
    await browser.close();
  }
}

const TARGETS = { og: renderOg };
const target = process.argv[2];
if (!target || !Object.hasOwn(TARGETS, target)) {
  console.error(`Usage: node scripts/render-brand-art.mjs <${Object.keys(TARGETS).join("|")}>`);
  process.exit(2);
}
await TARGETS[target]();
