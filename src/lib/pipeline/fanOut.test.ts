import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fanOut } from "./fanOut.ts";
import { startHostileServer } from "../../../test/fixtures/hostileRedirectServer.ts";
import { makeArticle, makeSource } from "../../../test/fixtures/makeArticle.ts";
import type { FrontPageResult, SourceConfig } from "../types.ts";

/**
 * Failure-isolation proof for `fanOut`, against real sockets rather than by
 * reading the code — ROADMAP Phase 2 Success Criterion 2, and D-05/D-06/D-07
 * from 02-CONTEXT.md.
 *
 * One hermetic fixture server backs every test in this file; it is started
 * once and closed in an `after` hook so a failing assertion can never leave
 * the ephemeral port bound. This file is intentionally fast (the fixture's
 * never-responding stall route is deliberately not used here — that costs
 * the full 8s budget and belongs in fanOutTiming.test.ts) and fully
 * hermetic: no reference to any of the 13 real feed hostnames.
 */

const server = await startHostileServer();
after(() => server.close());

/** Tier is irrelevant to `fanOut` — kept constant so this stays a failure-
 * isolation test, not an accidental tier test. */
function fixtureSource(id: string, path: string): SourceConfig {
  return makeSource({ id, name: id, tier: "Security Research", url: `${server.baseUrl}${path}` });
}

test("mixed health: two healthy sources among four broken ones yield exactly the healthy sources' articles", async () => {
  const sources: SourceConfig[] = [
    fixtureSource("healthy-a", "/delayed-feed?tag=A"),
    fixtureSource("healthy-b", "/delayed-feed?tag=B"),
    fixtureSource("http-error", "/status-500"),
    fixtureSource("bad-xml", "/malformed-xml"),
    fixtureSource("not-found", "/does-not-exist"),
    // Port 1 is privileged and unbound on any normal host, so this
    // connection is refused immediately — a real failure mode with no
    // timer cost, unlike the fixture's never-responding stall route.
    fixtureSource("dead-endpoint", "http://127.0.0.1:1/feed"),
  ];

  const articles = await fanOut(sources);

  assert.deepEqual(
    articles.map((a) => a.title).sort(),
    ["Fixture Item A", "Fixture Item B"],
    "only the two healthy sources' articles should survive; settlement order is not guaranteed, so titles are sorted before comparing"
  );
});

test("D-07: one healthy source among five broken ones yields exactly one article, with no minimum-article floor", async () => {
  const sources: SourceConfig[] = [
    fixtureSource("healthy-only", "/delayed-feed?tag=Solo"),
    fixtureSource("http-error", "/status-500"),
    fixtureSource("bad-xml", "/malformed-xml"),
    fixtureSource("not-found", "/does-not-exist"),
    fixtureSource("dead-endpoint-1", "http://127.0.0.1:1/feed"),
    fixtureSource("dead-endpoint-2", "http://127.0.0.1:1/feed"),
  ];

  const articles = await fanOut(sources);

  assert.deepEqual(
    articles.map((a) => a.title),
    ["Fixture Item Solo"],
    "exactly one article should render, with no special-casing for a lone success"
  );
});

test("D-06: every source broken yields an empty array, and fanOut still resolves", async () => {
  const sources: SourceConfig[] = [
    fixtureSource("http-error", "/status-500"),
    fixtureSource("bad-xml", "/malformed-xml"),
    fixtureSource("not-found", "/does-not-exist"),
    fixtureSource("dead-endpoint", "http://127.0.0.1:1/feed"),
  ];

  const articles = await fanOut(sources);

  assert.deepEqual(articles, [], "zero of zero healthy sources must yield an empty array, not a rejection");
});

test("rejected settlement: a throwing fetcher for one source does not block the others' results", async () => {
  const sources: SourceConfig[] = [
    makeSource({ id: "throws", name: "throws", tier: "Security Research", url: "irrelevant://throws" }),
    makeSource({ id: "ok-one", name: "ok-one", tier: "Security Research", url: "irrelevant://ok-one" }),
    makeSource({ id: "ok-two", name: "ok-two", tier: "Security Research", url: "irrelevant://ok-two" }),
  ];

  const fetcher = async (source: SourceConfig): Promise<FrontPageResult> => {
    if (source.id === "throws") {
      throw new Error("simulated rejection for the throws source");
    }
    return {
      status: "ok",
      articles: [
        makeArticle({
          title: `Article from ${source.id}`,
          url: `irrelevant://${source.id}/article`,
          source: source.name,
          sourceTier: source.tier,
          publishedAt: "2026-01-01T00:00:00.000Z",
          summary: "",
        }),
      ],
    };
  };

  const articles = await fanOut(sources, fetcher);

  assert.deepEqual(
    articles.map((a) => a.title).sort(),
    ["Article from ok-one", "Article from ok-two"],
    "a rejected settlement must not block or corrupt the other sources' fulfilled results"
  );
});

test("injected error variant: a returned {status:'error'} value is swallowed identically to a thrown rejection", async () => {
  const sources: SourceConfig[] = [
    makeSource({ id: "throws", name: "throws", tier: "Security Research", url: "irrelevant://throws" }),
    makeSource({ id: "errors", name: "errors", tier: "Security Research", url: "irrelevant://errors" }),
    makeSource({ id: "ok-one", name: "ok-one", tier: "Security Research", url: "irrelevant://ok-one" }),
  ];

  const okArticle = (id: string) =>
    makeArticle({
      title: `Article from ${id}`,
      url: `irrelevant://${id}/article`,
      source: id,
      sourceTier: "Security Research",
      publishedAt: "2026-01-01T00:00:00.000Z",
      summary: "",
    });

  const throwingFetcher = async (source: SourceConfig): Promise<FrontPageResult> => {
    if (source.id === "throws") throw new Error("simulated rejection");
    if (source.id === "errors") return { status: "error", reason: "simulated error variant" };
    return { status: "ok", articles: [okArticle(source.id)] };
  };

  const errorVariantFetcher = async (source: SourceConfig): Promise<FrontPageResult> => {
    // Same three sources, but the "throws" id now also returns the error
    // variant instead of throwing — proving the two failure shapes are
    // handled identically, not merely both "happening not to break
    // anything" by coincidence.
    if (source.id === "throws") return { status: "error", reason: "simulated error variant" };
    if (source.id === "errors") return { status: "error", reason: "simulated error variant" };
    return { status: "ok", articles: [okArticle(source.id)] };
  };

  const rejectedResult = await fanOut(sources, throwingFetcher);
  const errorVariantResult = await fanOut(sources, errorVariantFetcher);

  assert.deepEqual(
    rejectedResult.map((a) => a.title).sort(),
    errorVariantResult.map((a) => a.title).sort(),
    "a thrown rejection and a returned error variant must produce the identical surviving article set"
  );
  assert.deepEqual(
    rejectedResult.map((a) => a.title),
    ["Article from ok-one"],
    "only the genuinely-ok source should contribute an article in either case"
  );
});

test("D-05: returned Article objects carry no failure, status, count, or diagnostic field", async () => {
  const sources: SourceConfig[] = [fixtureSource("healthy-only", "/delayed-feed?tag=Shape")];

  const articles = await fanOut(sources);

  assert.equal(articles.length, 1, "expected exactly one article from the single healthy fixture source");
  assert.deepEqual(
    Object.keys(articles[0]).sort(),
    ["publishedAt", "source", "sourceTier", "summary", "title", "url"],
    "the returned Article must carry exactly the six Article fields — no health, status, or diagnostic metadata smuggled in"
  );
});

// This test guards a copy contract, not behaviour: it pins the exact
// verbatim empty-state string 02-UI-SPEC.md marks as reused for both a
// genuinely quiet 24h window and the D-06 all-sources-failed case, so a
// future edit to page.tsx cannot silently drift that copy out from under
// this phase's failure-isolation guarantee.
test("D-06 copy contract: page.tsx still renders the verbatim Phase 1 empty-state copy", () => {
  const pageSource = readFileSync(
    new URL("../../app/page.tsx", import.meta.url),
    "utf-8"
  );
  assert.match(
    pageSource,
    /No articles in the last 24 hours\./,
    "the D-06 all-sources-failed presentation reuses this exact Phase 1 copy verbatim"
  );
});
