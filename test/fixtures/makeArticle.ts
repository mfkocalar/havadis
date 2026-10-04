import type { Article, SourceConfig } from "../../src/lib/types.ts";

/**
 * Shared test builders for `Article` and `SourceConfig` fixtures.
 *
 * Test-only module: no file under `src/app`, `src/components`, or non-test
 * `src/lib` may import it (threat T-05-01, same convention as
 * `hostileRedirectServer.ts`, threat T-01-12). It exists so that a newly
 * required `Article` or `SourceConfig` field gets its default in exactly one
 * place instead of in every hand-written fixture literal.
 *
 * Deterministic by construction: one module-level counter shared by both
 * builders, no clock reads, no network, no randomness.
 */

let n = 0;

/** Build a complete `Article`; any field can be replaced via `overrides`. */
export function makeArticle(overrides: Partial<Article> = {}): Article {
  n += 1;
  return {
    title: `Fixture Article ${n}`,
    url: `https://fixture.test/story-${n}`,
    source: `Source ${n}`,
    sourceTier: "Tech & General",
    sourceType: "news",
    publishedAt: "2026-01-01T00:00:00.000Z",
    summary: "A fixture summary.",
    ...overrides,
  };
}

/** Build a complete `SourceConfig`; any field can be replaced via `overrides`. */
export function makeSource(overrides: Partial<SourceConfig> = {}): SourceConfig {
  n += 1;
  return {
    id: `fixture-${n}`,
    name: `Fixture ${n}`,
    tier: "Security Research",
    sourceType: "news",
    url: `https://fixture.test/feed-${n}.xml`,
    ...overrides,
  };
}
