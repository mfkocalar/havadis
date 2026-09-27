import { test } from "node:test";
import assert from "node:assert/strict";
import type Parser from "rss-parser";
import { normalize } from "./normalize.ts";
import { SUMMARY_MAX_CHARS } from "./truncateSummary.ts";
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

test("a well-formed item normalizes to an Article with every field populated and the title trimmed", () => {
  const article = normalize(
    item({
      title: "  Microsoft Plugs Nearly 1,000 Security Holes  ",
      link: "https://krebsonsecurity.com/2026/09/microsoft-plugs-nearly-1000-security-holes/",
      isoDate: "2026-09-08T21:44:22.000Z",
      contentSnippet: "Microsoft Corp. today issued updates to plug at least 974 security holes.",
    }),
    source
  );
  assert.deepEqual(article, {
    title: "Microsoft Plugs Nearly 1,000 Security Holes",
    url: "https://krebsonsecurity.com/2026/09/microsoft-plugs-nearly-1000-security-holes/",
    source: "Krebs on Security",
    sourceTier: "Security Research",
    publishedAt: "2026-09-08T21:44:22.000Z",
    summary: "Microsoft Corp. today issued updates to plug at least 974 security holes.",
  });
});

test("title's HTML entities decode exactly once (D-04); non-entity markup stays literal", () => {
  const article = normalize(
    item({ title: "R&amp;D team ships <patch> for CVE-2026-0001" }),
    source
  );
  assert.equal(
    article?.title,
    "R&D team ships <patch> for CVE-2026-0001",
    "normalize decodes the title's HTML entities once per D-04; <patch> is not an entity and stays literal"
  );
});

test("title trademark entity decodes to the trademark sign (closes the STATE.md CrowdStrike blocker)", () => {
  const article = normalize(
    item({ title: "CrowdStrike Falcon&trade; Adds X" }),
    source
  );
  assert.equal(article?.title, "CrowdStrike Falcon™ Adds X");
});

test("title decodes before trimming: a leading/trailing &nbsp; is trimmed away", () => {
  const article = normalize(item({ title: "&nbsp;Headline&nbsp;" }), source);
  assert.equal(article?.title, "Headline");
});

test("returns null when the title is entity-encoded whitespace only", () => {
  assert.equal(normalize(item({ title: "&nbsp;&nbsp;" }), source), null);
});

test("summary is not entity-decoded again: contentSnippet already-decoded text passes through unchanged", () => {
  const article = normalize(item({ contentSnippet: "5 &lt; 6" }), source);
  assert.equal(article?.summary, "5 &lt; 6");
});

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

test("a well-under-cap summary passes through byte-identically (D-08 wiring, non-regression)", () => {
  const shortSnippet = "Microsoft Corp. today issued updates to plug at least 974 security holes.";
  const article = normalize(item({ contentSnippet: shortSnippet }), source);
  assert.equal(article?.summary, shortSnippet);
});

test("an over-cap summary arrives on the Article at no more than SUMMARY_MAX_CHARS code points (D-08 wiring)", () => {
  const longSnippet = "word ".repeat(SUMMARY_MAX_CHARS * 2);
  const article = normalize(item({ contentSnippet: longSnippet }), source);
  assert.ok(article !== null);
  assert.ok(
    Array.from(article!.summary).length <= SUMMARY_MAX_CHARS,
    `expected capped summary, got ${Array.from(article!.summary).length} code points`
  );
});
