import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTitleForDedupe } from "./normalizeTitleForDedupe.ts";

/**
 * Hermetic edge-case tests pinning normalizeTitleForDedupe's title
 * comparison-key construction (D-01, D-04). One test() per behavior
 * bullet in 03-02-PLAN.md's Task 3 <behavior> block. No clock, no network.
 */

test("punctuation and extra whitespace collapse to the same key", () => {
  assert.equal(normalizeTitleForDedupe("Foo: Bar!!  Baz"), normalizeTitleForDedupe("foo bar baz"));
});

test("fullwidth characters NFKC-normalize to their ASCII equivalents", () => {
  assert.equal(normalizeTitleForDedupe("ＣＶＥ ｆｉｘ"), "cve fix");
});

test("the fi ligature NFKC-normalizes to plain 'fi'", () => {
  assert.equal(normalizeTitleForDedupe("ﬁle"), "file");
});

test("a curly apostrophe compares equal to a straight one", () => {
  assert.equal(normalizeTitleForDedupe("Foo’s"), normalizeTitleForDedupe("Foo's"));
});

test("a non-breaking space compares equal to a regular space", () => {
  assert.equal(normalizeTitleForDedupe(`a${" "}b`), normalizeTitleForDedupe("a b"));
});

test("does not decode entities a second time: R&amp;D key includes the literal 'amp' text (D-04)", () => {
  assert.equal(normalizeTitleForDedupe("R&amp;D"), "r amp d");
});

test("an emoji-only title normalizes to the empty string", () => {
  assert.equal(normalizeTitleForDedupe("\u{1F525}\u{1F525}"), "");
});

test("a non-ASCII Latin title (Miljodata with an o-with-diaeresis) is lowercased but not stripped", () => {
  assert.equal(normalizeTitleForDedupe("Miljödata"), "miljödata");
});

test("the two differently-worded ShinyHunters headlines produce different keys", () => {
  const a = normalizeTitleForDedupe(
    "ShinyHunters Claims FBI Breach, Says It Stole Data on Agents and Job Applicants"
  );
  const b = normalizeTitleForDedupe(
    "Hacking group ShinyHunters claims it breached the FBI, stole agents' and applicants' data"
  );
  assert.notEqual(a, b);
});
