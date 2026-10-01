import { test } from "node:test";
import assert from "node:assert/strict";
import { planSectionCap } from "./planSectionCap.ts";

/**
 * Unit tests for planSectionCap.ts (D-05, D-06, D-07): only totals of 9 or
 * more collapse, to the top 6 plus the rest hidden.
 */

const CASES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0],
  [1, 1, 0],
  [6, 6, 0],
  [7, 7, 0],
  [8, 8, 0],
  [9, 6, 3],
  [10, 6, 4],
  [26, 6, 20],
];

for (const [total, visibleCount, hiddenCount] of CASES) {
  test(`planSectionCap(${total}) is visible ${visibleCount}, hidden ${hiddenCount}`, () => {
    assert.deepEqual(planSectionCap(total), { visibleCount, hiddenCount });
  });
}

test("for every total 0..40 the split sums to the total, hides 0 or at least 3, and caps visible at 6 when collapsed", () => {
  for (let total = 0; total <= 40; total++) {
    const { visibleCount, hiddenCount } = planSectionCap(total);
    assert.equal(visibleCount + hiddenCount, total, `total ${total}`);
    assert.ok(hiddenCount === 0 || hiddenCount >= 3, `total ${total}: hidden ${hiddenCount}`);
    if (hiddenCount > 0) {
      assert.ok(visibleCount <= 6, `total ${total}: visible ${visibleCount}`);
    }
  }
});

test("a negative or non-integer total returns zeros without throwing", () => {
  assert.deepEqual(planSectionCap(-1), { visibleCount: 0, hiddenCount: 0 });
  assert.deepEqual(planSectionCap(7.5), { visibleCount: 0, hiddenCount: 0 });
  assert.deepEqual(planSectionCap(Number.NaN), { visibleCount: 0, hiddenCount: 0 });
});
