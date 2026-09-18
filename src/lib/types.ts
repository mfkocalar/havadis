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

/** Static configuration for one RSS/Atom source. */
export type SourceConfig = {
  id: string;
  name: string;
  tier: SourceTier;
  url: string;
};

/** The common shape every feed item is normalized into. */
export type Article = {
  title: string;
  url: string;
  source: string;
  sourceTier: SourceTier;
  /** ISO 8601 published timestamp. */
  publishedAt: string;
  summary: string;
};

/**
 * Discriminated result shared by `fetchSource` and `getFrontPage`. Both
 * functions must never throw — every failure path resolves to the error
 * variant instead of an uncaught rejection, so the page can always render
 * its full layout (see CONTEXT.md D-03).
 */
export type FrontPageResult =
  | { status: "ok"; articles: Article[] }
  | { status: "error"; reason: string };
