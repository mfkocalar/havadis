import { test } from "node:test";
import assert from "node:assert/strict";
import { NVD_CVE_DETAIL_BASE, formatEpss, nvdUrl, planCveChips } from "./cveChips.ts";
import type { CveEnrichment, EpssState, KevState } from "./types.ts";

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

test("formatEpss: below 0.01 reads <0.01 and never 0.00 (D-05)", () => {
  assert.equal(formatEpss(0), "<0.01");
  assert.equal(formatEpss(0.0099), "<0.01");
  assert.equal(formatEpss(0.004), "<0.01");
});

test("formatEpss: two decimals from 0.01 up, 1.00 at the top", () => {
  assert.equal(formatEpss(0.01), "0.01");
  assert.equal(formatEpss(0.91), "0.91");
  assert.equal(formatEpss(0.999), "1.00");
  assert.equal(formatEpss(1), "1.00");
  for (const score of [0, 0.0001, 0.0099, 0.01, 0.5, 1]) {
    assert.notEqual(formatEpss(score), "0.00");
    assert.ok(!formatEpss(score).includes("%"));
  }
});

/** Enrichment literal builders for the D-03 ordering tests. */
const kevOf = (added: string): KevState => ({ state: "listed", added, due: "2026-12-01", ransomware: false });
const scored = (score: number): EpssState => ({ state: "scored", score, date: "2026-10-16" });
const enr = (kev: KevState, epss: EpssState): CveEnrichment => ({ kev, epss });
const NOT_LISTED: KevState = { state: "not-listed" };
const UNAVAILABLE = { state: "unavailable" } as const;
const A = "CVE-2026-0001";
const B = "CVE-2026-0002";
const C = "CVE-2026-0003";
const D = "CVE-2026-0004";
const ids = (plan: ReturnType<typeof planCveChips>) => plan.visible.map((c) => c.id);

test("planCveChips: a KEV-listed fourth CVE moves to the front and overflow stays 1 (D-03)", () => {
  const plan = planCveChips([A, B, C, D], { [D]: enr(kevOf("2026-10-01"), UNAVAILABLE) });
  assert.deepEqual(ids(plan), [D, A, B]);
  assert.equal(plan.overflow, 1);
});

test("planCveChips: KEV-listed CVEs come out newest added first (D-03)", () => {
  const plan = planCveChips([A, B, C], {
    [A]: enr(kevOf("2026-09-01"), UNAVAILABLE),
    [B]: enr(kevOf("2026-10-03"), UNAVAILABLE),
    [C]: enr(kevOf("2026-09-20"), UNAVAILABLE),
  });
  assert.deepEqual(plan.visible.map((c) => c.kev?.added), ["2026-10-03", "2026-09-20", "2026-09-01"]);
  assert.deepEqual(ids(plan), [B, C, A]);
});

test("planCveChips: same added date, the higher EPSS score first (A4), then extraction order", () => {
  const byScore = planCveChips([A, B], {
    [A]: enr(kevOf("2026-10-03"), scored(0.2)),
    [B]: enr(kevOf("2026-10-03"), scored(0.8)),
  });
  assert.deepEqual(ids(byScore), [B, A]);
  const equal = planCveChips([A, B], {
    [A]: enr(kevOf("2026-10-03"), scored(0.4)),
    [B]: enr(kevOf("2026-10-03"), scored(0.4)),
  });
  assert.deepEqual(ids(equal), [A, B]);
  const scoredBeatsUnscored = planCveChips([A, B], {
    [A]: enr(kevOf("2026-10-03"), UNAVAILABLE),
    [B]: enr(kevOf("2026-10-03"), scored(0.01)),
  });
  assert.deepEqual(ids(scoredBeatsUnscored), [B, A]);
});

test("planCveChips: a newer KEV date beats a higher EPSS score on an older one", () => {
  const plan = planCveChips([A, B], {
    [A]: enr(kevOf("2026-09-01"), scored(0.99)),
    [B]: enr(kevOf("2026-10-03"), scored(0.01)),
  });
  assert.deepEqual(ids(plan), [B, A]);
});

test("planCveChips: non-KEV scores descend, unscored last in extraction order (D-03)", () => {
  const plan = planCveChips([A, B, C, D], {
    [A]: enr(NOT_LISTED, scored(0.05)),
    [B]: enr(NOT_LISTED, scored(0.91)),
    [D]: enr(NOT_LISTED, { state: "no-row" }),
  });
  assert.deepEqual(ids(plan), [B, A, C]);
  assert.equal(plan.overflow, 1);
  const rest = planCveChips([A, B, C, D], {});
  assert.deepEqual(ids(rest), [A, B, C]);
});

test("planCveChips: a KEV-listed CVE is never behind +N while a plain CVE is visible", () => {
  const many = Array.from({ length: 8 }, (_, i) => `CVE-2026-${String(i + 10).padStart(4, "0")}`);
  const last = many[many.length - 1];
  const plan = planCveChips(many, { [last]: enr(kevOf("2026-01-01"), UNAVAILABLE) });
  assert.equal(plan.visible[0].id, last);
  assert.equal(plan.overflow, 5);
});

test("planCveChips: chips that tie on every signal keep extraction order (explicit index tie-break)", () => {
  const same = Array.from({ length: 12 }, (_, i) => `CVE-2026-${String(i + 100).padStart(4, "0")}`);
  const byCve = Object.fromEntries(same.map((id) => [id, enr(kevOf("2026-10-01"), scored(0.5))]));
  const plan = planCveChips(same, byCve);
  assert.deepEqual(ids(plan), same.slice(0, 3));
});

test("planCveChips: epss and kev fields follow the enrichment state", () => {
  const plan = planCveChips([A, B, C], {
    [A]: enr(NOT_LISTED, { state: "no-row" }),
    [B]: enr(UNAVAILABLE, UNAVAILABLE),
    [C]: enr(kevOf("2026-10-01"), scored(0.5)),
  });
  const by = new Map(plan.visible.map((c) => [c.id, c]));
  assert.deepEqual(by.get(C)?.kev, { added: "2026-10-01" });
  assert.deepEqual(by.get(A)?.epss, { kind: "none-yet" });
  assert.equal(by.get(A)?.kev, null);
  assert.equal(by.get(B)?.epss, null);
  assert.equal(by.get(B)?.kev, null);
});

test("planCveChips: the CVE with no enrichment entry has null kev and epss", () => {
  const plan = planCveChips([A], {});
  assert.equal(plan.visible[0].kev, null);
  assert.equal(plan.visible[0].epss, null);
});

test("planCveChips: strong is true from 0.1 and false below, label from formatEpss", () => {
  const plan = planCveChips([A, B, C], {
    [A]: enr(NOT_LISTED, scored(0.1)),
    [B]: enr(NOT_LISTED, scored(0.5)),
    [C]: enr(NOT_LISTED, scored(0.0999)),
  });
  const by = new Map(plan.visible.map((c) => [c.id, c.epss]));
  assert.deepEqual(by.get(A), { kind: "score", label: "0.10", strong: true, date: "2026-10-16" });
  assert.deepEqual(by.get(B), { kind: "score", label: "0.50", strong: true, date: "2026-10-16" });
  assert.deepEqual(by.get(C), { kind: "score", label: "0.10", strong: false, date: "2026-10-16" });
  assert.equal(formatEpss(0.0999), "0.10");
});

test("planCveChips: invalid IDs are dropped before ordering and never counted, with enrichment present", () => {
  const plan = planCveChips([A, "not-a-cve", B, "javascript:alert(1)", C, D], {
    [D]: enr(kevOf("2026-10-01"), UNAVAILABLE),
    "not-a-cve": enr(kevOf("2026-12-31"), scored(1)),
  });
  assert.deepEqual(ids(plan), [D, A, B]);
  assert.equal(plan.overflow, 1);
  for (const chip of plan.visible) {
    assert.ok(chip.href.startsWith("https://nvd.nist.gov/vuln/detail/CVE-"));
  }
});

test("planCveChips: a prototype-chain key never reads as enrichment", () => {
  const plan = planCveChips(["CVE-2026-0001"], Object.create({ "CVE-2026-0001": enr(kevOf("2026-10-01"), scored(1)) }));
  assert.equal(plan.visible[0].kev, null);
  assert.equal(plan.visible[0].epss, null);
});
