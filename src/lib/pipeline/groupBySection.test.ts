import { test } from "node:test";
import assert from "node:assert/strict";
import { groupBySection } from "./groupBySection.ts";
import { rankWithinSection } from "./rank.ts";
import { SECTION_DISPLAY_ORDER } from "../config/sections.ts";
import type { Article, Section, SourceTier } from "../types.ts";

/**
 * Hermetic unit tests for groupBySection.ts (CLASSIFY-03, D-12, D-16).
 * Fixtures are typed `Article & { section: Section }` — not
 * `ClassifiedArticle` — so Plan 03-03's added `cves` field on
 * `ClassifiedArticle` never breaks this file; `groupBySection`'s generic
 * parameter accepts either shape. A fixed `NOW` constant stands in for the
 * wall clock; `groupBySection` never reads the clock itself (D-09).
 */

const NOW = Date.parse("2026-09-23T12:00:00.000Z");

let urlCounter = 0;
function article(
  title: string,
  section: Section,
  sourceTier: SourceTier,
  publishedAt: string
): Article & { section: Section } {
  urlCounter += 1;
  return {
    title,
    url: `urn:test:${urlCounter}`,
    source: "Test Source",
    sourceTier,
    publishedAt,
    summary: "",
    section,
  };
}

function hoursAgo(hours: number): string {
  return new Date(NOW - hours * 3_600_000).toISOString();
}

test("groups follow SECTION_DISPLAY_ORDER regardless of input order", () => {
  const industry = article("Industry item", "Industry/Policy", "Tech & General", hoursAgo(1));
  const vuln = article("Vuln item", "Vulnerabilities", "Government", hoursAgo(1));
  const breach = article("Breach item", "Breaches", "Government", hoursAgo(1));
  // Deliberately fed in reverse-of-display order.
  const result = groupBySection([industry, breach, vuln], NOW);
  assert.deepEqual(
    result.map((g) => g.section),
    ["Vulnerabilities", "Breaches", "Industry/Policy"]
  );
});

test("empty sections are omitted entirely", () => {
  const only = article("Ransomware item", "Ransomware", "Government", hoursAgo(1));
  const result = groupBySection([only], NOW);
  assert.deepEqual(result.map((g) => g.section), ["Ransomware"]);
  assert.equal(result.length, 1);
});

test("an empty article list yields an empty group list", () => {
  assert.deepEqual(groupBySection([], NOW), []);
});

test("a single article yields exactly one group holding that article", () => {
  const only = article("Solo", "Advisories", "Enterprise Security", hoursAgo(1));
  const result = groupBySection([only], NOW);
  assert.deepEqual(result, [{ section: "Advisories", articles: [only] }]);
});

test("every input article appears exactly once, in the group matching its own section", () => {
  const a = article("A", "Vulnerabilities", "Government", hoursAgo(1));
  const b = article("B", "Breaches", "Government", hoursAgo(2));
  const c = article("C", "Vulnerabilities", "Tech & General", hoursAgo(3));
  const result = groupBySection([a, b, c], NOW);

  const seen = new Map<string, Section>();
  for (const group of result) {
    for (const item of group.articles) {
      assert.equal(
        item.section,
        group.section,
        `expected ${item.title} to sit in its own section's group`
      );
      assert.ok(!seen.has(item.url), `expected ${item.title} to appear in exactly one group`);
      seen.set(item.url, group.section);
    }
  }
  assert.equal(seen.size, 3);
});

test("within a group the order equals rankWithinSection(bucket, NOW) — a Government 3h-old item precedes a Tech & General 5-minute-old item", () => {
  const gov = article("Gov 3h", "Vulnerabilities", "Government", hoursAgo(3));
  const tech = article("Tech 5m", "Vulnerabilities", "Tech & General", hoursAgo(5 / 60));
  const result = groupBySection([tech, gov], NOW);
  assert.equal(result.length, 1);
  assert.deepEqual(
    result[0].articles,
    rankWithinSection([tech, gov], NOW),
    "expected groupBySection's within-section order to equal rankWithinSection's own output"
  );
  assert.deepEqual(result[0].articles.map((a) => a.title), ["Gov 3h", "Tech 5m"]);
});

test("groupBySection never mutates its input array", () => {
  const a = article("A", "Vulnerabilities", "Government", hoursAgo(1));
  const b = article("B", "Vulnerabilities", "Tech & General", hoursAgo(2));
  const input = [a, b];
  const inputCopy = [...input];
  groupBySection(input, NOW);
  assert.deepEqual(input, inputCopy, "expected the input array's contents to be unchanged");
});

test("every emitted section is a member of SECTION_DISPLAY_ORDER", () => {
  const a = article("A", "Tools/Techniques", "Tech & General", hoursAgo(1));
  const result = groupBySection([a], NOW);
  for (const group of result) {
    assert.ok(SECTION_DISPLAY_ORDER.includes(group.section));
  }
});
