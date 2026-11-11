import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { SECTION_DISPLAY_ORDER } from "../src/lib/config/sections.ts";
import { SOURCE_TYPE_LABEL } from "../src/lib/config/sourceTypes.ts";
import { CRAWLER_CONTACT_CHANNEL_URL, USER_AGENT } from "../src/lib/config/crawler.ts";
import { FEED_VARIANTS, feedPath } from "../src/lib/feeds/buildFeed.ts";
import {
  assertNotPrerendered,
  findStaleSources,
  type PrerenderManifest,
  type SourceStamp,
} from "./fixtures/staticRouteGate.ts";
import { PAGE_FIXTURE_TITLES, seedPageFixtureDb } from "./fixtures/pageFixture.ts";
import { generateKey } from "../src/lib/secrets/key.ts";
import { dbFile } from "../src/lib/db/paths.ts";
import { loadMigrations, runMigrations } from "../src/lib/db/migrator.ts";
import { openDb } from "../src/lib/db/openDb.ts";
import { seedBuiltins } from "../src/lib/db/seed.ts";
import { beat } from "../src/lib/store/jobs.ts";

/**
 * Drives a real `next start` production server and asserts the public
 * no-authentication contract and the cold-cache render (UI-06, INGEST-05
 * empty edge). RESEARCH.md Pitfall P1-4: Next.js never caches pages in
 * `next dev` — this criterion is unverifiable there, so this test spawns
 * the actual production build's start script instead.
 *
 * The page reads SQLite, so `before()` seeds its own temp database through the real ingest cycle
 * (test/fixtures/pageFixture.ts): a good cycle four days before the read, a partial cycle one day
 * before it in which one source succeeds, and a failed cycle at read time. Every test below
 * therefore runs against a read four days after the good cycle (PLAT-09 last-good rule).
 */

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;
/** The second server of the startup-refusal test; nothing may ever answer here. */
const REFUSED_PORT = 3102;
/** The waiting-state server: a migrated, seeded database with no cycle yet. */
const WAITING_PORT = 3103;
const REFUSAL_TIMEOUT_MS = 20_000;
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_INTERVAL_MS = 500;

let server: ChildProcess | null = null;
let waitingServer: ChildProcess | null = null;
let waitingDir = "";
let mainServerEnv: NodeJS.ProcessEnv | null = null;
let stderrLog = "";
let dataDir = "";
let partialAt = 0;
let operatorKey = "";

/**
 * Detects "at least one article anchor rendered" tolerant of attribute
 * order, the same way the NVD-anchor check below already is: extract each
 * `<a>` tag first, then test each tag for both attributes independently
 * rather than relying on one exact adjacent-and-ordered string match (see
 * WR-04, 03-REVIEW.md) — a JSX attribute-order change or React/Next.js
 * serialization-order bump would otherwise silently break this signal.
 */
function hasArticleAnchorTag(body: string): boolean {
  const anchorTags = [...body.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
  return anchorTags.some(
    (tag) => tag.includes('target="_blank"') && tag.includes('rel="noopener noreferrer"')
  );
}

/** Every `<tag ...>` opening tag in `html`. */
function openingTags(html: string, tagName: string): string[] {
  return [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, "g"))].map((m) => m[0]);
}

/** The quoted value of attribute `name` in an opening tag, or null. */
function attrValue(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1] : null;
}

/** The slice of the document from the first `<main` to the first `</main>`. */
function mainHtml(body: string): string {
  const start = body.indexOf("<main");
  const end = body.indexOf("</main>");
  if (start === -1 || end === -1) return "";
  return body.slice(start, end);
}

type SectionChunk = { section: string; count: string; html: string };

/**
 * Splits <main> into one chunk per `<section` opening tag: chunk i runs from
 * that tag to the next one (or to the end of main).
 */
function sectionChunks(body: string): SectionChunk[] {
  const main = mainHtml(body);
  const starts = [...main.matchAll(/<section\b[^>]*>/g)].map((m) => ({
    index: m.index as number,
    tag: m[0],
  }));
  return starts.map((s, i) => ({
    section: attrValue(s.tag, "data-section") ?? "",
    count: attrValue(s.tag, "data-count") ?? "",
    html: main.slice(s.index, i + 1 < starts.length ? starts[i + 1].index : main.length),
  }));
}

const NEXT_BIN = path.join(process.cwd(), "node_modules", ".bin", "next");

/** The parent environment with the key variables cleared, then `overrides` applied: a developer's own key never leaks in. */
function serverEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.HAVADIS_SECRET_KEY;
  delete env.HAVADIS_SECRET_KEY_FILE;
  return { ...env, ...overrides };
}

async function pollUntilReady(): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(2_000) });
      await res.body?.cancel();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
    }
  }
  throw new Error(
    `Production server never answered on ${BASE_URL} within ${READY_TIMEOUT_MS}ms.\n` +
      `Captured stderr:\n${stderrLog}`
  );
}

before(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), "havadis-page-"));
  try {
    ({ partialAt } = await seedPageFixtureDb(dataDir, Date.now()));
  } catch (err) {
    rmSync(dataDir, { recursive: true, force: true });
    throw err;
  }

  operatorKey = generateKey();
  // HAVADIS_BASE_URL makes the absolute URLs in metadata name this test server, the same origin a
  // deployed instance would configure, so the third-party origin gate below judges the real markup.
  // The object is kept: the waiting-state server below starts from a copy of it.
  mainServerEnv = serverEnv({ HAVADIS_DATA_DIR: dataDir, HAVADIS_SECRET_KEY: operatorKey, HAVADIS_BASE_URL: BASE_URL });
  server = spawn(NEXT_BIN, ["start", "-p", String(PORT)], {
    stdio: ["ignore", "ignore", "pipe"],
    env: mainServerEnv,
  });
  server.stderr?.on("data", (chunk: Buffer) => {
    stderrLog += chunk.toString();
  });

  try {
    await pollUntilReady();
  } catch (err) {
    server.kill();
    server = null;
    rmSync(dataDir, { recursive: true, force: true });
    throw err;
  }
});

after(async () => {
  if (server) {
    server.kill();
    server = null;
  }
  if (waitingServer) {
    waitingServer.kill();
    waitingServer = null;
  }
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  if (waitingDir) rmSync(waitingDir, { recursive: true, force: true });
});

test("GET / returns 200 with no authentication surface anywhere", async () => {
  const res = await fetch(BASE_URL);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("set-cookie"), null, "a public page must never set a cookie");
  assert.equal(
    res.headers.get("www-authenticate"),
    null,
    "a public page must never challenge for credentials"
  );
  assert.notEqual(res.status, 401);
  assert.notEqual(res.status, 403);
});

test("body contains the Havadis masthead", async () => {
  const res = await fetch(BASE_URL);
  const body = await res.text();
  assert.ok(body.includes("Havadis"), "expected the masthead string in the rendered HTML");
});

test("body contains exactly one of the two valid render states — never neither, never both", async () => {
  const res = await fetch(BASE_URL);
  const body = await res.text();

  // Source-agnostic since Phase 2 widened SOURCES beyond a single hardcoded
  // origin (krebsonsecurity.com): any ArticleCard anchor carries
  // target="_blank" rel="noopener noreferrer" and no other element on the
  // page does (see src/components/ArticleCard.tsx, src/app/layout.tsx) —
  // this is the render-state signal, independent of which of the 13
  // sources actually contributed the article. Phase 3's CVE chip anchors
  // (src/components/CveChips.tsx) now also carry this exact attribute
  // pair, but a chip only ever renders inside an article card next to the
  // tier badge, so the signal still means "at least one article rendered".
  const hasArticleAnchor = hasArticleAnchorTag(body);
  const hasEmptyState = body.includes("No articles in the last 24 hours");

  assert.notEqual(
    hasArticleAnchor,
    hasEmptyState,
    "exactly one of {an article anchor from any configured source, the D-03 empty-state line} must be " +
      "present — neither means the blank-page failure this criterion exists to exclude, and both means " +
      "the empty state rendered alongside real articles"
  );
});

// Real-page CLASSIFY-03 check: every data-section attribute value in the
// production HTML must be a member of SECTION_DISPLAY_ORDER, in strictly
// increasing display-order index (D-12), present alongside an article
// anchor and absent from the empty state.
test("data-section values on the real production page follow SECTION_DISPLAY_ORDER", async () => {
  const res = await fetch(BASE_URL);
  const body = await res.text();

  const dataSections = [...body.matchAll(/data-section="([^"]+)"/g)].map((m) => m[1]);

  const hasArticleAnchor = hasArticleAnchorTag(body);
  const hasEmptyState = body.includes("No articles in the last 24 hours");

  let lastIndex = -1;
  for (const section of dataSections) {
    const index = SECTION_DISPLAY_ORDER.indexOf(section as (typeof SECTION_DISPLAY_ORDER)[number]);
    assert.ok(index >= 0, `expected data-section="${section}" to be a member of SECTION_DISPLAY_ORDER`);
    assert.ok(
      index > lastIndex,
      `expected data-section="${section}" to appear after the previous section in SECTION_DISPLAY_ORDER (D-12)`
    );
    lastIndex = index;
  }

  if (hasArticleAnchor) {
    assert.ok(dataSections.length > 0, "expected at least one data-section when an article anchor is present");
  }
  if (hasEmptyState) {
    assert.equal(dataSections.length, 0, "expected no data-section attributes in the empty state");
  }
});

// Real-page D-14 check: every anchor whose href references NVD's CVE detail
// page must match the exact shape and carry both target="_blank" and
// rel="noopener noreferrer", independent of attribute order in the emitted
// markup.
test("every NVD anchor on the real production page has the exact href shape and carries target/rel", async () => {
  const res = await fetch(BASE_URL);
  const body = await res.text();

  const anchorTags = [...body.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
  const nvdAnchors = anchorTags.filter((tag) => tag.includes("nvd.nist.gov"));

  for (const tag of nvdAnchors) {
    const hrefMatch = tag.match(/href="([^"]*)"/);
    assert.ok(hrefMatch, `expected an href attribute on NVD anchor tag: ${tag}`);
    assert.match(
      hrefMatch![1],
      /^https:\/\/nvd\.nist\.gov\/vuln\/detail\/CVE-\d{4}-\d{4,7}$/,
      `expected NVD anchor href to match the exact detail-page shape, got ${hrefMatch![1]}`
    );
    assert.ok(tag.includes('target="_blank"'), `expected target="_blank" on NVD anchor: ${tag}`);
    assert.ok(
      tag.includes('rel="noopener noreferrer"'),
      `expected rel="noopener noreferrer" on NVD anchor: ${tag}`
    );
  }
});

// SRC-01 / D-02 label contract on the real production HTML: each card shows
// exactly one plain-text source-type label, after the tier pill and before any
// CVE chip, with none of the pill geometry classes.
test("every article card shows exactly one source-type label after the tier pill and before any CVE chip", async (t) => {
  const res = await fetch(BASE_URL);
  const body = await res.text();
  const main = mainHtml(body);

  const cards = [...main.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g)].map((m) => m[0]);
  if (cards.length === 0) {
    assert.ok(
      body.includes("No articles in the last 24 hours"),
      "no article cards rendered, so the page must show the empty state"
    );
    return;
  }

  // Alternation built from the label map, so a new source type is accepted
  // the moment it gets a label (Phase 7.1 UI-SPEC Test and Gate Contract 1).
  const LABEL_ALTERNATION = Object.values(SOURCE_TYPE_LABEL)
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const LABEL_RE = new RegExp(
    `<span class="([^"]*)"><span class="sr-only">Source type: </span>(?:<!-- -->)?(${LABEL_ALTERNATION})</span>`,
    "g"
  );

  for (const card of cards) {
    const labels = [...card.matchAll(LABEL_RE)];
    assert.equal(labels.length, 1, `expected exactly one source-type label in a card, got ${labels.length}`);
    const label = labels[0];
    const labelIndex = label.index as number;

    for (const token of ["rounded-", "ring-", "bg-", "px-", "py-"]) {
      assert.ok(
        !label[1].includes(token),
        `label class "${label[1]}" must not contain pill geometry token "${token}"`
      );
    }

    const pillIndex = card.indexOf('title="Source category: ');
    assert.ok(pillIndex !== -1, "expected the tier tag (title=\"Source category: ...\") in the card");
    assert.ok(labelIndex > pillIndex, "the type label must come after the tier tag");

    const nvdIndex = card.indexOf("nvd.nist.gov");
    if (nvdIndex !== -1) {
      assert.ok(labelIndex < nvdIndex, "the type label must come before the first CVE chip");
    }
  }
  t.diagnostic(`checked ${cards.length} cards`);
});

/** The document with the response's own nonce replaced by a constant, in script attributes and in the flight payload alike. */
function withoutNonce(html: string, nonce: string): string {
  assert.ok(html.includes(nonce), "the response's own nonce must appear in its body");
  return html.split(nonce).join("NONCE");
}

test("two consecutive requests return the same HTML except for their nonces, and the nonces differ", async () => {
  // Each response carries its own CSP nonce (PLAT-14), so byte equality is gone by design. What stays
  // true is that nothing else varies between two reads of the same snapshot.
  const [res1, res2] = await Promise.all([fetch(BASE_URL), fetch(BASE_URL)]);
  const [body1, body2] = await Promise.all([res1.text(), res2.text()]);
  const nonce1 = nonceOfPolicy(res1.headers.get("content-security-policy"));
  const nonce2 = nonceOfPolicy(res2.headers.get("content-security-policy"));
  assert.ok(nonce1 && nonce2, "both responses carry a nonce");
  assert.notEqual(nonce1, nonce2, "two requests must never share a nonce");
  assert.equal(withoutNonce(body1, nonce1), withoutNonce(body2, nonce2));
  assert.ok(!body1.includes(nonce2) && !body2.includes(nonce1), "a response never carries another response's nonce");
});

// Count invariants (RESEARCH Pitfall 9/12): one count per section, reused on
// the section element, its heading and (below) its pill; and every card is in
// the initial HTML even when a section is filtered out client-side (D-07).
test("every rendered section carries one full article count on its section, heading and pill, and every card is in the initial HTML", async () => {
  const res = await fetch(BASE_URL);
  const body = await res.text();
  const chunks = sectionChunks(body);

  for (const chunk of chunks) {
    const cardCount = (chunk.html.match(/<article\b/g) ?? []).length;
    const headingTag = openingTags(chunk.html, "h2")[0] ?? "";
    const headingCount = attrValue(
      openingTags(chunk.html, "span").find((t) => t.includes("data-heading-count")) ?? "",
      "data-heading-count"
    );
    assert.equal(
      String(cardCount),
      chunk.count,
      `${chunk.section}: <article> count must equal the section's data-count`
    );
    assert.equal(
      headingCount,
      chunk.count,
      `${chunk.section}: data-heading-count must equal the section's data-count`
    );
    const sectionTag = openingTags(chunk.html, "section")[0];
    const labelledBy = attrValue(sectionTag, "aria-labelledby");
    assert.ok(labelledBy, `${chunk.section}: expected aria-labelledby on the section`);
    assert.equal(
      attrValue(headingTag, "id"),
      labelledBy,
      `${chunk.section}: aria-labelledby must equal the id on its h2`
    );
  }
});

test("the filter bar renders one unpressed pill per rendered section, in section order, inside the labelled group, above main", async () => {
  const res = await fetch(BASE_URL);
  const body = await res.text();
  const chunks = sectionChunks(body);

  if (chunks.length === 0) {
    assert.ok(body.includes("No articles in the last 24 hours"));
    assert.ok(!body.includes("data-filter-pill"), "the empty state must render no pills");
    assert.ok(!body.includes("data-filter-bar"), "the empty state must render no filter bar");
    return;
  }

  const pillTags = openingTags(body, "button").filter((t) => t.includes("data-filter-pill"));
  assert.deepEqual(
    pillTags.map((t) => attrValue(t, "data-filter-pill")),
    chunks.map((c) => c.section),
    "pills must follow the rendered section order"
  );
  pillTags.forEach((tag, i) => {
    assert.equal(attrValue(tag, "aria-pressed"), "false", "pills render unpressed before hydration");
    assert.equal(attrValue(tag, "data-count"), chunks[i].count, "pill count must equal its section count");
  });
  assert.ok(body.includes('role="group"'), "expected the pill group role");
  assert.ok(body.includes('aria-label="Filter by section"'), "expected the pill group label");
  assert.ok(
    body.includes(`Showing all ${chunks.length} section`),
    "expected the initial live-region status message"
  );
  assert.ok(
    body.indexOf("data-filter-bar") < body.indexOf("<main"),
    "the filter bar must precede <main> in the document"
  );
});

test("the bar's Updated text is the snapshot's deterministic UTC time in the served HTML", async () => {
  const res = await fetch(BASE_URL);
  const body = await res.text();
  const chunks = sectionChunks(body);

  if (chunks.length === 0) {
    assert.ok(!body.includes("data-last-updated"), "the empty state must render no Updated text");
    return;
  }

  const timeTags = openingTags(body, "time").filter((t) => t.includes("data-last-updated"));
  assert.equal(timeTags.length, 1, "expected exactly one data-last-updated time element");
  const tag = timeTags[0];
  const tagIndex = body.indexOf(tag);
  assert.ok(
    tagIndex > body.indexOf("data-filter-bar") && tagIndex < body.indexOf("<main"),
    "the Updated text must live inside the filter bar, above <main>"
  );

  const innerMatch = body.slice(tagIndex).match(/^<time\b[^>]*data-last-updated[^>]*>([^<]*)<\/time>/);
  assert.ok(innerMatch, "expected the time element to hold a single text node");
  const text = innerMatch![1];
  assert.match(text, /^Updated \d{2}:\d{2} UTC$/);
  assert.ok(!text.includes("ago") && !text.includes("just now"), "server HTML must never carry a relative string");

  const iso = attrValue(tag, "datetime") ?? attrValue(tag, "dateTime");
  assert.ok(iso, "expected a dateTime attribute");
  assert.equal(new Date(iso!).toISOString(), iso, "dateTime must be a canonical ISO string");
  assert.equal(
    iso,
    new Date(partialAt).toISOString(),
    "Updated is the newest ok or partial cycle; the failed cycle at read time does not move it"
  );
  assert.equal(text, `Updated ${iso!.slice(11, 16)} UTC`, "text HH:MM must equal the ISO value's HH:MM");
  assert.equal(
    attrValue(tag, "title"),
    `${iso!.slice(0, 10)} ${iso!.slice(11, 16)} UTC`,
    "hover title must be the full UTC date and time"
  );
});

test("sections of 9 or more articles show exactly 6 cards before a hidden overflow region holding the rest; smaller sections have neither region nor button", async (t) => {
  const res = await fetch(BASE_URL);
  const body = await res.text();
  const chunks = sectionChunks(body);
  let expanders = 0;

  for (const chunk of chunks) {
    const count = Number(chunk.count);
    const regionMarker = 'data-overflow="';
    const hasRegion = chunk.html.includes(regionMarker);
    const buttons = openingTags(chunk.html, "button").filter((tag) => tag.includes("data-expander"));

    if (count < 9) {
      assert.ok(!hasRegion, `${chunk.section}: ${count} articles must have no overflow region`);
      assert.equal(buttons.length, 0, `${chunk.section}: ${count} articles must have no expander button`);
      continue;
    }

    expanders += 1;
    assert.equal(
      chunk.html.split(regionMarker).length - 1,
      1,
      `${chunk.section}: expected exactly one overflow region`
    );
    const markerIndex = chunk.html.indexOf(regionMarker);
    const regionTagStart = chunk.html.lastIndexOf("<div", markerIndex);
    const regionTag = chunk.html.slice(regionTagStart, chunk.html.indexOf(">", markerIndex) + 1);
    assert.ok(regionTag.includes('hidden=""'), `${chunk.section}: the overflow region must be hidden`);
    const regionId = attrValue(regionTag, "id");
    assert.ok(regionId, `${chunk.section}: the overflow region must have an id`);

    const primary = chunk.html.slice(0, regionTagStart);
    const overflow = chunk.html.slice(regionTagStart);
    assert.equal((primary.match(/<article\b/g) ?? []).length, 6, `${chunk.section}: 6 cards before the overflow`);
    assert.equal(
      (overflow.match(/<article\b/g) ?? []).length,
      count - 6,
      `${chunk.section}: the rest of the cards inside the overflow region`
    );

    assert.equal(buttons.length, 1, `${chunk.section}: expected exactly one expander button`);
    assert.equal(attrValue(buttons[0], "aria-expanded"), "false");
    assert.equal(attrValue(buttons[0], "aria-controls"), regionId);
    assert.ok(
      chunk.html.indexOf(buttons[0]) > markerIndex,
      `${chunk.section}: the button must follow the overflow region in DOM order`
    );
    assert.ok(
      chunk.html.includes(`Show all ${count}</button>`),
      `${chunk.section}: expected the "Show all ${count}" label`
    );
  }

  // A quiet news day with no long section exercises nothing above; say so
  // rather than staying silently green (Pitfall 12).
  t.diagnostic(`expanders on this build: ${expanders} of ${chunks.length} sections`);
});

/**
 * Every file the production build is made from: all non-test files under src/
 * plus next.config.ts. Test files are excluded so editing a test never demands
 * a rebuild.
 */
function nonTestSourceStamps(): SourceStamp[] {
  const root = process.cwd();
  const stamps: SourceStamp[] = [];
  for (const entry of readdirSync(path.join(root, "src"), { recursive: true })) {
    const rel = path.join("src", String(entry));
    const stat = statSync(path.join(root, rel));
    if (!stat.isFile() || rel.endsWith(".test.ts")) continue;
    stamps.push({ path: rel.split(path.sep).join("/"), mtimeMs: stat.mtimeMs });
  }
  stamps.push({
    path: "next.config.ts",
    mtimeMs: statSync(path.join(root, "next.config.ts")).mtimeMs,
  });
  return stamps;
}

/** The build's prerender manifest, after the stale-build guard has proved the build covers the current sources. */
function freshPrerenderManifest(): PrerenderManifest {
  let buildMtimeMs: number;
  try {
    buildMtimeMs = statSync(path.join(process.cwd(), ".next", "BUILD_ID")).mtimeMs;
  } catch {
    assert.fail("no production build in .next: run npm run build before npm test");
  }
  assert.deepStrictEqual(
    findStaleSources(buildMtimeMs, nonTestSourceStamps()),
    [],
    "stale .next build: run npm run build before npm test (these files are newer than .next/BUILD_ID)"
  );
  const manifestPath = path.join(process.cwd(), ".next", "prerender-manifest.json");
  return JSON.parse(readFileSync(manifestPath, "utf8")) as PrerenderManifest;
}

// PLAT-13: every data route reads the database per request, so none may be in the prerender
// manifest (a prerendered route would freeze its first read at build time). The stale-build guard
// comes first so the manifest being judged belongs to the current sources (T-14-36).
test("no data route is prerendered", () => {
  const manifest = freshPrerenderManifest();
  const feedRoutes = FEED_VARIANTS.flatMap((variant) => [feedPath(variant, "xml"), feedPath(variant, "json")]);
  assert.ok(feedRoutes.includes("/feed.xml") && feedRoutes.includes("/feed.json"));
  assert.equal(new Set(feedRoutes).size, FEED_VARIANTS.length * 2);
  for (const route of ["/", "/feed.xml", "/feed.json", ...feedRoutes, "/about", "/feeds", "/api/health"]) {
    assertNotPrerendered(manifest, route);
  }
});

test("each source keeps its own last good window", async () => {
  const res = await fetch(BASE_URL);
  const body = await res.text();
  assert.ok(
    body.includes(PAGE_FIXTURE_TITLES.kept),
    "K failed in the partial cycle, so its four-day-old story stays on the page"
  );
  assert.ok(
    body.includes(PAGE_FIXTURE_TITLES.fresh),
    "F succeeded in the partial cycle, so its fresh story is on the page"
  );
  assert.ok(
    !body.includes(PAGE_FIXTURE_TITLES.agedOut),
    "F's window follows F's new fetch, so its older story is gone"
  );
});

// Feeds are served from the database through the same read adapter as the page (PLAT-09, Plan 14-12):
// every feed holds each source's last good items like the page does. The read happens four days after
// the good cycle, one day after a partial cycle in which only F succeeded, and right after a failed
// cycle, so these bodies prove feeds keep each source's last good state.
test("feeds list each source's last good items, carry no CORS header and 404 an unknown name", async () => {
  const xml = await fetch(`${BASE_URL}/feed.xml`);
  assert.equal(xml.status, 200);
  assert.equal(xml.headers.get("access-control-allow-origin"), null, "the instance is private: no CORS header");
  assert.equal(xml.headers.get("x-content-type-options"), "nosniff");
  const xmlBody = await xml.text();
  assert.ok(xmlBody.includes(PAGE_FIXTURE_TITLES.kept), "K failed in the partial cycle, so its four-day-old story stays in the feed");
  assert.ok(xmlBody.includes(PAGE_FIXTURE_TITLES.fresh), "F succeeded in the partial cycle, so its fresh story is in the feed");
  assert.ok(!xmlBody.includes(PAGE_FIXTURE_TITLES.agedOut), "F's window follows F's new fetch, so its older story is gone");
  assert.ok(xmlBody.includes(`${BASE_URL}/feed.xml`), "absolute feed URLs come from HAVADIS_BASE_URL");

  const json = await fetch(`${BASE_URL}/feed.json`);
  assert.equal(json.status, 200);
  assert.equal(json.headers.get("access-control-allow-origin"), null);
  const jsonBody = await json.text();
  assert.ok(jsonBody.includes(PAGE_FIXTURE_TITLES.kept), "K's four-day-old story stays in the JSON feed");
  assert.ok(jsonBody.includes(PAGE_FIXTURE_TITLES.fresh), "F's fresh story is in the JSON feed");
  assert.ok(!jsonBody.includes(PAGE_FIXTURE_TITLES.agedOut), "F's older story is gone from the JSON feed");

  const scoped = await fetch(`${BASE_URL}/feed/${FEED_VARIANTS[1]!.slug}.json`);
  assert.equal(scoped.status, 200, "a scoped feed is served from the database too");
  await scoped.arrayBuffer();

  for (const bad of ["/feed/all.xml", "/feed/nope.xml", "/feed/nonexistent.xml", "/feed/high.txt", "/feed/..%2Fx.json"]) {
    const res = await fetch(`${BASE_URL}${bad}`);
    assert.equal(res.status, 404, `${bad} must be a 404`);
    await res.arrayBuffer();
  }
});

// PLAT-11: the Docker healthcheck endpoint answers from the database with exactly four keys.
test("GET /api/health answers 200 JSON with exactly status, web, worker and schema", async () => {
  const waiting = await fetch(`${BASE_URL}/api/health`);
  assert.equal(waiting.status, 200, "a missing heartbeat is degraded, never a failing healthcheck");
  assert.match(waiting.headers.get("content-type") ?? "", /^application\/json/);
  assert.equal(waiting.headers.get("cache-control"), "no-store");
  const waitingText = await waiting.text();
  const waitingBody = JSON.parse(waitingText) as Record<string, string>;
  assert.deepEqual(Object.keys(waitingBody).sort(), ["schema", "status", "web", "worker"]);
  assert.equal(waitingBody.schema, "ok");
  assert.equal(waitingBody.web, "ok");
  assert.equal(waitingBody.worker, "waiting", "the fixture has no worker heartbeat yet");
  assert.equal(waitingBody.status, "degraded");
  assert.equal(waitingText, JSON.stringify(waitingBody), "nothing but the four keys is serialized");

  // A real heartbeat written by another connection is visible to the running server at once.
  const worker = openDb(dbFile(dataDir), "worker");
  try {
    await beat(worker.db, new Date().toISOString(), "idle");
  } finally {
    await worker.close();
  }
  const alive = await fetch(`${BASE_URL}/api/health`);
  assert.equal(alive.status, 200);
  assert.deepEqual(await alive.json(), { status: "ok", web: "ok", worker: "ok", schema: "ok" });
});

/** Polls `url` until any HTTP answer arrives or `server` exits; throws with the captured stderr otherwise. */
async function pollServerReady(url: string, child: ChildProcess, stderr: () => string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`the server exited with ${child.exitCode} before answering:\n${stderr()}`);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      await res.body?.cancel();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
    }
  }
  throw new Error(`the server never answered on ${url} within ${READY_TIMEOUT_MS}ms:\n${stderr()}`);
}

// Before the first good cycle the page and the feeds say so. The second server runs the same build
// with a copy of the main server's exact environment (same key, same base URL, every variable the
// startup check reads) and differs only in data directory and port, so a startup refusal cannot be
// what makes this test pass or fail.
test("before the first good cycle a production server shows the waiting state on / and answers /feed.json with 503", async () => {
  assert.ok(mainServerEnv, "before() records the main server's environment");
  waitingDir = mkdtempSync(path.join(os.tmpdir(), "havadis-waiting-"));
  const worker = openDb(dbFile(waitingDir), "worker");
  try {
    await runMigrations(worker, { migrations: loadMigrations(), backup: async () => null, now: () => Date.now() });
    await seedBuiltins(worker.db, [], Date.now());
  } finally {
    await worker.close();
  }

  let waitingStderr = "";
  const child = spawn(NEXT_BIN, ["start", "-p", String(WAITING_PORT)], {
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...mainServerEnv, HAVADIS_DATA_DIR: waitingDir, PORT: String(WAITING_PORT) } as NodeJS.ProcessEnv,
  });
  waitingServer = child;
  child.stderr?.on("data", (chunk: Buffer) => void (waitingStderr += chunk.toString()));
  try {
    const base = `http://127.0.0.1:${WAITING_PORT}`;
    await pollServerReady(base, child, () => waitingStderr);

    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.ok((await page.text()).includes("Waiting for the first ingestion"), "the page must show the waiting state");

    const feed = await fetch(`${base}/feed.json`);
    assert.equal(feed.status, 503);
    assert.equal(feed.headers.get("retry-after"), "300");
    assert.equal(await feed.text(), "Waiting for the first ingestion");
  } finally {
    child.kill();
    waitingServer = null;
  }
});

test("GET /about returns 200 with no cookie, names HavadisBot, shows the exact User-Agent and the contact channel", async () => {
  const res = await fetch(`${BASE_URL}/about`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("set-cookie"), null, "/about must never set a cookie");
  const body = await res.text();
  assert.ok(body.includes("HavadisBot"), "expected the crawler name on /about");
  assert.ok(body.includes(USER_AGENT), "expected the exact User-Agent string on /about");
  assert.ok(
    body.includes(CRAWLER_CONTACT_CHANNEL_URL),
    "expected the contact/opt-out channel on /about"
  );
  if (!CRAWLER_CONTACT_CHANNEL_URL.startsWith("mailto:")) {
    assert.ok(!body.includes("mailto:"), "/about must not publish a mailto: link");
  }
});

// ENR-03 / ENR-04 / ENR-05, Phase 7. These four tests read whatever the live
// build rendered, so they never require a KEV CVE to be in today's news; they
// record what they saw through t.diagnostic.

const NVD_HREF_SHAPE = /^https:\/\/nvd\.nist\.gov\/vuln\/detail\/CVE-\d{4}-\d{4,7}$/;
const FALSE_ASSURANCE =
  /not (?:in|listed in) kev|not exploited|no known exploitation|exploitation none|ssvc none|not assessed/i;
const KEV_CHIP_TAIL = "KEV · \\d{4}-\\d{2}-\\d{2}<\\/span>";
const SSVC_CHIP_TAIL = "SSVC (?:active|poc)<\\/span>";

/**
 * The notice grammar (UI-SPEC R-5, R-8): a KEV part, an EPSS part and an SSVC
 * part, each optional, at least one, in that order, joined by " · ".
 */
const NOTICE_KEV = "(?:KEV data unavailable|KEV data from \\d{4}-\\d{2}-\\d{2})";
const NOTICE_EPSS = "(?:EPSS data unavailable|EPSS partially unavailable)";
const NOTICE_SSVC = "(?:SSVC data unavailable|SSVC partially unavailable)";
const NOTICE_GRAMMAR = new RegExp(
  `^(?:${NOTICE_KEV}(?: · ${NOTICE_EPSS})?(?: · ${NOTICE_SSVC})?|${NOTICE_EPSS}(?: · ${NOTICE_SSVC})?|${NOTICE_SSVC})$`
);

/**
 * The page's own markup: the document without scripts (the flight payload
 * repeats every card), card headlines and card summaries. Feed-authored text
 * may say "no known exploitation" legitimately, so only text the page itself
 * writes (chips, titles, notice, labels) is held to the no-false-assurance rule.
 */
function ownMarkup(body: string): string {
  return body
    .replace(/<script\b[\s\S]*?<\/script>/g, "")
    .replace(/<h3\b[\s\S]*?<\/h3>/g, "")
    .replace(/<p\b[^>]*line-clamp[^>]*>[\s\S]*?<\/p>/g, "");
}

test("the page's own markup never says a CVE is not in KEV or not exploited", async (t) => {
  const res = await fetch(BASE_URL);
  const body = await res.text();

  // The check can fail: it flags the wording it exists to forbid.
  assert.match("CVE is not in KEV", FALSE_ASSURANCE);
  assert.match("Not exploited", FALSE_ASSURANCE);
  assert.match("Exploitation none", FALSE_ASSURANCE);
  assert.match("SSVC none", FALSE_ASSURANCE);
  assert.match("Not assessed", FALSE_ASSURANCE);

  const own = ownMarkup(body);
  assert.ok(own.length > 0 && own.length < body.length, "the own-markup filter must remove something");
  assert.doesNotMatch(own, FALSE_ASSURANCE);
  t.diagnostic(`checked ${own.length} bytes of own markup of ${body.length}`);
});

test("every KEV chip is a span directly after an NVD anchor, with the sr-only prefix and a dated text", async (t) => {
  const res = await fetch(BASE_URL);
  const body = await res.text();
  const main = mainHtml(body);

  const chipCount = [...main.matchAll(/\sdata-kev-chip=/g)].length;
  assert.ok(chipCount >= 1, "the fixture lists one CVE in KEV, so the page must render at least one KEV chip");
  const shaped = [
    ...main.matchAll(
      new RegExp(
        `(<a\\b[^>]*>)[^<]*<\\/a><span data-kev-chip=""[^>]*><span class="sr-only">Known exploited, <\\/span>(?:<!-- -->)?${KEV_CHIP_TAIL}`,
        "g"
      )
    ),
  ];
  assert.equal(shaped.length, chipCount, "every KEV chip must follow an anchor and have the exact content shape");
  for (const m of shaped) {
    const href = attrValue(m[1], "href");
    assert.ok(href !== null && NVD_HREF_SHAPE.test(href), `KEV chip follows a non-NVD anchor: ${m[1]}`);
  }
  for (const tag of openingTags(main, "span").filter((s) => s.includes("data-kev-chip"))) {
    assert.ok(!tag.includes("href="), "a KEV chip is never a link");
  }
  t.diagnostic(`KEV chips: ${chipCount}`);
});

test("every SSVC chip is a span directly after an NVD anchor, never after a KEV chip, with the sr-only prefix and a fixed text", async (t) => {
  const res = await fetch(BASE_URL);
  const body = await res.text();
  const main = mainHtml(body);

  const chipCount = [...main.matchAll(/\sdata-ssvc-chip=/g)].length;
  assert.ok(chipCount >= 1, "the fixture assesses one CVE as actively exploited, so the page must render at least one SSVC chip");
  const shaped = [
    ...main.matchAll(
      /(<a\b[^>]*>)[^<]*<\/a><span data-ssvc-chip="(active|poc)"[^>]*><span class="sr-only">CISA assessment, <\/span>(?:<!-- -->)?SSVC (active|poc)<\/span>/g
    ),
  ];
  assert.equal(shaped.length, chipCount, "every SSVC chip must follow an anchor and have the exact content shape");
  for (const m of shaped) {
    const href = attrValue(m[1], "href");
    assert.ok(href !== null && NVD_HREF_SHAPE.test(href), `SSVC chip follows a non-NVD anchor: ${m[1]}`);
    assert.equal(m[2], m[3], "the visible SSVC text must name the same level as the data attribute");
  }
  assert.doesNotMatch(main, new RegExp(`${KEV_CHIP_TAIL}<span data-ssvc-chip`), "no SSVC chip may follow a KEV chip");
  for (const tag of openingTags(main, "span").filter((s) => s.includes("data-ssvc-chip"))) {
    assert.ok(!tag.includes("href="), "an SSVC chip is never a link");
  }
  t.diagnostic(`SSVC chips: ${chipCount}`);
});

test("every EPSS chip is a span after its CVE anchor or its KEV chip, with a score or 'no EPSS yet' text", async (t) => {
  const res = await fetch(BASE_URL);
  const body = await res.text();
  const main = mainHtml(body);

  const chipCount = [...main.matchAll(/\sdata-epss-chip=/g)].length;
  const shaped = [
    ...main.matchAll(
      new RegExp(
        `(<\\/a>|${KEV_CHIP_TAIL}|${SSVC_CHIP_TAIL})<span data-epss-chip="(score|none-yet)"[^>]*>([^<]*)<\\/span>`,
        "g"
      )
    ),
  ];
  assert.equal(shaped.length, chipCount, "every EPSS chip must directly follow an anchor, a KEV chip or an SSVC chip");

  let scored = 0;
  let noneYet = 0;
  for (const m of shaped) {
    if (m[1] === "</a>") {
      const anchorStart = main.lastIndexOf("<a ", m.index as number);
      const href = attrValue(main.slice(anchorStart, main.indexOf(">", anchorStart) + 1), "href");
      assert.ok(href !== null && NVD_HREF_SHAPE.test(href), "an EPSS chip after an anchor follows an NVD anchor");
    }
    if (m[2] === "score") {
      scored++;
      assert.match(m[3], /^EPSS (?:\d\.\d{2}|&lt;0\.01)$/, `unexpected EPSS chip text: ${m[3]}`);
    } else {
      noneYet++;
      assert.equal(m[3], "no EPSS yet");
    }
  }
  assert.ok(chipCount >= 1, "the fixture scores one CVE in EPSS, so the page must render at least one EPSS chip");
  assert.ok(scored >= 1, "at least one EPSS chip must carry a score");
  assert.ok(!main.includes("EPSS 0.00"), "a score below 0.01 reads <0.01, never 0.00");
  t.diagnostic(`EPSS chips: ${chipCount} (${scored} scored, ${noneYet} no EPSS yet)`);
});

test("at most one enrichment notice, inside the filter bar before main, from the fixed vocabulary", async (t) => {
  // The grammar can fail: it accepts the ordered parts and rejects the rest.
  for (const ok of [
    "KEV data unavailable",
    "EPSS partially unavailable",
    "SSVC data unavailable",
    "SSVC partially unavailable",
    "KEV data from 2026-10-06 · SSVC partially unavailable",
    "KEV data unavailable · EPSS data unavailable · SSVC data unavailable",
  ]) {
    assert.match(ok, NOTICE_GRAMMAR);
  }
  for (const bad of [
    "",
    "SSVC data unavailable · EPSS data unavailable",
    "EPSS data unavailable · KEV data unavailable",
    "SSVC data unavailable · ",
    "SSVC is fine",
  ]) {
    assert.doesNotMatch(bad, NOTICE_GRAMMAR);
  }
  const res = await fetch(BASE_URL);
  const body = await res.text();

  const spans = openingTags(body, "span").filter((s) => s.includes("data-enrichment-notice"));
  assert.ok(spans.length <= 1, `expected at most one data-enrichment-notice, got ${spans.length}`);
  if (spans.length === 0) {
    t.diagnostic("notice: none (every provider healthy)");
    return;
  }

  const at = body.indexOf("data-enrichment-notice");
  assert.ok(
    at > body.indexOf("data-filter-bar") && at < body.indexOf("<main"),
    "the notice must live inside the filter bar, above <main>"
  );
  const inner = body.slice(at).match(/^data-enrichment-notice=""[^>]*>([^<]*)<\/span>/);
  assert.ok(inner, "expected the notice to hold a single text node");
  const text = inner![1];
  assert.match(text, NOTICE_GRAMMAR);
  assert.equal(attrValue(spans[0], "title"), text, "the full text is also the title");
  assert.doesNotMatch(text, FALSE_ASSURANCE);
  t.diagnostic(`notice: ${text}`);
});

// PLAT-14, T-14-29, T-14-30, T-14-52: the browser contacts only the instance.

/** The nonce named in a Content-Security-Policy header value, or null. */
function nonceOfPolicy(csp: string | null): string | null {
  const m = csp?.match(/'nonce-([^']+)'/);
  return m ? m[1] : null;
}

/** The script opening tags of a document: bodies are payload, not markup, so only the tags are read. */
function scriptTags(html: string): string[] {
  return openingTags(html, "script");
}

test("GET / carries a nonce CSP whose nonce is on every script tag, and Referrer-Policy no-referrer", async () => {
  const res = await fetch(BASE_URL);
  const body = await res.text();
  const csp = res.headers.get("content-security-policy");
  assert.ok(csp, "expected a Content-Security-Policy header");
  for (const directive of ["default-src 'self'", "connect-src 'self'", "object-src 'none'", "frame-ancestors 'none'"]) {
    assert.ok(csp.includes(directive), `expected ${directive} in the policy`);
  }
  assert.ok(!csp.includes("upgrade-insecure-requests"));
  assert.ok(!csp.includes("unsafe-eval"), "a production build never needs unsafe-eval");
  const nonce = nonceOfPolicy(csp);
  assert.ok(nonce, "expected a nonce in the policy");
  const tags = scriptTags(body);
  assert.ok(tags.length > 0, "expected script tags in the page");
  for (const tag of tags) {
    assert.equal(attrValue(tag, "nonce"), nonce, `every script tag must carry this response's nonce: ${tag}`);
  }
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});

test("the CSP, nonce and Referrer-Policy are on /about and /feeds too", async () => {
  for (const route of ["/about", "/feeds"]) {
    const res = await fetch(`${BASE_URL}${route}`);
    const body = await res.text();
    const nonce = nonceOfPolicy(res.headers.get("content-security-policy"));
    assert.ok(nonce, `${route}: expected a nonce in the policy`);
    assert.equal(res.headers.get("referrer-policy"), "no-referrer", route);
    for (const tag of scriptTags(body)) assert.equal(attrValue(tag, "nonce"), nonce, `${route}: ${tag}`);
  }
});

test("under concurrent requests each response gets its own nonce and no nonce is shared", async () => {
  const responses = await Promise.all(
    Array.from({ length: 12 }, async (_, i) => {
      const res = await fetch(i % 2 === 0 ? BASE_URL : `${BASE_URL}/about`);
      return { nonce: nonceOfPolicy(res.headers.get("content-security-policy")), body: await res.text() };
    }),
  );
  assert.equal(new Set(responses.map((r) => r.nonce)).size, responses.length, "no nonce may be shared");
  for (const { nonce, body } of responses) {
    assert.ok(nonce);
    for (const tag of scriptTags(body)) assert.equal(attrValue(tag, "nonce"), nonce);
  }
});

test("the served pages contain no style attribute", async () => {
  for (const route of ["/", "/about", "/feeds"]) {
    const body = await (await fetch(`${BASE_URL}${route}`)).text();
    // Script bodies are the flight payload, where feed text could quote anything; markup is what a style-src policy governs.
    const markup = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
    assert.doesNotMatch(markup, /\sstyle\s*=/i, `${route}: a style attribute is blocked by style-src without unsafe-inline`);
  }
});

const ORIGIN_GATED_TAGS = ["script", "link", "img", "iframe", "source", "form"];
const ORIGIN_GATED_ATTRIBUTES = ["src", "href", "srcset", "action"];

/**
 * A reference stays on the instance when it is a rooted path (not "//host" and not "/\\host", which browsers
 * read as a host) or an absolute URL whose origin, port included, is exactly `origin`.
 */
function isInstanceReference(value: string, origin: string): boolean {
  if (value.startsWith("/")) return !value.startsWith("//") && !value.startsWith("/\\");
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}

/** Every src, href, srcset and action of the gated tags that leaves the instance, as "<tag> attr=value". */
function thirdPartyReferences(html: string, origin: string): string[] {
  const markup = html.replace(/<script\b([^>]*)>[\s\S]*?<\/script>/g, "<script$1></script>");
  const found: string[] = [];
  for (const tagName of ORIGIN_GATED_TAGS) {
    for (const tag of openingTags(markup, tagName)) {
      for (const attribute of ORIGIN_GATED_ATTRIBUTES) {
        const value = attrValue(tag, attribute);
        if (value === null) continue;
        const references =
          attribute === "srcset"
            ? value.split(",").map((candidate) => candidate.trim().split(/\s+/)[0] ?? "")
            : [value];
        for (const reference of references) {
          if (!isInstanceReference(reference, origin)) found.push(`<${tagName}> ${attribute}=${reference}`);
        }
      }
    }
  }
  return found;
}

test("the third-party origin matcher accepts the instance and rejects every other origin, other ports included", () => {
  const origin = "http://127.0.0.1:3100";
  const good = [
    '<script src="/_next/static/chunks/a.js" nonce="x" async=""></script>',
    '<link rel="stylesheet" href="/_next/static/chunks/a.css"/>',
    `<link rel="alternate" href="${origin}/feed.xml"/>`,
    '<img src="/a.png" srcset="/a.png 1x, /b.png 2x"/>',
    '<form action="/search"></form>',
    '<a href="https://publisher.example/story">navigation, not checked</a>',
  ];
  for (const html of good) assert.deepEqual(thirdPartyReferences(html, origin), [], html);
  const bad = [
    '<script src="http://127.0.0.1:3101/x.js"></script>',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow"/>',
    '<img src="//cdn.example/x.png"/>',
    '<img src="/a.png" srcset="/a.png 1x, https://cdn.example/b.png 2x"/>',
    '<iframe src="https://evil.example/"></iframe>',
    '<source src="http://localhost:3100/x"/>',
    '<form action="https://evil.example/post"></form>',
    `<link href="${origin}@evil.example/x"/>`,
    '<script src="relative/path.js"></script>',
    '<img src="/\\evil.example/x.png"/>',
  ];
  for (const html of bad) assert.equal(thirdPartyReferences(html, origin).length, 1, html);
});

test("/, /about and /feeds reference no origin other than the instance itself", async (t) => {
  for (const route of ["/", "/about", "/feeds"]) {
    const body = await (await fetch(`${BASE_URL}${route}`)).text();
    assert.deepEqual(thirdPartyReferences(body, BASE_URL), [], `${route}: a reader's browser would contact a third party`);
    t.diagnostic(`${route}: ${body.length} bytes checked`);
  }
});

test("next start without HAVADIS_SECRET_KEY exits non-zero with a fixed message and never answers", async () => {
  let output = "";
  const refused = spawn(NEXT_BIN, ["start", "-p", String(REFUSED_PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: serverEnv({ HAVADIS_DATA_DIR: dataDir }),
  });
  refused.stdout?.on("data", (chunk: Buffer) => void (output += chunk.toString()));
  refused.stderr?.on("data", (chunk: Buffer) => void (output += chunk.toString()));
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`the server kept running without a key for ${REFUSAL_TIMEOUT_MS}ms:\n${output}`)),
        REFUSAL_TIMEOUT_MS,
      );
      refused.once("exit", (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
    });
    assert.ok(code !== null && code !== 0, `expected a non-zero exit, got ${code}`);
    assert.ok(output.includes("HAVADIS_SECRET_KEY"), `expected the message to name HAVADIS_SECRET_KEY:\n${output}`);
    assert.ok(output.includes("key_missing"), "expected the fixed reason code in the log line");
    assert.ok(!output.includes(operatorKey), "the operator key must never reach the output");
    await assert.rejects(
      fetch(`http://127.0.0.1:${REFUSED_PORT}`, { signal: AbortSignal.timeout(2_000) }),
      "nothing may answer on the refused server's port",
    );
  } finally {
    refused.kill();
  }
});

/** Every `url(...)` target and `@import` string in a stylesheet. */
function cssReferences(css: string): string[] {
  const urls = [...css.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/g)].map((m) => m[2]);
  const imports = [...css.matchAll(/@import\s+(["'])(.*?)\1/g)].map((m) => m[2]);
  return [...urls, ...imports];
}

/** A stylesheet reference that reaches a host: any scheme but data:, or a protocol-relative "//host". */
function reachesAHost(reference: string): boolean {
  const ref = reference.trim();
  return ref.startsWith("//") || (/^[a-z][a-z0-9+.-]*:/i.test(ref) && !/^data:/i.test(ref));
}

test("the built stylesheets reference no host: no url() or @import with a scheme or a // host", () => {
  assert.equal(reachesAHost("https://fonts.gstatic.com/s/barlow.woff2"), true);
  assert.equal(reachesAHost("//fonts.gstatic.com/s/barlow.woff2"), true);
  assert.equal(reachesAHost("../media/Barlow_400-s.p.woff2"), false);
  assert.equal(reachesAHost("data:image/svg+xml;base64,AAAA"), false);
  assert.deepEqual(cssReferences('a{background:url( "x.png" )}@import "y.css";b{src:url(../m/z.woff2)}'), ["x.png", "../m/z.woff2", "y.css"]);

  // Next 16 with Turbopack writes its CSS under .next/static/chunks, and next/font/local emits relative url(../media/*.woff2).
  const files = readdirSync(path.join(process.cwd(), ".next", "static"), { recursive: true })
    .map((entry) => path.join(process.cwd(), ".next", "static", String(entry)))
    .filter((file) => file.endsWith(".css"));
  assert.ok(files.length > 0, "expected built stylesheets under .next/static");
  const offenders: string[] = [];
  for (const file of files) {
    for (const reference of cssReferences(readFileSync(file, "utf8"))) {
      if (reachesAHost(reference)) offenders.push(`${path.basename(file)}: ${reference}`);
    }
  }
  assert.deepEqual(offenders, []);
});
