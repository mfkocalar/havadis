import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { SECTION_DISPLAY_ORDER } from "../src/lib/config/sections.ts";

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
  const hasArticleAnchor = /target="_blank" rel="noopener noreferrer"/.test(body);
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

  const hasArticleAnchor = /target="_blank" rel="noopener noreferrer"/.test(body);
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
