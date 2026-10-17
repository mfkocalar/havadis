import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { SECTION_DISPLAY_ORDER } from "../src/lib/config/sections.ts";
import { CRAWLER_CONTACT_CHANNEL_URL, USER_AGENT } from "../src/lib/config/crawler.ts";
import {
  assertStaticRoute,
  findStaleSources,
  type PrerenderManifest,
  type SourceStamp,
} from "./fixtures/staticRouteGate.ts";

/**
 * Drives a real `next start` production server and asserts the public
 * no-authentication contract and the cold-cache render (UI-06, INGEST-05
 * empty edge). RESEARCH.md Pitfall P1-4: Next.js never caches pages in
 * `next dev` — this criterion is unverifiable there, so this test spawns
 * the actual production build's start script instead.
 */

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_INTERVAL_MS = 500;

let server: ChildProcess | null = null;
let stderrLog = "";

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
  const nextBin = path.join(process.cwd(), "node_modules", ".bin", "next");
  server = spawn(nextBin, ["start", "-p", String(PORT)], {
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env },
  });
  server.stderr?.on("data", (chunk: Buffer) => {
    stderrLog += chunk.toString();
  });

  try {
    await pollUntilReady();
  } catch (err) {
    server.kill();
    server = null;
    throw err;
  }
});

after(async () => {
  if (server) {
    server.kill();
    server = null;
  }
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

  const LABEL_RE =
    /<span class="([^"]*)"><span class="sr-only">Source type: <\/span>(?:<!-- -->)?(News|Research|Vendor|CERT|Government)<\/span>/g;

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

    const pillIndex = card.indexOf("rounded-full");
    assert.ok(pillIndex !== -1, "expected the tier pill (rounded-full) in the card");
    assert.ok(labelIndex > pillIndex, "the type label must come after the tier pill");

    const nvdIndex = card.indexOf("nvd.nist.gov");
    if (nvdIndex !== -1) {
      assert.ok(labelIndex < nvdIndex, "the type label must come before the first CVE chip");
    }
  }
  t.diagnostic(`checked ${cards.length} cards`);
});

test("two consecutive requests return byte-identical HTML", async () => {
  // Necessary, not sufficient: two independently-uncached renders taken
  // within the same second could also happen to match. The sufficient
  // proof of the 900s stale-while-revalidate window is the human-observed
  // x-vercel-cache backstop truth on a deployed preview (this plan's own
  // must_haves), not this assertion — this only catches a gross regression
  // cheaply and automatically.
  const [res1, res2] = await Promise.all([fetch(BASE_URL), fetch(BASE_URL)]);
  const [body1, body2] = await Promise.all([res1.text(), res2.text()]);
  assert.equal(body1, body2);
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

test("the front page is still statically prerendered with the 900-second revalidation window", () => {
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
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PrerenderManifest;
  assertStaticRoute(manifest, "/", 900);
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

test("/about is prerendered as a static route", () => {
  const manifestPath = path.join(process.cwd(), ".next", "prerender-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    routes: Record<string, { initialRevalidateSeconds?: number | false; compute?: string }>;
  };
  const route = manifest.routes["/about"];
  assert.ok(route, 'expected "/about" in the prerender manifest');
  assert.equal(route.initialRevalidateSeconds, false);
  assert.equal(route.compute, "static");
});

// ENR-03 / ENR-04 / ENR-05, Phase 7. These four tests read whatever the live
// build rendered, so they never require a KEV CVE to be in today's news; they
// record what they saw through t.diagnostic.

const NVD_HREF_SHAPE = /^https:\/\/nvd\.nist\.gov\/vuln\/detail\/CVE-\d{4}-\d{4,7}$/;
const FALSE_ASSURANCE = /not (?:in|listed in) kev|not exploited|no known exploitation/i;
const KEV_CHIP_TAIL = "KEV · \\d{4}-\\d{2}-\\d{2}<\\/span>";

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

test("every EPSS chip is a span after its CVE anchor or its KEV chip, with a score or 'no EPSS yet' text", async (t) => {
  const res = await fetch(BASE_URL);
  const body = await res.text();
  const main = mainHtml(body);

  const chipCount = [...main.matchAll(/\sdata-epss-chip=/g)].length;
  const shaped = [
    ...main.matchAll(
      new RegExp(
        `(<\\/a>|${KEV_CHIP_TAIL})<span data-epss-chip="(score|none-yet)"[^>]*>([^<]*)<\\/span>`,
        "g"
      )
    ),
  ];
  assert.equal(shaped.length, chipCount, "every EPSS chip must directly follow an anchor or a KEV chip");

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
  assert.ok(!main.includes("EPSS 0.00"), "a score below 0.01 reads <0.01, never 0.00");
  t.diagnostic(`EPSS chips: ${chipCount} (${scored} scored, ${noneYet} no EPSS yet)`);
});

test("at most one enrichment notice, inside the filter bar before main, from the fixed vocabulary", async (t) => {
  const res = await fetch(BASE_URL);
  const body = await res.text();

  const spans = openingTags(body, "span").filter((s) => s.includes("data-enrichment-notice"));
  assert.ok(spans.length <= 1, `expected at most one data-enrichment-notice, got ${spans.length}`);
  if (spans.length === 0) {
    t.diagnostic("notice: none (both providers healthy)");
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
  assert.match(
    text,
    /^(?:KEV data unavailable|KEV data from \d{4}-\d{2}-\d{2})(?: · (?:EPSS data unavailable|EPSS partially unavailable))?$|^(?:EPSS data unavailable|EPSS partially unavailable)$/
  );
  assert.equal(attrValue(spans[0], "title"), text, "the full text is also the title");
  assert.doesNotMatch(text, FALSE_ASSURANCE);
  t.diagnostic(`notice: ${text}`);
});
