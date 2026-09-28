import { test } from "node:test";
import assert from "node:assert/strict";
import { NVD_CVE_DETAIL_BASE, nvdUrl, planCveChips } from "./cveChips.ts";

/**
 * Hermetic fixture tests for the chip cap and link-integrity model (D-13,
 * D-14). Never reads the clock or calls fetch.
 */

test("planCveChips: 0 IDs yields no visible chips and overflow 0", () => {
  const plan = planCveChips([]);
  assert.deepEqual(plan.visible, []);
  assert.equal(plan.overflow, 0);
});

test("planCveChips: exactly 3 IDs yields 3 visible chips and overflow 0 (no +N chip)", () => {
  const plan = planCveChips(["CVE-2026-0001", "CVE-2026-0002", "CVE-2026-0003"]);
  assert.equal(plan.visible.length, 3);
  assert.equal(plan.overflow, 0);
});

test("planCveChips: 4 IDs yields 3 visible chips and overflow 1", () => {
  const plan = planCveChips(["CVE-2026-0001", "CVE-2026-0002", "CVE-2026-0003", "CVE-2026-0004"]);
  assert.equal(plan.visible.length, 3);
  assert.equal(plan.overflow, 1);
});

test("planCveChips: 10 IDs yields 3 visible chips and overflow 7", () => {
  const ids = Array.from({ length: 10 }, (_, i) => `CVE-2026-${String(i).padStart(4, "0")}`);
  const plan = planCveChips(ids);
  assert.equal(plan.visible.length, 3);
  assert.equal(plan.overflow, 7);
});

test("nvdUrl: a valid ID returns exactly NVD_CVE_DETAIL_BASE + id", () => {
  assert.equal(nvdUrl("CVE-2026-1234"), `${NVD_CVE_DETAIL_BASE}CVE-2026-1234`);
});

test("nvdUrl: a lowercase ID returns null", () => {
  assert.equal(nvdUrl("cve-2026-1234"), null);
});

test("nvdUrl: an ID with trailing text returns null", () => {
  assert.equal(nvdUrl("CVE-2026-1234/../../evil"), null);
});

test('nvdUrl: a "javascript:" string returns null', () => {
  assert.equal(nvdUrl("javascript:alert(1)"), null);
});

test("nvdUrl: a path-traversal string returns null", () => {
  assert.equal(nvdUrl("../../etc/passwd"), null);
});

test("nvdUrl: an empty string returns null", () => {
  assert.equal(nvdUrl(""), null);
});

test("planCveChips drops invalid IDs entirely and counts overflow among valid IDs only", () => {
  const plan = planCveChips([
    "CVE-2026-0001",
    "not-a-cve",
    "CVE-2026-0002",
    "javascript:alert(1)",
    "CVE-2026-0003",
    "CVE-2026-0004",
  ]);
  assert.equal(plan.visible.length, 3);
  assert.deepEqual(
    plan.visible.map((c) => c.id),
    ["CVE-2026-0001", "CVE-2026-0002", "CVE-2026-0003"]
  );
  assert.equal(plan.overflow, 1, "only the one remaining valid ID (CVE-2026-0004) should count");
});

test("every visible href starts with the fixed NVD detail base plus CVE-", () => {
  const plan = planCveChips(["CVE-2026-0001", "CVE-2026-0002", "CVE-2026-0003", "CVE-2026-0004"]);
  for (const chip of plan.visible) {
    assert.ok(chip.href.startsWith("https://nvd.nist.gov/vuln/detail/CVE-"));
  }
});
