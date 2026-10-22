import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMarks,
  countVisible,
  DEFAULT_PREFS,
  hasArticleFilters,
  isArticleVisible,
  MARK_RETENTION_MS,
  meetsImportance,
  parseMarks,
  parsePrefs,
  toggleMark,
  type ArticleMeta,
} from "./readerState.ts";

/**
 * Unit tests for readerState.ts: storage parsing is defensive (localStorage is
 * user-editable and may hold a stale schema), and visibility combines every
 * filter with AND.
 */

const NOW = 1_800_000_000_000;

test("parsePrefs returns defaults for missing, malformed or non-object input", () => {
  assert.deepEqual(parsePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs("{not json"), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs("42"), DEFAULT_PREFS);
});

test("parsePrefs keeps valid fields and drops unknown sections and values", () => {
  const prefs = parsePrefs(
    JSON.stringify({ sections: ["Breaches", "Nope", "Breaches", 3], minImportance: "critical", unreadOnly: true, flaggedOnly: "yes" }),
  );
  assert.deepEqual(prefs, { sections: ["Breaches"], minImportance: "critical", unreadOnly: true, flaggedOnly: false });
  assert.equal(parsePrefs(JSON.stringify({ minImportance: "urgent" })).minImportance, "all");
});

test("parseMarks drops malformed and expired entries", () => {
  const raw = JSON.stringify({ a: NOW - 1000, b: NOW - MARK_RETENTION_MS, c: "x", d: null });
  assert.deepEqual(parseMarks(raw, NOW), { a: NOW - 1000 });
  assert.deepEqual(parseMarks("[1,2]", NOW), {});
  assert.deepEqual(parseMarks("oops", NOW), {});
});

test("toggleMark adds then removes without mutating its input", () => {
  const empty = {};
  const on = toggleMark(empty, "x", NOW);
  assert.deepEqual(on, { x: NOW });
  assert.deepEqual(empty, {});
  assert.deepEqual(toggleMark(on, "x", NOW), {});
});

test("addMarks keeps existing timestamps", () => {
  assert.deepEqual(addMarks({ a: 1 }, ["a", "b"], NOW), { a: 1, b: NOW });
});

test("meetsImportance orders critical > high > normal", () => {
  assert.equal(meetsImportance("normal", "all"), true);
  assert.equal(meetsImportance("normal", "high"), false);
  assert.equal(meetsImportance("critical", "high"), true);
  assert.equal(meetsImportance("high", "critical"), false);
});

test("visibility ANDs importance, unread-only and flagged-only", () => {
  const a: ArticleMeta = { id: "a", importance: "critical" };
  const prefs = { ...DEFAULT_PREFS, minImportance: "high" as const, unreadOnly: true, flaggedOnly: true };
  assert.equal(isArticleVisible(a, prefs, {}, { a: NOW }), true);
  assert.equal(isArticleVisible(a, prefs, { a: NOW }, { a: NOW }), false, "read is hidden by unread-only");
  assert.equal(isArticleVisible(a, prefs, {}, {}), false, "unflagged is hidden by flagged-only");
  assert.equal(isArticleVisible({ id: "a", importance: "normal" }, prefs, {}, { a: NOW }), false);
});

test("countVisible and hasArticleFilters", () => {
  const list: ArticleMeta[] = [
    { id: "a", importance: "critical" },
    { id: "b", importance: "high" },
    { id: "c", importance: "normal" },
  ];
  assert.equal(countVisible(list, DEFAULT_PREFS, {}, {}), 3);
  assert.equal(countVisible(list, { ...DEFAULT_PREFS, minImportance: "high" }, {}, {}), 2);
  assert.equal(hasArticleFilters(DEFAULT_PREFS), false);
  assert.equal(hasArticleFilters({ ...DEFAULT_PREFS, sections: ["Breaches"] }), false, "sections alone are not article filters");
  assert.equal(hasArticleFilters({ ...DEFAULT_PREFS, unreadOnly: true }), true);
});
