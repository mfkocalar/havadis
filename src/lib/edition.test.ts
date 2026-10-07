import { test } from "node:test";
import assert from "node:assert/strict";
import { makeArticle } from "../../test/fixtures/makeArticle.ts";
import { produceEdition } from "./edition.ts";
import { composeFrontPage } from "./pipeline/getFrontPage.ts";
import type { SectionedFrontPageResult } from "./types.ts";

/**
 * Hermetic tests of the pure edition policy (D-05): every call injects a
 * loader, so nothing touches the network or the clock.
 */

const NOW = Date.parse("2026-09-23T12:00:00.000Z");
const HOUR = 3_600_000;

test("an errored load is rejected with its reason", async () => {
  const load = async (): Promise<SectionedFrontPageResult> => ({ status: "error", reason: "boom" });
  await assert.rejects(produceEdition(NOW, load), /edition rejected: boom/);
});

test("a load with zero articles is rejected", async () => {
  const load = async (now: number): Promise<SectionedFrontPageResult> => composeFrontPage([], now);
  await assert.rejects(produceEdition(NOW, load), /edition rejected: zero articles/);
});

test("a partial edition with at least one article is published unchanged", async () => {
  const composed = composeFrontPage(
    [makeArticle({ publishedAt: new Date(NOW - HOUR).toISOString() })],
    NOW
  );
  const edition = await produceEdition(NOW, async () => composed);
  assert.equal(edition, composed);
  assert.equal(edition.status, "ok");
  assert.ok(edition.articles.length >= 1);
});

test("the loader is called once, with exactly the now it was given", async () => {
  const seen: number[] = [];
  const load = async (now: number): Promise<SectionedFrontPageResult> => {
    seen.push(now);
    return composeFrontPage([makeArticle({ publishedAt: new Date(NOW).toISOString() })], now);
  };
  await produceEdition(NOW, load);
  assert.deepEqual(seen, [NOW]);
});
