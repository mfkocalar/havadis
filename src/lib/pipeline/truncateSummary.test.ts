import { test } from "node:test";
import assert from "node:assert/strict";
import { truncateSummary, SUMMARY_MAX_CHARS } from "./truncateSummary.ts";

/**
 * Hermetic unit proof for truncateSummary.ts (D-08): the cap invariant,
 * word-boundary cut, idempotency, and surrogate-pair safety. Over-cap
 * fixtures are built from SUMMARY_MAX_CHARS arithmetic rather than
 * hard-coded literal lengths, so the suite keeps proving the invariant if
 * the constant is ever retuned.
 */

test("input at or below the cap is returned unchanged, with no marker appended", () => {
  const atCap = "a".repeat(SUMMARY_MAX_CHARS);
  assert.equal(truncateSummary(atCap), atCap);

  const belowCap = "The quick brown fox jumps over the lazy dog.";
  assert.equal(truncateSummary(belowCap), belowCap);
});

test("the empty string returns the empty string", () => {
  assert.equal(truncateSummary(""), "");
});

test("input longer than the cap returns at most SUMMARY_MAX_CHARS code points, ending in the ellipsis marker", () => {
  const longProse = ("word ".repeat(SUMMARY_MAX_CHARS)).trim(); // far longer than the cap
  const result = truncateSummary(longProse);
  const resultCodePoints = Array.from(result);
  assert.ok(
    resultCodePoints.length <= SUMMARY_MAX_CHARS,
    `expected at most ${SUMMARY_MAX_CHARS} code points, got ${resultCodePoints.length}`
  );
  assert.equal(resultCodePoints.at(-1), "…", "result must end in the horizontal ellipsis");
});

test("a long prose input cuts on a whitespace boundary: the result minus its marker is a prefix of the input", () => {
  const longProse = "The quick brown fox jumps over the lazy dog. ".repeat(20);
  const result = truncateSummary(longProse);
  const withoutMarker = result.slice(0, -1);
  assert.ok(
    longProse.startsWith(withoutMarker),
    "the text before the marker must be an exact prefix of the input (word-boundary cut, not a mid-word cut)"
  );
  assert.notEqual(withoutMarker.at(-1), " ", "the cut must not leave trailing whitespace before the marker");
});

test("a single unbroken token longer than the cap still returns at most the cap, ending in the marker", () => {
  const unbrokenToken = "x".repeat(SUMMARY_MAX_CHARS * 2);
  const result = truncateSummary(unbrokenToken);
  const resultCodePoints = Array.from(result);
  assert.ok(resultCodePoints.length <= SUMMARY_MAX_CHARS);
  assert.equal(resultCodePoints.at(-1), "…");
});

test("an astral-plane input longer than the cap returns a well-formed string with no lone surrogate", () => {
  const emoji = "\u{1F512}"; // U+1F512 LOCK, a surrogate pair in UTF-16
  const longEmoji = emoji.repeat(SUMMARY_MAX_CHARS);
  const result = truncateSummary(longEmoji);
  assert.ok(result.isWellFormed(), "result must be a well-formed string (no split surrogate pair)");
  assert.ok(Array.from(result).length <= SUMMARY_MAX_CHARS);
});

test("the function is idempotent — applying it to its own output returns that output unchanged", () => {
  const longProse = "The quick brown fox jumps over the lazy dog. ".repeat(30);
  const once = truncateSummary(longProse);
  const twice = truncateSummary(once);
  assert.equal(twice, once);
});

test("a cut landing immediately after a comma, semicolon, or colon drops that punctuation before the marker", () => {
  const prefix = "a".repeat(SUMMARY_MAX_CHARS - 2);
  const withComma = `${prefix}, more text that pushes this well past the cap boundary`;
  const result = truncateSummary(withComma);
  const withoutMarker = result.slice(0, -1);
  assert.notEqual(withoutMarker.at(-1), ",", "trailing comma must be dropped before the ellipsis");
  assert.notEqual(withoutMarker.at(-1), ";", "trailing semicolon must be dropped before the ellipsis");
  assert.notEqual(withoutMarker.at(-1), ":", "trailing colon must be dropped before the ellipsis");
});
