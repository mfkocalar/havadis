import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toggleSection,
  isSectionVisible,
  filterStatusMessage,
  articleCountLabel,
} from "./sectionFilter.ts";
import type { Section } from "./types.ts";

/**
 * Unit tests for sectionFilter.ts (FILTER-01, D-09): the visibility rule
 * ("nothing selected means no filter"), set-toggle immutability, and the
 * exact screen-reader copy from the UI-SPEC Copywriting Contract. Pure and
 * hermetic: no clock, no network.
 */

const ALL_SECTIONS: readonly Section[] = [
  "Vulnerabilities",
  "Advisories",
  "Ransomware",
  "Breaches",
  "Threat Intelligence",
  "Tools/Techniques",
  "Industry/Policy",
];

test("isSectionVisible shows every section when nothing is selected (D-09)", () => {
  const selected = new Set<Section>();
  for (const section of ALL_SECTIONS) {
    assert.equal(isSectionVisible(selected, section), true, `${section} should be visible`);
  }
});

test("isSectionVisible shows only the selected section when one is selected", () => {
  const selected = new Set<Section>(["Ransomware"]);
  assert.equal(isSectionVisible(selected, "Ransomware"), true);
  assert.equal(isSectionVisible(selected, "Breaches"), false);
});

test("isSectionVisible shows every selected section when several are selected", () => {
  const selected = new Set<Section>(["Advisories", "Breaches"]);
  assert.equal(isSectionVisible(selected, "Advisories"), true);
  assert.equal(isSectionVisible(selected, "Breaches"), true);
  assert.equal(isSectionVisible(selected, "Vulnerabilities"), false);
});

test("toggleSection adds an absent section to a new set", () => {
  const next = toggleSection(new Set<Section>(), "Breaches");
  assert.deepEqual([...next], ["Breaches"]);
});

test("toggleSection removes a present section from a new set", () => {
  const next = toggleSection(new Set<Section>(["Breaches", "Ransomware"]), "Breaches");
  assert.deepEqual([...next], ["Ransomware"]);
});

test("toggleSection leaves the input set unchanged and returns a different instance", () => {
  const input = new Set<Section>(["Advisories"]);
  const added = toggleSection(input, "Ransomware");
  const removed = toggleSection(input, "Advisories");
  assert.equal(input.size, 1);
  assert.ok(input.has("Advisories"));
  assert.notEqual(added, input);
  assert.notEqual(removed, input);
});

test("toggleSection twice on the same section returns a set equal to the original", () => {
  const original = new Set<Section>(["Advisories", "Breaches"]);
  const roundTrip = toggleSection(toggleSection(original, "Ransomware"), "Ransomware");
  assert.deepEqual([...roundTrip].sort(), [...original].sort());
});

test("filterStatusMessage says 'Showing all N sections' when nothing is selected", () => {
  assert.equal(filterStatusMessage(0, 7), "Showing all 7 sections");
});

test("filterStatusMessage says 'Showing k of n sections' when some are selected", () => {
  assert.equal(filterStatusMessage(2, 7), "Showing 2 of 7 sections");
});

test("filterStatusMessage uses the singular noun when there is exactly one section", () => {
  assert.equal(filterStatusMessage(0, 1), "Showing all 1 section");
  assert.equal(filterStatusMessage(1, 1), "Showing 1 of 1 section");
});

test("articleCountLabel is singular for exactly one article", () => {
  assert.equal(articleCountLabel(1), ", 1 article");
});

test("articleCountLabel is plural for many and for zero", () => {
  assert.equal(articleCountLabel(12), ", 12 articles");
  assert.equal(articleCountLabel(0), ", 0 articles");
});
