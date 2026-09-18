import { test } from "node:test";
import assert from "node:assert/strict";
import type Parser from "rss-parser";
import { normalize } from "./normalize.ts";
import type { SourceConfig } from "../types.ts";

/**
 * Unit tests for normalize.ts's edge cases (NORM-01 adjacency/empty/ordering
 * edges, owned by this plan per 01-01-PLAN.md's Edge Coverage Resolution
 * table). The live e2e test only exercises the well-formed, populated
 * path against the real feed — these prove the defensive guards.
 */

const source: SourceConfig = {
  id: "krebs",
  name: "Krebs on Security",
  tier: "Security Research",
  url: "https://krebsonsecurity.com/feed/",
};

function item(overrides: Partial<Parser.Item>): Parser.Item {
  return {
    title: "A headline",
    link: "https://krebsonsecurity.com/2026/01/a-headline/",
    isoDate: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("returns null when title is missing", () => {
  assert.equal(normalize(item({ title: undefined }), source), null);
});

test("returns null when link is missing", () => {
  assert.equal(normalize(item({ link: undefined }), source), null);
});

test("returns null when isoDate is missing", () => {
  assert.equal(normalize(item({ isoDate: undefined }), source), null);
});

test("returns null when link protocol is neither http nor https", () => {
  assert.equal(
    normalize(item({ link: "javascript:alert(1)" }), source),
    null,
    "a non-http(s) scheme must never reach the Article shape"
  );
});

test("returns null when link does not parse as a URL at all", () => {
  assert.equal(normalize(item({ link: "not a url" }), source), null);
});

test("accepts a plain http:// link (not just https://)", () => {
  const article = normalize(
    item({ link: "http://krebsonsecurity.com/2026/01/a-headline/" }),
    source
  );
  assert.notEqual(article, null);
});

test("falls back to an empty string summary when no description/content is present", () => {
  const article = normalize(
    item({ contentSnippet: undefined, content: undefined }),
    source
  );
  assert.notEqual(article, null);
  assert.equal(article?.summary, "");
});

test("carries the source name and tier onto the normalized article", () => {
  const article = normalize(item({}), source);
  assert.equal(article?.source, "Krebs on Security");
  assert.equal(article?.sourceTier, "Security Research");
});

test("two items with identical title and link both normalize successfully (no dedupe here)", () => {
  const a = normalize(item({}), source);
  const b = normalize(item({}), source);
  assert.notEqual(a, null);
  assert.notEqual(b, null);
  assert.deepEqual(a, b, "identical inputs normalize identically; merging is NORM-02, not this phase");
});

test("normalize preserves feed order when mapped over an array (no reordering)", () => {
  const items = [
    item({ title: "First", isoDate: "2026-01-03T00:00:00.000Z" }),
    item({ title: "Second", isoDate: "2026-01-01T00:00:00.000Z" }),
    item({ title: "Third", isoDate: "2026-01-02T00:00:00.000Z" }),
  ];
  const titles = items.map((it) => normalize(it, source)?.title);
  assert.deepEqual(titles, ["First", "Second", "Third"]);
});
