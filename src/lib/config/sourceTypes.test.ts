import { test } from "node:test";
import assert from "node:assert/strict";
import { LOOKBACK_HOURS, SOURCE_TYPES, SOURCE_TYPE_LABEL } from "./sourceTypes.ts";

/**
 * Hermetic property tests for the source-type maps (Phase 7.1 D-02, D-03,
 * UI-SPEC Test and Gate Contract 2). Pure static data, no network.
 */

test("SOURCE_TYPE_LABEL keys equal SOURCE_TYPES, in order", () => {
  assert.deepEqual(Object.keys(SOURCE_TYPE_LABEL), [...SOURCE_TYPES]);
});

test("LOOKBACK_HOURS keys equal SOURCE_TYPES as a set", () => {
  assert.deepEqual(Object.keys(LOOKBACK_HOURS).sort(), [...SOURCE_TYPES].sort());
});

test("SOURCE_TYPE_LABEL.advisory is Advisory (D-02)", () => {
  assert.equal(SOURCE_TYPE_LABEL.advisory, "Advisory");
});

test("every label is a single word, labels are distinct, and the longest is at most 10 characters", () => {
  const labels = Object.values(SOURCE_TYPE_LABEL);
  for (const label of labels) {
    assert.ok(label.length > 0, "label must not be empty");
    assert.ok(!/\s/.test(label), `label "${label}" must contain no whitespace`);
    assert.ok(label.length <= 10, `label "${label}" must be at most 10 characters`);
  }
  assert.equal(new Set(labels).size, labels.length, "labels must be distinct");
});

test("LOOKBACK_HOURS.advisory is 72 and every lookback is a positive integer (D-03)", () => {
  assert.equal(LOOKBACK_HOURS.advisory, 72);
  for (const [type, hours] of Object.entries(LOOKBACK_HOURS)) {
    assert.ok(Number.isInteger(hours) && hours > 0, `${type}: lookback must be a positive integer`);
  }
});
