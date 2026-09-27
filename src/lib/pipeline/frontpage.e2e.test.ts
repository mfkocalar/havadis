import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCES } from "../config/sources.ts";
import { SECTION_DISPLAY_ORDER } from "../config/sections.ts";
import { fetchSource } from "./fetchSource.ts";
import { getFrontPage } from "./getFrontPage.ts";
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
 */

test("fetchSource(Krebs) yields at least one normalized article before lookback filtering", async () => {
  const krebs = SOURCES.find((s) => s.id === "krebs");
  assert.ok(krebs, "expected a krebs entry in SOURCES");
  const result = await fetchSource(krebs!);
  assert.equal(result.status, "ok", "expected fetchSource to succeed against the live feed");
  if (result.status !== "ok") return;
  // The feed always carries roughly ten entries regardless of their age —
  // this asserts the raw parse worked, before any 24h trimming.
  assert.ok(
    result.articles.length >= 1,
    "expected at least one normalized article from the live Krebs feed"
  );
});

test("getFrontPage() resolves to the ok variant with well-formed, current articles from configured sources", async () => {
  const result = await getFrontPage();
  assert.equal(result.status, "ok", "getFrontPage must never surface an error while at least one source is healthy");
  if (result.status !== "ok") return;

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
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
      publishedMs >= cutoff,
      `article publishedAt ${article.publishedAt} should be within the last 24 hours`
    );

    assert.equal(typeof article.summary, "string");
    assert.ok(
      SECTION_DISPLAY_ORDER.includes(article.section),
      `expected ${article.section} to be a member of SECTION_DISPLAY_ORDER`
    );
  }

  // Deliberately no minimum-count assertion on the post-filter list:
  // several configured sources legitimately post infrequently enough that
  // a genuinely empty 24h window is a correct result for them, not a
  // flaky test failure (RESEARCH.md Pitfall 4).
});

// Replaces the removed "getFrontPage() returns articles sorted non-increasing
// by publishedAt" test: once articles are classified and grouped, a global
// recency order across the whole flat list is structurally incompatible with
// sectioned output (RESEARCH.md "Existing Tests Requiring Updates"). This is
// the section-shape contract that replaces it.
test("getFrontPage() groups every article into exactly one non-empty section, in SECTION_DISPLAY_ORDER", async () => {
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

test("getFrontPage()'s contributing sources are a subset of the configured source names", async () => {
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
test("within every live section, adjacent articles are non-increasing by rankScore for the same now", async () => {
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
