import { test } from "node:test";
import assert from "node:assert/strict";
import { SECTION_DISPLAY_ORDER } from "../config/sections.ts";
import { normalizeTitleForDedupe } from "../pipeline/normalizeTitleForDedupe.ts";
import { composeFrontPage } from "../pipeline/getFrontPage.ts";
import { planCveChips } from "../cveChips.ts";
import { fixtureEpssStates, fixtureKevMap, fixtureSsvcState } from "./enrichment.ts";
import {
  FIXTURE_CLUSTER_TITLES,
  FIXTURE_CLUSTER_URLS,
  FIXTURE_EMPTY_SUMMARY_TITLE,
  FIXTURE_LONG_TITLE,
  FIXTURE_MARKER_TITLE,
  FIXTURE_TOKEN,
  FIXTURE_TOKEN_TITLE,
  FIXTURE_TWELVE_CVE_TITLE,
  FIXTURE_UNBROKEN_TITLE,
  fixtureArticles,
} from "./edition.ts";

/**
 * Composition tests for the committed fixture edition (MOB-03, D-03): every
 * adversarial case survives `composeFrontPage` for a fixed clock. Hermetic: no
 * network, no clock read.
 */

const NOW = Date.parse("2099-06-01T12:00:00.000Z");

const page = composeFrontPage(fixtureArticles(NOW), NOW);
const rows = page.articles;
const countBySection = new Map(page.sections.map((g) => [g.section, g.articles.length]));

test("all 7 sections are non-empty, in display order", () => {
  assert.deepEqual(
    page.sections.map((g) => g.section),
    [...SECTION_DISPLAY_ORDER],
  );
});

test("two sections hold 9 or more rows and one holds exactly 8", () => {
  const counts = [...countBySection.values()];
  assert.equal(counts.filter((n) => n >= 9).length, 2, `counts ${counts.join(",")}`);
  assert.equal(counts.filter((n) => n === 8).length, 1, `counts ${counts.join(",")}`);
});

test("all 6 source tiers and all 6 source types appear", () => {
  assert.equal(new Set(rows.map((a) => a.sourceTier)).size, 6);
  assert.equal(new Set(rows.map((a) => a.sourceType)).size, 6);
});

test("critical, high and normal importance all appear", () => {
  assert.deepEqual(new Set(rows.map((a) => a.importance)), new Set(["critical", "high", "normal"]));
});

test("the adversarial strings have the exact lengths", () => {
  assert.equal(FIXTURE_LONG_TITLE.length, 160);
  assert.match(FIXTURE_LONG_TITLE, / /);
  assert.equal(FIXTURE_UNBROKEN_TITLE.length, 160);
  assert.doesNotMatch(FIXTURE_UNBROKEN_TITLE, /\s/);
  assert.equal(FIXTURE_TOKEN.length, 60);
  assert.doesNotMatch(FIXTURE_TOKEN, /\s/);
  assert.ok(FIXTURE_TOKEN_TITLE.includes(FIXTURE_TOKEN));
});

test("every adversarial title is a row of the composed page", () => {
  const titles = new Set(rows.map((a) => a.title));
  for (const title of [
    FIXTURE_MARKER_TITLE,
    FIXTURE_LONG_TITLE,
    FIXTURE_UNBROKEN_TITLE,
    FIXTURE_TOKEN_TITLE,
    FIXTURE_TWELVE_CVE_TITLE,
    FIXTURE_EMPTY_SUMMARY_TITLE,
  ]) {
    assert.ok(titles.has(title), `missing ${title.slice(0, 40)}`);
  }
});

test("the 12-CVE title yields 12 distinct IDs and a chip overflow of 9", () => {
  const row = rows.find((a) => a.title === FIXTURE_TWELVE_CVE_TITLE);
  assert.ok(row);
  assert.equal(new Set(row.cves).size, 12);
  assert.equal(planCveChips(row.cves).overflow, 9);
});

test("one story has an empty summary", () => {
  const row = rows.find((a) => a.title === FIXTURE_EMPTY_SUMMARY_TITLE);
  assert.ok(row);
  assert.equal(row.summary, "");
});

test("the 3-story cluster stays 3 separate rows after dedupe", () => {
  assert.equal(FIXTURE_CLUSTER_TITLES.length, 3);
  assert.equal(new Set(FIXTURE_CLUSTER_TITLES.map(normalizeTitleForDedupe)).size, 3);
  assert.equal(new Set(FIXTURE_CLUSTER_URLS).size, 3);
  for (let i = 0; i < 3; i++) {
    const row = rows.find((a) => a.url === FIXTURE_CLUSTER_URLS[i]);
    assert.ok(row, `cluster url ${i} missing`);
    assert.equal(row.title, FIXTURE_CLUSTER_TITLES[i]);
  }
  assert.equal(new Set(rows.filter((a) => FIXTURE_CLUSTER_URLS.includes(a.url)).map((a) => a.source)).size, 3);
});

test("every fixture title and summary is ASCII-only", () => {
  for (const a of fixtureArticles(NOW)) {
    assert.match(a.title, /^[\x20-\x7E]+$/, a.title);
    assert.match(a.summary, /^[\x20-\x7E]*$/, a.title);
  }
});

test("no title holds an ampersand, angle bracket, double quote or apostrophe", () => {
  for (const a of fixtureArticles(NOW)) {
    assert.doesNotMatch(a.title, /[&<>"']/, a.title);
  }
});

test("CVE coverage matches the fixture enrichment: KEV, SSVC active, SSVC poc, scored and no-row", () => {
  const cves = new Set(rows.flatMap((a) => a.cves));
  const kev = fixtureKevMap(NOW);
  const epss = fixtureEpssStates([...cves]);
  for (const id of ["CVE-2099-10001", "CVE-2099-10003"]) {
    assert.ok(cves.has(id), id);
    assert.ok(Object.hasOwn(kev.entries, id), id);
  }
  assert.ok(cves.has("CVE-2099-10002"));
  assert.equal(fixtureSsvcState("CVE-2099-10002").state, "assessed");
  assert.ok(cves.has("CVE-2099-10004"));
  assert.equal(fixtureSsvcState("CVE-2099-10004").state, "assessed");
  assert.ok(Object.values(epss).some((s) => s.state === "scored"));
  assert.ok(Object.values(epss).some((s) => s.state === "no-row"));
});

test("stories name no real outlet or vendor: fixture.test URLs, CVE IDs in 2099", () => {
  for (const a of fixtureArticles(NOW)) {
    assert.match(a.url, /^https:\/\/[a-z]+\.fixture\.test\//, a.url);
    assert.match(a.source, /^Fixture /, a.source);
    for (const id of `${a.title} ${a.summary}`.match(/CVE-\d{4}-\d+/g) ?? []) {
      assert.match(id, /^CVE-2099-/, id);
    }
  }
});

test("the same clock gives a deep-equal edition", () => {
  assert.deepEqual(composeFrontPage(fixtureArticles(NOW), NOW), composeFrontPage(fixtureArticles(NOW), NOW));
});
