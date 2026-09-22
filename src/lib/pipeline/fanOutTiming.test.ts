import { test, after } from "node:test";
import assert from "node:assert/strict";
import { fanOut } from "./fanOut.ts";
import { startHostileServer } from "../../../test/fixtures/hostileRedirectServer.ts";
import type { Article, SourceConfig } from "../types.ts";

/**
 * Wall-clock proof of ROADMAP Phase 2 Success Criterion 1 ("observable as
 * concurrent, not sequential") and the stall-isolation half of Success
 * Criterion 2, kept separate from `fanOut.test.ts` for two reasons: a
 * timing assertion sensitive to a loaded machine should never obscure the
 * failure-isolation proof, and the stall tests below necessarily cost the
 * full ~8s `SOURCE_TIMEOUT_MS` budget (`fetchSource.ts`) — that duration is
 * expected here, not a hang, and is visibly quarantined to this one file.
 *
 * Three separate fixture servers are started (not one) so the three
 * concurrent requests in the concurrency test target three distinct
 * origins, exactly like production's 13 distinct source hosts. This rules
 * out the HTTP client's per-origin connection pooling ever serialising
 * same-origin requests and turning a correct parallel fan-out into a false
 * timing failure.
 */

const serverA = await startHostileServer();
const serverB = await startHostileServer();
const serverC = await startHostileServer();
after(async () => {
  await serverA.close();
  await serverB.close();
  await serverC.close();
});

function fixtureSource(id: string, baseUrl: string, path: string): SourceConfig {
  return { id, name: id, tier: "Security Research", url: `${baseUrl}${path}` };
}

test("concurrency: three 900ms-delayed sources on three distinct origins resolve in well under their summed delay", async () => {
  const sources: SourceConfig[] = [
    fixtureSource("delayed-a", serverA.baseUrl, "/delayed-feed?ms=900&tag=A"),
    fixtureSource("delayed-b", serverB.baseUrl, "/delayed-feed?ms=900&tag=B"),
    fixtureSource("delayed-c", serverC.baseUrl, "/delayed-feed?ms=900&tag=C"),
  ];

  const start = Date.now();
  const articles = await fanOut(sources);
  const elapsed = Date.now() - start;
  // Deliberately surfaced for the SUMMARY's measured-timing record.
  console.log(`[fanOutTiming] concurrency elapsed: ${elapsed}ms`);

  assert.deepEqual(
    articles.map((a) => a.title).sort(),
    ["Fixture Item A", "Fixture Item B", "Fixture Item C"],
    "all three delayed sources must contribute their article"
  );
  assert.ok(
    elapsed >= 900,
    `elapsed was ${elapsed}ms, below the single-source 900ms delay — the fixture never actually delayed, so this assertion would be vacuous`
  );
  assert.ok(
    elapsed < 2000,
    `elapsed was ${elapsed}ms — a sequential fan-out over three 900ms sources would take roughly 2700ms, so exceeding 2000ms means the fetches are not running concurrently`
  );
});

/**
 * The stall-isolation run (two healthy sources plus one stalled source)
 * costs the full ~8s `SOURCE_TIMEOUT_MS` budget. It is executed exactly
 * once and memoized here so the two assertions below (which article set
 * comes back, and whether the stalled source's budget got serialised
 * behind or added to the others') share one run rather than paying the
 * ~8s cost twice.
 */
let stallRun: Promise<{ articles: Article[]; elapsed: number }> | null = null;
function runStallIsolation() {
  if (!stallRun) {
    stallRun = (async () => {
      const sources: SourceConfig[] = [
        fixtureSource("delayed-a", serverA.baseUrl, "/delayed-feed?ms=50&tag=A"),
        fixtureSource("delayed-b", serverB.baseUrl, "/delayed-feed?ms=50&tag=B"),
        // The fixture's never-responding route: withholds headers
        // entirely, so fetchSource's per-source SOURCE_TIMEOUT_MS
        // (8_000ms, unchanged this plan) governs it. Expected wall-clock
        // here is roughly 8 seconds — that is the per-source budget
        // working as designed, not a hang, so this constant must never be
        // shortened to make this test faster.
        fixtureSource("stalled", serverC.baseUrl, "/hang"),
      ];
      const start = Date.now();
      const articles = await fanOut(sources);
      const elapsed = Date.now() - start;
      return { articles, elapsed };
    })();
  }
  return stallRun;
}

test(
  "stall isolation: a stalled source does not block or extend the healthy sources' results",
  { timeout: 20_000 },
  async () => {
    const { articles } = await runStallIsolation();

    assert.deepEqual(
      articles.map((a) => a.title).sort(),
      ["Fixture Item A", "Fixture Item B"],
      "the two healthy sources' articles must be returned; fanOut must resolve rather than reject, and the stalled source must contribute nothing"
    );
  }
);

test(
  "stall isolation: the stalled source's own timeout budget is not serialised behind or added to the healthy sources' budget",
  { timeout: 20_000 },
  async () => {
    const { elapsed } = await runStallIsolation();
    // Deliberately surfaced for the SUMMARY's measured-timing record.
    console.log(`[fanOutTiming] stall-isolation elapsed: ${elapsed}ms`);

    assert.ok(
      elapsed < 12_000,
      `elapsed was ${elapsed}ms — comfortably above one 8s per-source timeout budget but far below two (16s) is expected; exceeding 12s would mean the stalled source's budget is being serialised behind or added to the healthy sources' own timing rather than running concurrently with them`
    );
  }
);
