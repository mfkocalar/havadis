import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCves } from "./extractCves.ts";

/**
 * Hermetic fixture tests for `extractCves` (D-13). Never reads the clock or
 * calls fetch — every case is a fixed string in, a fixed array out.
 */

test("no ID in title or summary returns an empty array", () => {
  assert.deepEqual(
    extractCves({ title: "A perfectly normal headline", summary: "Nothing to see here." }),
    []
  );
});

test("an ID only in the title is found", () => {
  assert.deepEqual(
    extractCves({ title: "Fix for CVE-2026-1234 ships today", summary: "No identifiers here." }),
    ["CVE-2026-1234"]
  );
});

test("an ID only in the summary is found", () => {
  assert.deepEqual(
    extractCves({ title: "A patch ships today", summary: "Addresses CVE-2026-5678 directly." }),
    ["CVE-2026-5678"]
  );
});

test("lowercase input comes back uppercase", () => {
  assert.deepEqual(
    extractCves({ title: "fix for cve-2026-1234", summary: "" }),
    ["CVE-2026-1234"]
  );
});

test("the live WordPress-style pattern: the same ID appearing twice in one field collapses to one entry", () => {
  const title =
    "WordPress 7.1.2 fixes critical unauthenticated path traversal vulnerability (CVE-2026-87902), tracked as CVE-2026-87902";
  assert.deepEqual(extractCves({ title, summary: "" }), ["CVE-2026-87902"]);
});

test("title IDs precede summary IDs, and within a field, left-to-right order is preserved", () => {
  const result = extractCves({
    title: "CVE-2026-0002 patched after CVE-2026-0001 disclosed",
    summary: "Also relevant: CVE-2026-0003 and CVE-2026-0004.",
  });
  assert.deepEqual(result, ["CVE-2026-0002", "CVE-2026-0001", "CVE-2026-0003", "CVE-2026-0004"]);
});

test("4-digit and 7-digit sequence numbers both match", () => {
  assert.deepEqual(
    extractCves({ title: "CVE-2026-1234 and CVE-2026-1234567", summary: "" }),
    ["CVE-2026-1234", "CVE-2026-1234567"]
  );
});

test("a 3-digit sequence number does not match", () => {
  assert.deepEqual(extractCves({ title: "CVE-2026-123 is not a valid ID shape", summary: "" }), []);
});

test("an 8+-digit sequence number is rejected outright, not truncated into a wrong-but-valid-looking ID (WR-02)", () => {
  assert.deepEqual(
    extractCves({ title: "CVE-2026-123456789 is not a valid ID shape", summary: "" }),
    [],
    "must not silently truncate to CVE-2026-1234567"
  );
});

test("a 2-digit year does not match", () => {
  assert.deepEqual(extractCves({ title: "CVE-26-1234 is not a valid ID shape", summary: "" }), []);
});

test("adjacent hostile text after a valid ID (path traversal) yields exactly the valid ID", () => {
  assert.deepEqual(
    extractCves({ title: "See CVE-2026-1234/../../evil for details", summary: "" }),
    ["CVE-2026-1234"]
  );
});

test('adjacent hostile text after a valid ID (attribute injection) yields exactly the valid ID', () => {
  assert.deepEqual(
    extractCves({ title: 'CVE-2026-1234"onmouseover=alert(1)', summary: "" }),
    ["CVE-2026-1234"]
  );
});

test("a match can never span the title/summary boundary", () => {
  assert.deepEqual(extractCves({ title: "Advisory references CVE-2026-", summary: "1234 is the ID" }), []);
});

test("two consecutive calls on the same input return equal results (shared global-regex lastIndex is safe)", () => {
  const input = { title: "CVE-2026-1111 and CVE-2026-2222", summary: "CVE-2026-3333" };
  const first = extractCves(input);
  const second = extractCves(input);
  assert.deepEqual(first, second);
});

test("a 200,000-character input completes in under 500ms", () => {
  const filler = "x".repeat(100_000);
  const title = `${filler}CVE-2026-9999`;
  const start = performance.now();
  const result = extractCves({ title, summary: filler });
  const elapsedMs = performance.now() - start;
  assert.deepEqual(result, ["CVE-2026-9999"]);
  assert.ok(elapsedMs < 500, `expected extraction to finish in under 500ms, took ${elapsedMs}ms`);
});
