import { test } from "node:test";
import assert from "node:assert/strict";
import type { Article } from "../types.ts";
import { SECTION_DISPLAY_ORDER } from "../config/sections.ts";
import { composeFrontPage } from "./getFrontPage.ts";

/**
 * Hermetic tests proving the composed pipeline (dedupe -> classify ->
 * group/rank) end to end (ROADMAP SC-1). Importing `composeFrontPage`
 * performs no network I/O — this test never touches the live feeds.
 * Fixed `NOW` so results are deterministic; fixtures are full six-field
 * `Article` objects with `publishedAt` derived arithmetically from `NOW`.
 * Assertions are on selected fields only, never a whole-object deepEqual
 * on a classified article — Plan 03-03 adds a `cves` field to every
 * classified article, and a whole-object assertion here would break then.
 */

const NOW = Date.parse("2026-09-23T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function article(overrides: Partial<Article>): Article {
  return {
    title: "Fixture Article",
    url: "https://fixture.test/story",
    source: "Fixture Source",
    sourceTier: "Tech & General",
    publishedAt: new Date(NOW).toISOString(),
    summary: "A fixture summary.",
    ...overrides,
  };
}

test("three-outlet Foo Corp fixture collapses to exactly one Breaches article, the earliest copy", () => {
  const bleepingComputer = article({
    title: "Foo Corp confirms data breach",
    url: "https://www.example-news.test/foo-corp-breach",
    source: "Bleeping Computer",
    sourceTier: "Threat Intelligence",
    publishedAt: new Date(NOW - 2 * HOUR).toISOString(),
  });
  const theHackerNews = article({
    title: "Foo Corp breach: what we know",
    url: "http://WWW.example-news.test/foo-corp-breach/?utm_source=rss#top",
    source: "The Hacker News",
    sourceTier: "Threat Intelligence",
    publishedAt: new Date(NOW - 3 * HOUR).toISOString(),
  });
  const techCrunch = article({
    title: "FOO CORP CONFIRMS DATA BREACH!",
    url: "https://techcrunch.test/2026/09/23/foo",
    source: "TechCrunch Security",
    sourceTier: "Tech & General",
    publishedAt: new Date(NOW - 1 * HOUR).toISOString(),
  });

  const result = composeFrontPage([bleepingComputer, theHackerNews, techCrunch], NOW);

  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0].title, "Foo Corp breach: what we know");
  assert.equal(result.articles[0].section, "Breaches");
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].section, "Breaches");
});

test("the two differently-worded ShinyHunters headlines survive as two articles in one Breaches group", () => {
  const hackerNews = article({
    title: "ShinyHunters Claims FBI Breach, Says It Stole Data on Agents and Job Applicants",
    url: "https://thehackernews.test/shinyhunters-fbi-breach",
    source: "The Hacker News",
  });
  const techCrunch = article({
    title: "Hacking group ShinyHunters claims it breached the FBI, stole agents' and applicants' data",
    url: "https://techcrunch.test/shinyhunters-claims-fbi-breach",
    source: "TechCrunch Security",
  });

  const result = composeFrontPage([hackerNews, techCrunch], NOW);

  assert.equal(result.articles.length, 2);
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].section, "Breaches");
  assert.equal(result.sections[0].articles.length, 2);
});

test("an empty input array produces the ok variant with empty articles and empty sections", () => {
  const result = composeFrontPage([], NOW);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.articles, []);
  assert.deepEqual(result.sections, []);
});

test("composeFrontPage stamps generatedAt from the injected now, never from the wall clock", () => {
  const expected = "2026-09-23T12:00:00.000Z";
  assert.equal(composeFrontPage([], NOW).generatedAt, expected);
  const one = article({ url: "https://fixture.test/generated-at" });
  assert.equal(composeFrontPage([one], NOW).generatedAt, expected);
});

test("n distinct stories across three sections produce n articles, groups in SECTION_DISPLAY_ORDER, flat articles equal to the groups flattened", () => {
  const vuln = article({
    title: "New CVE-2026-1234 patched in widely-used library",
    url: "https://a.test/vuln-story",
    source: "Source A",
  });
  const ransomware = article({
    title: "Ransomware gang demands ransom from hospital network",
    url: "https://b.test/ransomware-story",
    source: "Source B",
  });
  const industryPolicy = article({
    title: "Quarterly earnings call discusses cloud growth",
    url: "https://c.test/industry-story",
    source: "Source C",
  });

  const result = composeFrontPage([vuln, ransomware, industryPolicy], NOW);

  assert.equal(result.articles.length, 3);
  assert.deepEqual(
    result.sections.map((g) => g.section),
    ["Vulnerabilities", "Ransomware", "Industry/Policy"],
    "expected sections in SECTION_DISPLAY_ORDER, not input order"
  );

  let lastIndex = -1;
  for (const group of result.sections) {
    const index = SECTION_DISPLAY_ORDER.indexOf(group.section);
    assert.ok(index > lastIndex);
    lastIndex = index;
  }

  assert.deepEqual(
    result.articles,
    result.sections.flatMap((g) => g.articles)
  );
});

test("an article with a CVE ID in its summary gets cves through the composed pipeline and lands in Vulnerabilities", () => {
  const withCve = article({
    title: "Emergency patch released",
    url: "https://d.test/cve-story",
    source: "Source D",
    summary: "Addresses cve-2026-4242 in a widely-used library.",
  });

  const result = composeFrontPage([withCve], NOW);

  assert.equal(result.articles.length, 1);
  assert.deepEqual(result.articles[0].cves, ["CVE-2026-4242"]);
  assert.equal(result.articles[0].section, "Vulnerabilities");
});

test("an article with no CVE ID gets an empty cves array through the composed pipeline", () => {
  const noCve = article({
    title: "Quarterly earnings call discusses cloud growth",
    url: "https://e.test/no-cve-story",
    source: "Source E",
  });

  const result = composeFrontPage([noCve], NOW);

  assert.equal(result.articles.length, 1);
  assert.deepEqual(result.articles[0].cves, []);
});
