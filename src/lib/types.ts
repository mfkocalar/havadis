/**
 * Shared contracts for the Havadis ingestion pipeline.
 *
 * These types are intentionally source-count-agnostic: Phase 1 wires exactly
 * one SourceConfig (Krebs on Security), but every shape here is designed so
 * Phase 2 can grow `SOURCES` to 13 entries without touching this file.
 */

/** The six source tiers from PROJECT.md's 13-source table. */
export type SourceTier =
  | "Government"
  | "Security Research"
  | "Enterprise Security"
  | "Threat Intelligence"
  | "Tech & General"
  | "Executive News";

/**
 * What kind of outlet a source is. Orthogonal to `SourceTier`: the tier is
 * the editorial grouping from PROJECT.md, the type is the publisher's role
 * (CISA is tier Government but type cert). Exactly one value per source
 * (Phase 5 D-01, D-02).
 */
export type SourceType = "news" | "research" | "vendor" | "cert" | "government";

/** Static configuration for one RSS/Atom source. */
export type SourceConfig = {
  id: string;
  name: string;
  tier: SourceTier;
  /** Exactly one source type per source (Phase 5 D-01). */
  sourceType: SourceType;
  url: string;
  /**
   * This source is known to serve a genuinely valid RSS/Atom body under a
   * `text/html` content-type, verified by live probe. Omitting this field
   * (the default) means an HTML response is rejected before the body is
   * read. Kept as a documented per-source escape hatch: if a source later
   * starts serving valid RSS under `text/html`, opt in that one entry
   * rather than re-loosening the content-type gate for all sources.
   */
  allowHtmlContentType?: boolean;
};

/** The common shape every feed item is normalized into. */
export type Article = {
  title: string;
  url: string;
  source: string;
  sourceTier: SourceTier;
  /**
   * Copied from the source config in `normalize` only, never derived from
   * feed text.
   */
  sourceType: SourceType;
  /** ISO 8601 published timestamp. */
  publishedAt: string;
  summary: string;
};

/**
 * Discriminated result of a single source's fetch, shared by `fetchSource`
 * and `fanOut`'s injectable fetcher seam. Must never throw — every failure
 * path resolves to the error variant instead of an uncaught rejection (see
 * CONTEXT.md D-03). `getFrontPage` now returns `SectionedFrontPageResult`
 * (Phase 3, 03-01) — this type stays the per-source result shape only.
 */
export type FrontPageResult =
  | { status: "ok"; articles: Article[] }
  | { status: "error"; reason: string };

/**
 * The 7 newspaper-style sections every article is classified into
 * (PROJECT.md's taxonomy, CLASSIFY-01/CLASSIFY-03). Declared here in D-12
 * display order for readability, but `SECTION_DISPLAY_ORDER` in
 * `config/sections.ts` — not this declaration order — is the runtime
 * authority for render order (D-05: evaluation order and display order are
 * two separate constants).
 */
export type Section =
  | "Vulnerabilities"
  | "Advisories"
  | "Ransomware"
  | "Breaches"
  | "Threat Intelligence"
  | "Tools/Techniques"
  | "Industry/Policy";

/**
 * An `Article` after classification. Derived, not a widening of `Article`
 * itself — `Article` stays exactly seven fields (the seventh, `sourceType`,
 * arrived in Phase 5) because `normalize`, `fetchSource` and `fanOut` all
 * construct it and `fanOut.test.ts` and `dedupe.test.ts` pin its key set to
 * exactly those seven fields.
 */
export type ClassifiedArticle = Article & {
  section: Section;
  /**
   * CVE IDs found in this article's title and capped summary (UI-03, D-13):
   * uppercase, de-duplicated, kept in first-appearance order with title IDs
   * before summary IDs. Computed by `extractCves` in `composeFrontPage`.
   */
  cves: string[];
};

/** One non-empty section's ranked articles, in `SECTION_DISPLAY_ORDER` position. */
export type SectionGroup = { section: Section; articles: ClassifiedArticle[] };

/**
 * The discriminated result `getFrontPage` returns (Phase 3, 03-01). Must
 * never throw — same never-throws contract as `FrontPageResult` (CONTEXT.md
 * D-03). `articles` is always the flattening of `sections` in display
 * order, never computed independently (RESEARCH.md Open Question 1).
 *
 * `generatedAt` (ok variant only) is an ISO 8601 timestamp of when this
 * snapshot was composed, derived from the same single `now` the ranking used
 * (Phase 3 D-09, Phase 4 D-13). The error variant carries none and renders
 * no bar.
 */
export type SectionedFrontPageResult =
  | {
      status: "ok";
      articles: ClassifiedArticle[];
      sections: SectionGroup[];
      generatedAt: string;
    }
  | { status: "error"; reason: string };
