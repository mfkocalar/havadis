import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCES } from "../config/sources.ts";
import { SECTION_DISPLAY_ORDER } from "../config/sections.ts";
import { LOOKBACK_HOURS, SOURCE_TYPES } from "../config/sourceTypes.ts";
import { canonicalizeUrl } from "./canonicalizeUrl.ts";
import { extractCves } from "./extractCves.ts";
import { fetchSource } from "./fetchSource.ts";
import { getFrontPage } from "./getFrontPage.ts";
import { normalizeTitleForDedupe } from "./normalizeTitleForDedupe.ts";
import { rankScore } from "./rank.ts";

/**
 * End-to-end test driving the whole traced path against the live feeds —
 * not a per-layer unit test. Under plain `node --test` there is no Next.js
 * runtime; native fetch simply ignores the unrecognised `next` init
 * property, so the pipeline runs unchanged.
 *
 * Assertions are deliberately source-agnostic (derived from `SOURCES`
 * itself) rather than hard-coding a single source's name/tier/URL prefix,
 * because this phase widens `SOURCES` beyond one entry and any article in
 * the combined list may come from any configured source.
 *
 * Gated behind an explicit `E2E=1` opt-in (WR-05, 03-REVIEW.md): these
 * tests make unmocked live network calls to 13 real third-party domains
 * with no retry/offline handling, so a network-restricted `npm test` (a
 * common CI/sandbox restriction) must not fail on infrastructure it
 * doesn't control. Run with `E2E=1 npm test` (or a scheduled job with
 * egress) to actually exercise this file.
 */

const E2E_SKIP_REASON =
  "Skipped: set E2E=1 to run this suite against live third-party feeds (see WR-05, 03-REVIEW.md)";
const e2eOptions = { skip: process.env.E2E === "1" ? false : E2E_SKIP_REASON };

test("fetchSource(Krebs) yields at least one normalized article before lookback filtering", e2eOptions, async () => {
  const krebs = SOURCES.find((s) => s.id === "krebs");
  assert.ok(krebs, "expected a krebs entry in SOURCES");
  const result = await fetchSource(krebs!);
  assert.equal(result.status, "ok", "expected fetchSource to succeed against the live feed");
  if (result.status !== "ok") return;
  // The feed always carries roughly ten entries regardless of their age —
  // this asserts the raw parse worked, before any lookback-window trimming.
  assert.ok(
    result.articles.length >= 1,
    "expected at least one normalized article from the live Krebs feed"
  );
});

test("getFrontPage() resolves to the ok variant with well-formed, current articles from configured sources", e2eOptions, async () => {
  const now = Date.now();
  const result = await getFrontPage(now);
  assert.equal(result.status, "ok", "getFrontPage must never surface an error while at least one source is healthy");
  if (result.status !== "ok") return;

  const names = new Set(SOURCES.map((s) => s.name));
  const tiers = new Set(SOURCES.map((s) => s.tier));

  for (const article of result.articles) {
    assert.equal(typeof article.title, "string");
    assert.ok(article.title.length > 0, "title must not be empty");

    assert.equal(typeof article.url, "string");
    assert.equal(
      new URL(article.url).protocol,
      "https:",
      `expected an https:// URL, got ${article.url}`
    );

    assert.ok(names.has(article.source), `expected ${article.source} to be a configured source name`);
    assert.ok(tiers.has(article.sourceTier), `expected ${article.sourceTier} to be a configured source tier`);

    assert.equal(typeof article.publishedAt, "string");
    const publishedMs = new Date(article.publishedAt).getTime();
    assert.ok(Number.isFinite(publishedMs), "publishedAt must parse as a valid date");
    assert.ok(
      SOURCE_TYPES.includes(article.sourceType),
      `expected ${article.sourceType} to be a member of SOURCE_TYPES`
    );
    const cutoff = now - LOOKBACK_HOURS[article.sourceType] * 60 * 60 * 1000;
    assert.ok(
      publishedMs >= cutoff,
      `article publishedAt ${article.publishedAt} should be within its source type's lookback window`
    );

    assert.equal(typeof article.summary, "string");
    assert.ok(
      SECTION_DISPLAY_ORDER.includes(article.section),
      `expected ${article.section} to be a member of SECTION_DISPLAY_ORDER`
    );
  }

  // Deliberately no minimum-count assertion on the post-filter list:
  // several configured sources legitimately post infrequently enough that
  // a genuinely empty lookback window is a correct result for them, not a
  // flaky test failure (RESEARCH.md Pitfall 4).
});

// Replaces the removed "getFrontPage() returns articles sorted non-increasing
// by publishedAt" test: once articles are classified and grouped, a global
// recency order across the whole flat list is structurally incompatible with
// sectioned output (RESEARCH.md "Existing Tests Requiring Updates"). This is
// the section-shape contract that replaces it.
test("getFrontPage() groups every article into exactly one non-empty section, in SECTION_DISPLAY_ORDER", e2eOptions, async () => {
  const result = await getFrontPage();
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;

  let lastIndex = -1;
  for (const group of result.sections) {
    const index = SECTION_DISPLAY_ORDER.indexOf(group.section);
    assert.ok(index >= 0, `expected ${group.section} to be a member of SECTION_DISPLAY_ORDER`);
    assert.ok(
      index > lastIndex,
      `expected section ${group.section} to appear after the previous group in SECTION_DISPLAY_ORDER`
    );
    lastIndex = index;

    assert.ok(group.articles.length > 0, `expected every group to hold at least one article`);
    for (const article of group.articles) {
      assert.equal(
        article.section,
        group.section,
        "expected every article inside a group to carry that group's section"
      );
    }
  }

  assert.deepEqual(
    result.articles,
    result.sections.flatMap((group) => group.articles),
    "expected the flat articles list to equal the sections flattened in order"
  );
});

test("getFrontPage()'s contributing sources are a subset of the configured source names", e2eOptions, async () => {
  const result = await getFrontPage();
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;

  const names = new Set(SOURCES.map((s) => s.name));
  const contributing = new Set(result.articles.map((a) => a.source));
  for (const source of contributing) {
    assert.ok(names.has(source), `${source} is not a configured source name`);
  }
});

// Live CLASSIFY-02 check: within every section, adjacent articles must be
// non-increasing by rankScore for the same `now` passed to getFrontPage(now)
// (D-09). Sampling `now` once and threading it into both getFrontPage and
// rankScore keeps the comparison consistent with a single instant, exactly
// as rank.ts's own contract requires.
test("within every live section, adjacent articles are non-increasing by rankScore for the same now", e2eOptions, async () => {
  const now = Date.now();
  const result = await getFrontPage(now);
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;

  for (const group of result.sections) {
    for (let i = 1; i < group.articles.length; i++) {
      const prev = group.articles[i - 1];
      const next = group.articles[i];
      assert.ok(
        rankScore(prev, now) >= rankScore(next, now),
        `expected ${JSON.stringify(prev.title)} (score ${rankScore(prev, now)}) to rank at or ` +
          `above ${JSON.stringify(next.title)} (score ${rankScore(next, now)}) within section ${group.section}`
      );
    }
  }
});

// NORM-02 live invariant (assumption-delta guard, see 03-02-PLAN.md's
// <assumption_delta_decision>): dedupe guarantees uniqueness by
// construction, but this assertion proves it holds against today's real
// feed data too — so `page.tsx`'s `key={article.url}` can never silently
// collide. Both the canonical URL key and any non-empty normalized title
// key must also stay unique, since dedupe unions on either.
test("post-dedupe, every article.url, canonicalizeUrl key, and non-empty normalizeTitleForDedupe key is unique", e2eOptions, async () => {
  const result = await getFrontPage();
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;

  const urls = new Set<string>();
  const urlKeys = new Set<string>();
  const titleKeys = new Set<string>();

  for (const article of result.articles) {
    assert.ok(!urls.has(article.url), `duplicate article.url: ${article.url}`);
    urls.add(article.url);

    const urlKey = canonicalizeUrl(article.url);
    assert.ok(!urlKeys.has(urlKey), `duplicate canonical URL key: ${urlKey}`);
    urlKeys.add(urlKey);

    const titleKey = normalizeTitleForDedupe(article.title);
    if (titleKey !== "") {
      assert.ok(!titleKeys.has(titleKey), `duplicate normalized title key: ${titleKey}`);
      titleKeys.add(titleKey);
    }
  }
});

// UI-03 live invariant: every article.cves entry is a well-formed CVE ID,
// has no duplicates, and equals extractCves(article) — proving getFrontPage
// never diverges from the pure extraction function against real feed data.
test("every live article.cves entry matches the CVE ID shape, has no duplicates, and equals extractCves(article)", e2eOptions, async () => {
  const result = await getFrontPage();
  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;

  const CVE_ID_SHAPE = /^CVE-\d{4}-\d{4,7}$/;
  for (const article of result.articles) {
    assert.ok(Array.isArray(article.cves), "expected article.cves to be an array");
    const seen = new Set<string>();
    for (const id of article.cves) {
      assert.ok(CVE_ID_SHAPE.test(id), `expected ${id} to match ${CVE_ID_SHAPE}`);
      assert.ok(!seen.has(id), `duplicate CVE ID ${id} on article ${article.url}`);
      seen.add(id);
    }
    assert.deepEqual(
      article.cves,
      extractCves(article),
      `expected article.cves to equal extractCves(article) for ${article.url}`
    );
  }
});
