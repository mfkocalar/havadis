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
