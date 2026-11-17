import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  FIXTURE_CLUSTER_TITLES,
  FIXTURE_EMPTY_SUMMARY_TITLE,
  FIXTURE_LONG_TITLE,
  FIXTURE_MARKER_TITLE,
  FIXTURE_TOKEN,
  FIXTURE_TOKEN_TITLE,
  FIXTURE_TWELVE_CVE_TITLE,
  FIXTURE_UNBROKEN_TITLE,
} from "../src/lib/fixture/edition.ts";

/**
 * Reads the prerendered `/` of a fixture build (`npm run build:fixture`) from
 * disk, with no server, and proves each MOB-03 case reaches the built page
 * inside the main element, so the viewport check measures it (MOB-03, T-22-24).
 *
 * In GitHub Actions the fixture marker is mandatory: a live build can never
 * certify the layout. Outside CI a build without the marker is not a fixture
 * build, and the remaining tests skip with a diagnostic.
 */

const INDEX_HTML = path.join(process.cwd(), ".next", "server", "app", "index.html");
const IN_CI = process.env.GITHUB_ACTIONS === "true";

let html = "";
try {
  html = readFileSync(INDEX_HTML, "utf8");
} catch {
  html = "";
}
const isFixtureBuild = html.includes(FIXTURE_MARKER_TITLE);

/** The slice from the first `<main` to the first `</main>`, so RSC payload scripts after it do not count. */
function mainHtml(body: string): string {
  const start = body.indexOf("<main");
  const end = body.indexOf("</main>");
  if (start === -1 || end === -1) return "";
  return body.slice(start, end);
}

/** Every `<article ...>...</article>` chunk in `main`. */
function articleChunks(main: string): string[] {
  return [...main.matchAll(/<article\b[\s\S]*?<\/article>/g)].map((m) => m[0]);
}

const NOT_FIXTURE = "not a fixture build: run npm run build:fixture first";

test("in CI the built / is the fixture edition", () => {
  if (!IN_CI) return;
  assert.ok(html.length > 0, `${INDEX_HTML} is missing: CI must build before testing`);
  assert.ok(isFixtureBuild, "CI must build the fixture edition (npm run build:fixture)");
});

test("each MOB-03 title appears verbatim inside an article in the main element", (t) => {
  if (!isFixtureBuild) return t.skip(NOT_FIXTURE);
  const articles = articleChunks(mainHtml(html));
  for (const title of [
    FIXTURE_LONG_TITLE,
    FIXTURE_UNBROKEN_TITLE,
    FIXTURE_TOKEN_TITLE,
    FIXTURE_TWELVE_CVE_TITLE,
    ...FIXTURE_CLUSTER_TITLES,
  ]) {
    assert.ok(
      articles.some((chunk) => chunk.includes(`>${title}<`)),
      `not rendered in main: ${title.slice(0, 50)}`,
    );
  }
  assert.ok(FIXTURE_TOKEN_TITLE.includes(FIXTURE_TOKEN));
  assert.ok(mainHtml(html).includes(FIXTURE_TOKEN));
});

test("a fixture build renders none of the enrichment notices", (t) => {
  if (!isFixtureBuild) return t.skip(NOT_FIXTURE);
  for (const notice of [
    "KEV data unavailable",
    "KEV data from",
    "EPSS data unavailable",
    "EPSS partially unavailable",
    "SSVC data unavailable",
    "SSVC partially unavailable",
  ]) {
    assert.ok(!html.includes(notice), notice);
  }
});

test("the chips show KEV, SSVC active, SSVC poc, no EPSS yet and an overflow count", (t) => {
  if (!isFixtureBuild) return t.skip(NOT_FIXTURE);
  const main = mainHtml(html);
  assert.match(main, /<span\b[^>]*\sdata-kev-chip=/);
  assert.match(main, /<span\b[^>]*\sdata-ssvc-chip="active"/);
  assert.match(main, /<span\b[^>]*\sdata-ssvc-chip="poc"/);
  assert.match(main, /<span\b[^>]*\sdata-epss-chip="none-yet"/);
  // React may put an empty HTML comment between the plus sign and the number.
  assert.match(main, /<span\b[^>]*>\+(?:<!-- -->)?\d+<\/span>/);
});

test("at least two section expanders and seven distinct sections render", (t) => {
  if (!isFixtureBuild) return t.skip(NOT_FIXTURE);
  const main = mainHtml(html);
  const expanders = [...main.matchAll(/<button\b[^>]*\sdata-expander="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(expanders.length >= 2, `expanders ${expanders.length}`);
  const sections = new Set([...main.matchAll(/<section\b[^>]*\sdata-section="([^"]*)"/g)].map((m) => m[1]));
  assert.equal(sections.size, 7);
});

test("the story with an empty summary renders no summary paragraph", (t) => {
  if (!isFixtureBuild) return t.skip(NOT_FIXTURE);
  const chunk = articleChunks(mainHtml(html)).find((c) => c.includes(`>${FIXTURE_EMPTY_SUMMARY_TITLE}<`));
  assert.ok(chunk, "empty-summary story is not rendered");
  assert.ok(!chunk.includes("line-clamp-2"), "the summary paragraph rendered for an empty summary");
});
