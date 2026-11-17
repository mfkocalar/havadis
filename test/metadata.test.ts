/**
 * Share-preview metadata (UX-04, UX-06 titles half; D-16, D-17, D-18).
 *
 * Reads the built HTML under .next/server/app, so run `npm run build:fixture`
 * first, with the same SITE_URL as this process: the built og:image origin is
 * compared with siteUrl() evaluated here (CI sets SITE_URL job-wide).
 *
 * Also guards, from the file system, that the share image is the one committed
 * 1200x630 PNG and that no runtime image function exists (D-17).
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { siteUrl } from "../src/lib/config/site.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILT_APP = path.join(ROOT, ".next/server/app");
const SRC = path.join(ROOT, "src");
const OG_PNG = path.join(SRC, "app/opengraph-image.png");
const OG_ALT = path.join(SRC, "app/opengraph-image.alt.txt");

const PAGES = ["index", "about", "feeds"] as const;

function builtHtml(name: string): string {
  return readFileSync(path.join(BUILT_APP, `${name}.html`), "utf8");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function openingTags(html: string, tagName: string): string[] {
  return [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, "g"))].map((m) => m[0]);
}

function attrValue(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? decodeEntities(m[1]) : null;
}

/** Content of the first <meta> whose property or name attribute equals `key`. */
function metaContent(html: string, key: string): string | null {
  for (const tag of openingTags(html, "meta")) {
    if (attrValue(tag, "property") === key || attrValue(tag, "name") === key) {
      return attrValue(tag, "content");
    }
  }
  return null;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// Next copies the file content verbatim into og:image:alt, so a trailing newline would leak into the tag.
const altText = readFileSync(OG_ALT, "utf8");

for (const page of PAGES) {
  test(`${page}.html: og:image is an absolute URL on the site origin for the committed PNG`, () => {
    const html = builtHtml(page);
    const image = metaContent(html, "og:image");
    assert.ok(image, "og:image must be present");
    const url = new URL(image); // throws on a relative URL
    assert.equal(url.origin, new URL(siteUrl()).origin);
    assert.equal(url.pathname, "/opengraph-image.png");
    assert.equal(metaContent(html, "og:image:width"), "1200");
    assert.equal(metaContent(html, "og:image:height"), "630");
    assert.equal(metaContent(html, "og:image:type"), "image/png");
    assert.equal(metaContent(html, "og:image:alt"), altText);
  });

  test(`${page}.html: twitter card is summary_large_image on the same image`, () => {
    const html = builtHtml(page);
    assert.equal(metaContent(html, "twitter:card"), "summary_large_image");
    const image = metaContent(html, "twitter:image");
    assert.ok(image, "twitter:image must be present");
    assert.equal(new URL(image).pathname, "/opengraph-image.png");
  });
}

test("about.html and feeds.html carry no og:url (no inherited wrong canonical)", () => {
  for (const page of ["about", "feeds"]) {
    assert.equal(metaContent(builtHtml(page), "og:url"), null, `${page}: og:url must be absent`);
  }
});

test("with SITE_URL set, no og, twitter or head link URL points at localhost", () => {
  if (!process.env.SITE_URL?.trim()) return;
  for (const page of PAGES) {
    const html = builtHtml(page);
    const head = html.slice(0, html.indexOf("</head>"));
    const urls: string[] = [];
    for (const tag of openingTags(head, "meta")) {
      const key = attrValue(tag, "property") ?? attrValue(tag, "name") ?? "";
      if (key.startsWith("og:") || key.startsWith("twitter:")) {
        const c = attrValue(tag, "content");
        if (c) urls.push(c);
      }
    }
    for (const tag of openingTags(head, "link")) {
      const href = attrValue(tag, "href");
      if (href) urls.push(href);
    }
    for (const u of urls) {
      assert.ok(!/localhost/i.test(u), `${page}: head URL points at localhost: ${u}`);
    }
  }
});

test("opengraph-image.png is a committed 1200x630 PNG of at most 300 KB", () => {
  const png = readFileSync(OG_PNG);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.ok(png.length <= 300 * 1024, `share image is ${png.length} bytes, ceiling is ${300 * 1024}`);
});

test("opengraph-image.alt.txt is the one-line share image alt text", () => {
  assert.equal(altText, "Havadis: a source-independent security newspaper for practitioners.");
  assert.ok(!altText.includes("\n"), "alt text must be one line with no trailing newline");
});

test("no runtime image function exists under src (D-17)", () => {
  const files = walk(SRC);
  const forbiddenName = /^(opengraph-image|twitter-image|icon|apple-icon)\d*\.(ts|tsx|js|jsx)$/;
  for (const file of files) {
    const base = path.basename(file);
    assert.ok(!forbiddenName.test(base), `code-based image route file is not allowed: ${file}`);
    assert.ok(!/^twitter-image\./.test(base), `twitter-image file is not allowed: ${file}`);
    if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(base)) {
      const text = readFileSync(file, "utf8");
      assert.ok(!/\bImageResponse\b/.test(text), `ImageResponse used in ${file}`);
      assert.ok(!/next\/og/.test(text), `next/og imported in ${file}`);
    }
  }
});

const HOME_DESCRIPTION =
  "A public security newspaper for practitioners. Current cybersecurity coverage from curated sources, grouped by section and ranked by urgency.";

const TITLE_TABLE = [
  { page: "index", title: "Havadis: daily security news for practitioners", description: HOME_DESCRIPTION },
  {
    page: "about",
    title: "About · Havadis",
    description:
      "Havadis is a public security news aggregator; this page describes its HavadisBot crawler and how to contact or opt out.",
  },
  {
    page: "feeds",
    title: "Feeds · Havadis",
    description: "RSS and JSON Feed endpoints for connecting services and agents to Havadis.",
  },
  {
    page: "_not-found",
    title: "Page not found · Havadis",
    description: "This page does not exist. Go back to the Havadis front page.",
  },
] as const;

function titleText(html: string): string {
  const m = html.match(/<title>([^<]*)<\/title>/);
  return m ? decodeEntities(m[1]) : "";
}

for (const row of TITLE_TABLE) {
  test(`${row.page}.html: exact title and description (UX-06)`, () => {
    const html = builtHtml(row.page);
    const title = titleText(html);
    const description = metaContent(html, "description") ?? "";
    assert.equal(title, row.title);
    assert.equal(description, row.description);
    assert.ok(title.length > 0 && title.length <= 60, `title length ${title.length}`);
    assert.ok(description.length > 0 && description.length <= 160, `description length ${description.length}`);
    assert.equal(title.split("Havadis").length - 1, 1, "site name appears once");
  });
}

for (const row of TITLE_TABLE.filter((r) => r.page !== "_not-found")) {
  test(`${row.page}.html: og:title and og:description follow the page`, () => {
    const html = builtHtml(row.page);
    const ogTitle = metaContent(html, "og:title");
    const ogDescription = metaContent(html, "og:description");
    assert.ok(ogTitle, "og:title must be present");
    assert.ok(ogDescription, "og:description must be present");
    const own = row.page === "about" ? "About" : row.page === "feeds" ? "Feeds" : "Havadis: daily security news";
    assert.ok(ogTitle.includes(own), `og:title "${ogTitle}" must contain "${own}"`);
    assert.equal(ogDescription, row.description);
  });
}

// Icon set (UX-06 icon half; D-19, D-21). Every raster is committed, none is rendered at build time.
const ICON_SVG = path.join(SRC, "app/icon.svg");
const APPLE_ICON = path.join(SRC, "app/apple-icon.png");

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngSize(png: Buffer): { width: number; height: number } {
  assert.deepEqual([...png.subarray(0, 8)], PNG_SIGNATURE);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function linkTag(html: string, rel: string, hrefStart: string): string | undefined {
  return openingTags(html, "link").find(
    (tag) => attrValue(tag, "rel") === rel && (attrValue(tag, "href") ?? "").startsWith(hrefStart),
  );
}

test("index.html links the SVG icon and the apple touch icon", () => {
  const html = builtHtml("index");
  const svg = linkTag(html, "icon", "/icon.svg");
  assert.ok(svg, 'rel="icon" link to /icon.svg must be present');
  assert.equal(attrValue(svg, "type"), "image/svg+xml");
  assert.equal(attrValue(svg, "sizes"), "any");
  const apple = linkTag(html, "apple-touch-icon", "/apple-icon.png");
  assert.ok(apple, 'rel="apple-touch-icon" link to /apple-icon.png must be present');
  assert.equal(attrValue(apple, "sizes"), "180x180");
});

test("apple-icon.png is a committed 180x180 PNG", () => {
  assert.deepEqual(pngSize(readFileSync(APPLE_ICON)), { width: 180, height: 180 });
});

test("icon.svg holds only rects and an inline style on the 32 grid (T-22-21)", () => {
  const svg = readFileSync(ICON_SVG, "utf8");
  assert.ok(svg.includes('viewBox="0 0 32 32"'));
  assert.ok(/@media\s*\(prefers-color-scheme:\s*dark\)/.test(svg), "dark-scheme rule must be present");
  assert.ok(!/<script\b/i.test(svg), "no script element");
  assert.ok(!/\bhref\s*=/i.test(svg) && !/xlink:href/i.test(svg), "no href or xlink:href attribute");
  assert.ok(!/url\(/i.test(svg), "no url() reference");
  assert.ok(!/<(circle|ellipse)\b/i.test(svg), "no dot shape");
});

const FAVICON = path.join(SRC, "app/favicon.ico");
const MANIFEST = path.join(SRC, "app/manifest.webmanifest");
const PUBLIC_DIR = path.join(ROOT, "public");

test("index.html links the manifest and the favicon", () => {
  const html = builtHtml("index");
  const manifest = linkTag(html, "manifest", "/manifest.webmanifest");
  assert.ok(manifest, 'rel="manifest" link to /manifest.webmanifest must be present');
  assert.ok(linkTag(html, "icon", "/favicon.ico"), 'rel="icon" link to /favicon.ico must be present');
});

test("manifest.webmanifest is the pinned static JSON with two icons in order (T-22-22)", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Record<string, unknown>;
  assert.equal(manifest.name, "Havadis");
  assert.equal(manifest.short_name, "Havadis");
  assert.equal(manifest.description, metaContent(builtHtml("index"), "description"));
  assert.equal(manifest.description, HOME_DESCRIPTION);
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.display, "browser");
  assert.equal(manifest.background_color, "#f2f0e9");
  assert.equal(manifest.theme_color, "#0c0a09");
  const icons = manifest.icons as { src: string; sizes: string; type: string; purpose: string }[];
  assert.equal(icons.length, 2);
  assert.deepEqual(
    icons.map((i) => [i.src, i.sizes]),
    [
      ["/icon-192.png", "192x192"],
      ["/icon-512.png", "512x512"],
    ],
  );
  for (const icon of icons) {
    assert.equal(icon.type, "image/png");
    assert.equal(icon.purpose, "any");
    const file = path.join(PUBLIC_DIR, icon.src.replace(/^\//, ""));
    const { width, height } = pngSize(readFileSync(file));
    assert.equal(`${width}x${height}`, icon.sizes, `${icon.src} IHDR must match sizes`);
  }
});

test("favicon.ico holds PNG frames of 16, 32 and 48 px", () => {
  const ico = readFileSync(FAVICON);
  assert.equal(ico.readUInt16LE(0), 0, "reserved");
  assert.equal(ico.readUInt16LE(2), 1, "type is icon");
  assert.equal(ico.readUInt16LE(4), 3, "three frames");
  const sizes = [16, 32, 48];
  sizes.forEach((size, i) => {
    const entry = 6 + 16 * i;
    assert.equal(ico.readUInt8(entry), size, `frame ${i} width`);
    assert.equal(ico.readUInt8(entry + 1), size, `frame ${i} height`);
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    if (i === 0) assert.equal(offset, 54, "first frame starts after the directory");
    const frame = ico.subarray(offset, offset + length);
    assert.deepEqual(pngSize(frame), { width: size, height: size }, `frame ${i} IHDR`);
  });
});
