import { SECTION_DISPLAY_ORDER } from "../config/sections.ts";
import { SOURCES } from "../config/sources.ts";
import { meetsImportance } from "../readerState.ts";
import type { ClassifiedArticle, Section, SectionedFrontPageResult } from "../types.ts";

/**
 * Outbound feeds for other services and agents: RSS 2.0 for feed readers and
 * JSON Feed 1.1 for programmatic consumers, built from the same cached
 * edition the page renders, read by `feedResponse` through `getSnapshot`
 * (08-CONTEXT D-25).
 *
 * Every feed carries Havadis's own enrichment (section, importance and its
 * reason, CVE IDs, source tier) so a consumer can triage without re-deriving
 * it: in RSS as `<category domain=...>` elements plus a `havadis:` namespace,
 * in JSON Feed as the `_havadis` extension object (JSON Feed's convention for
 * custom fields is a leading underscore).
 *
 * Feed text is untrusted publisher input. RSS output escapes every value and
 * strips characters XML 1.0 forbids, so one malformed upstream title can never
 * make the whole feed unparseable. Items are newest first, the convention feed
 * readers and pollers expect, rather than the page's ranked section order.
 */

export type FeedFormat = "xml" | "json";

/** A feed's scope: everything, a minimum importance, or one section. */
export type FeedScope =
  | { kind: "all" }
  | { kind: "importance"; min: "high" | "critical" }
  | { kind: "section"; section: Section };

export type FeedVariant = { slug: string; title: string; scope: FeedScope };

export function sectionSlug(section: Section): string {
  return section.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** Every published feed. Slugs are the URL path segment (`/feed/<slug>.<format>`). */
export const FEED_VARIANTS: readonly FeedVariant[] = [
  { slug: "all", title: "All stories", scope: { kind: "all" } },
  { slug: "high", title: "High and critical", scope: { kind: "importance", min: "high" } },
  { slug: "critical", title: "Critical only", scope: { kind: "importance", min: "critical" } },
  ...SECTION_DISPLAY_ORDER.map((section) => ({
    slug: sectionSlug(section),
    title: section,
    scope: { kind: "section", section } as const,
  })),
];

export function findFeedVariant(slug: string): FeedVariant | undefined {
  return FEED_VARIANTS.find((variant) => variant.slug === slug);
}

/** Canonical path of a variant; the "all" feed lives at the short `/feed.<format>`. */
export function feedPath(variant: FeedVariant, format: FeedFormat): string {
  return variant.slug === "all" ? `/feed.${format}` : `/feed/${variant.slug}.${format}`;
}

export function selectFeedArticles(
  result: SectionedFrontPageResult,
  scope: FeedScope,
): ClassifiedArticle[] {
  if (result.status !== "ok") return [];
  return result.articles
    .filter((article) => {
      if (scope.kind === "importance") return meetsImportance(article.importance, scope.min);
      if (scope.kind === "section") return article.section === scope.section;
      return true;
    })
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

export type FeedContext = {
  variant: FeedVariant;
  articles: readonly ClassifiedArticle[];
  /** Snapshot time (ISO); the feed's own updated/lastBuildDate. */
  generatedAt: string;
  /** Absolute origin, no trailing slash. */
  siteUrl: string;
  siteName: string;
  siteDescription: string;
};

function feedTitle({ variant, siteName }: FeedContext): string {
  return variant.slug === "all" ? `${siteName}: security news` : `${siteName}: ${variant.title}`;
}

const SOURCE_FEED_URL = new Map(SOURCES.map((source) => [source.name, source.url]));

// XML 1.0 Char production; anything else (NUL, most C0 controls, lone
// surrogates, U+FFFE/FFFF) makes a document ill-formed, so it is dropped.
const XML_INVALID = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu;

export function escapeXml(value: string): string {
  return value
    .replace(XML_INVALID, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** RFC 822 date, as RSS 2.0 requires (`toUTCString` produces exactly this form). */
function rfc822(iso: string): string {
  return new Date(iso).toUTCString();
}

export const HAVADIS_NS = "https://havadis.netlify.app/ns/feed/1.0";

export function toRss(ctx: FeedContext): string {
  const { siteUrl, generatedAt } = ctx;
  const self = `${siteUrl}${feedPath(ctx.variant, "xml")}`;
  const items = ctx.articles.map((a) => {
    const lines = [
      `<title>${escapeXml(a.title)}</title>`,
      `<link>${escapeXml(a.url)}</link>`,
      `<guid isPermaLink="true">${escapeXml(a.url)}</guid>`,
      `<pubDate>${rfc822(a.publishedAt)}</pubDate>`,
    ];
    if (a.summary.length > 0) lines.push(`<description>${escapeXml(a.summary)}</description>`);
    const sourceFeed = SOURCE_FEED_URL.get(a.source);
    lines.push(
      sourceFeed
        ? `<source url="${escapeXml(sourceFeed)}">${escapeXml(a.source)}</source>`
        : `<havadis:source>${escapeXml(a.source)}</havadis:source>`,
      `<category domain="${HAVADIS_NS}/section">${escapeXml(a.section)}</category>`,
      `<category domain="${HAVADIS_NS}/importance">${a.importance}</category>`,
      ...a.cves.map((cve) => `<category domain="https://nvd.nist.gov/vuln/detail">${escapeXml(cve)}</category>`),
      `<havadis:importance>${a.importance}</havadis:importance>`,
    );
    if (a.importanceReason) lines.push(`<havadis:reason>${escapeXml(a.importanceReason)}</havadis:reason>`);
    lines.push(
      `<havadis:section>${escapeXml(a.section)}</havadis:section>`,
      `<havadis:sourceTier>${escapeXml(a.sourceTier)}</havadis:sourceTier>`,
      `<havadis:sourceType>${escapeXml(a.sourceType)}</havadis:sourceType>`,
      ...a.cves.map((cve) => `<havadis:cve>${escapeXml(cve)}</havadis:cve>`),
    );
    return `    <item>\n${lines.map((l) => `      ${l}`).join("\n")}\n    </item>`;
  });

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:havadis="${HAVADIS_NS}">`,
    `  <channel>`,
    `    <title>${escapeXml(feedTitle(ctx))}</title>`,
    `    <link>${escapeXml(`${siteUrl}/`)}</link>`,
    `    <description>${escapeXml(ctx.siteDescription)}</description>`,
    `    <language>en</language>`,
    `    <atom:link href="${escapeXml(self)}" rel="self" type="application/rss+xml"/>`,
    `    <lastBuildDate>${rfc822(generatedAt)}</lastBuildDate>`,
    `    <ttl>15</ttl>`,
    `    <generator>${escapeXml(ctx.siteName)}</generator>`,
    ...items,
    `  </channel>`,
    `</rss>`,
    "",
  ].join("\n");
}

export function toJsonFeed(ctx: FeedContext): string {
  const { siteUrl } = ctx;
  const feed = {
    version: "https://jsonfeed.org/version/1.1",
    title: feedTitle(ctx),
    home_page_url: `${siteUrl}/`,
    feed_url: `${siteUrl}${feedPath(ctx.variant, "json")}`,
    description: ctx.siteDescription,
    language: "en",
    _havadis: {
      about: `${siteUrl}/feeds`,
      generated_at: ctx.generatedAt,
      refresh_seconds: 900,
      scope: ctx.variant.slug,
    },
    items: ctx.articles.map((a) => ({
      id: a.url,
      url: a.url,
      title: a.title,
      ...(a.summary.length > 0 ? { summary: a.summary, content_text: a.summary } : { content_text: a.title }),
      date_published: new Date(a.publishedAt).toISOString(),
      authors: [{ name: a.source }],
      tags: [a.section, a.importance, ...a.cves],
      _havadis: {
        source: a.source,
        source_tier: a.sourceTier,
        source_type: a.sourceType,
        section: a.section,
        importance: a.importance,
        importance_reason: a.importanceReason,
        cves: a.cves,
      },
    })),
  };
  return `${JSON.stringify(feed, null, 2)}\n`;
}

export const FEED_CONTENT_TYPE: Record<FeedFormat, string> = {
  xml: "application/rss+xml; charset=utf-8",
  json: "application/feed+json; charset=utf-8",
};
