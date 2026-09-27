import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeHtmlEntities } from "./decodeHtmlEntities.ts";

/**
 * Hermetic unit tests for decodeHtmlEntities (D-04). One test() per behavior
 * bullet in 03-02-PLAN.md's Task 1 <behavior> block. No clock, no network —
 * pure string-in/string-out assertions only.
 */

test("decodes a well-known named entity: R&amp;D -> R&D", () => {
  assert.equal(decodeHtmlEntities("R&amp;D"), "R&D");
});

test("decodes the CrowdStrike trademark case: &trade; -> ™ (closes the STATE.md blocker)", () => {
  assert.equal(
    decodeHtmlEntities("CrowdStrike Falcon&trade; Adds X"),
    "CrowdStrike Falcon™ Adds X"
  );
});

test("decodes a decimal numeric entity: &#8217; -> ’", () => {
  assert.equal(decodeHtmlEntities("&#8217;"), "’");
});

test("decodes a lowercase hex numeric entity: &#x2019; -> ’", () => {
  assert.equal(decodeHtmlEntities("&#x2019;"), "’");
});

test("decodes an uppercase hex numeric entity: &#X2019; -> ’", () => {
  assert.equal(decodeHtmlEntities("&#X2019;"), "’");
});

test("decodes &nbsp; to U+00A0 (non-breaking space)", () => {
  assert.equal(decodeHtmlEntities("&nbsp;"), " ");
});

test("leaves an unknown named entity untouched: &foo;", () => {
  assert.equal(decodeHtmlEntities("&foo;"), "&foo;");
});

test("leaves an unterminated entity (no semicolon) untouched: &amp", () => {
  assert.equal(decodeHtmlEntities("&amp"), "&amp");
});

test("leaves a malformed numeric entity untouched: &#12ab;", () => {
  assert.equal(decodeHtmlEntities("&#12ab;"), "&#12ab;");
});

test("leaves the invalid code point &#0; untouched", () => {
  assert.equal(decodeHtmlEntities("&#0;"), "&#0;");
});

test("leaves a surrogate code point &#xD800; untouched", () => {
  assert.equal(decodeHtmlEntities("&#xD800;"), "&#xD800;");
});

test("leaves an out-of-range code point &#1114112; untouched (above 0x10FFFF)", () => {
  assert.equal(decodeHtmlEntities("&#1114112;"), "&#1114112;");
});

test("decodes exactly once: &amp;lt; -> &lt; (never <)", () => {
  assert.equal(decodeHtmlEntities("&amp;lt;"), "&lt;");
});

test("decodes markup-looking entities to plain text characters: &lt;script&gt; -> <script>", () => {
  assert.equal(decodeHtmlEntities("&lt;script&gt;"), "<script>");
});

test("returns the empty string unchanged", () => {
  assert.equal(decodeHtmlEntities(""), "");
});

test("a 200,000-character input of repeated &#1 completes in under 500ms (T-03-09, linear scan)", () => {
  const input = "&#1".repeat(200_000 / 3);
  const start = performance.now();
  decodeHtmlEntities(input);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 500, `expected under 500ms, took ${elapsed}ms`);
});
