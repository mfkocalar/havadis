import { test } from "node:test";
import assert from "node:assert/strict";
import { isTypingTarget, stepIndex, triageActionForKey, type KeyLike } from "./triageKeys.ts";

/**
 * Unit tests for triageKeys.ts: the j / k / f / r mapping, the cases that must
 * stay with the browser (modifiers, text fields, auto-repeat on toggles), and
 * the clamped step between visible stories.
 */

const press = (key: string, extra: Partial<KeyLike> = {}): KeyLike => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...extra,
});

const BODY = { tagName: "BODY" };

test("j, k, f and r map to next, prev, flag and read", () => {
  assert.equal(triageActionForKey(press("j"), BODY), "next");
  assert.equal(triageActionForKey(press("k"), BODY), "prev");
  assert.equal(triageActionForKey(press("f"), BODY), "flag");
  assert.equal(triageActionForKey(press("r"), BODY), "read");
});

test("other keys are not shortcuts", () => {
  for (const key of ["a", "J", "Enter", " ", "ArrowDown", "Escape"]) {
    assert.equal(triageActionForKey(press(key), BODY), null, key);
  }
});

test("any modifier leaves the browser's own shortcut alone", () => {
  for (const mod of ["metaKey", "ctrlKey", "altKey", "shiftKey"] as const) {
    assert.equal(triageActionForKey(press("r", { [mod]: true }), BODY), null, mod);
  }
});

test("key presses inside text fields are never shortcuts", () => {
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "input"]) {
    assert.equal(triageActionForKey(press("j"), { tagName }), null, tagName);
  }
  assert.equal(triageActionForKey(press("f"), { tagName: "DIV", isContentEditable: true }), null);
  assert.equal(isTypingTarget(null), false);
  assert.equal(isTypingTarget({ tagName: "A" }), false);
  assert.equal(isTypingTarget({ tagName: "BUTTON" }), false);
});

test("auto-repeat moves but never toggles a mark", () => {
  assert.equal(triageActionForKey(press("j", { repeat: true }), BODY), "next");
  assert.equal(triageActionForKey(press("k", { repeat: true }), BODY), "prev");
  assert.equal(triageActionForKey(press("f", { repeat: true }), BODY), null);
  assert.equal(triageActionForKey(press("r", { repeat: true }), BODY), null);
});

test("stepIndex starts at the first or last story when none is focused", () => {
  assert.equal(stepIndex(-1, 5, "next"), 0);
  assert.equal(stepIndex(-1, 5, "prev"), 4);
});

test("stepIndex moves by one and stops at both ends", () => {
  assert.equal(stepIndex(2, 5, "next"), 3);
  assert.equal(stepIndex(2, 5, "prev"), 1);
  assert.equal(stepIndex(4, 5, "next"), 4);
  assert.equal(stepIndex(0, 5, "prev"), 0);
});

test("stepIndex has nowhere to go when no story is visible", () => {
  assert.equal(stepIndex(-1, 0, "next"), -1);
  assert.equal(stepIndex(3, 0, "prev"), -1);
});
