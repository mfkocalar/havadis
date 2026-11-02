import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCES } from "./sources.ts";
import { SOURCE_TYPES } from "./sourceTypes.ts";
import type { SourceTier, SourceType } from "../types.ts";

/**
 * Hermetic config-integrity tests for SOURCES (no network, no fixture
 * server — this reads only the static data module).
 *
 * What this underwrites: `fetchWithValidatedRedirect`'s exact-host-equality
 * check can only be relied on to exclude private and loopback redirect
 * targets while every configured origin is itself a public HTTPS hostname.
 * That premise is the basis for accepting T-02-05 (DNS rebinding to a
 * same-named host after the exact-host check passes) rather than
 * implementing resolved-IP validation — see 02-01-PLAN.md's <threat_model>
 * "T-01-05 Re-evaluation". This test exists to stop that premise rotting
 * silently when a future source is added with a private, loopback, or
 * IP-literal URL.
 */

const ALL_TIERS: SourceTier[] = [
  "Government",
  "Security Research",
  "Enterprise Security",
  "Threat Intelligence",
  "Tech & General",
  "Executive News",
];

test("SOURCES has exactly 24 entries", () => {
  assert.equal(SOURCES.length, 24);
});

test("every id is unique and matches /^[a-z0-9-]+$/", () => {
  const ids = SOURCES.map((s) => s.id);
  for (const id of ids) {
    assert.match(id, /^[a-z0-9-]+$/, `source id "${id}" must be a lowercase slug`);
  }
  assert.equal(new Set(ids).size, ids.length, "all source ids must be unique");
});

test("every url is unique", () => {
  const urls = SOURCES.map((s) => s.url);
  assert.equal(new Set(urls).size, urls.length, "all source urls must be unique");
});

test("every name is a non-empty trimmed string", () => {
  for (const source of SOURCES) {
    assert.equal(typeof source.name, "string", `${source.id}: name must be a string`);
    assert.ok(source.name.length > 0, `${source.id}: name must not be empty`);
    assert.equal(
      source.name.trim(),
      source.name,
      `${source.id}: name must not have leading/trailing whitespace`
    );
  }
});

test("every tier is a valid SourceTier, and all six tiers are represented", () => {
  for (const source of SOURCES) {
    assert.ok(
      (ALL_TIERS as string[]).includes(source.tier),
      `${source.id}: tier "${source.tier}" is not one of the six SourceTier literals`
    );
  }
  for (const tier of ALL_TIERS) {
    assert.ok(
      SOURCES.some((s) => s.tier === tier),
      `no configured source carries tier "${tier}" — its badge hue would be unreachable`
    );
  }
});

// Phase 7.1 D-23 removed nist-cybersecurity, the only government-type source;
// the type stays because Phase 5 D-01 defines it and Phase 8's primary-source
// rule names it. Delete the entry when a government-type source is configured again.
const UNUSED_SOURCE_TYPES: readonly SourceType[] = ["government"];

test("every sourceType is a SOURCE_TYPES member, and every SOURCE_TYPES value outside UNUSED_SOURCE_TYPES is used", () => {
  for (const source of SOURCES) {
    assert.ok(
      (SOURCE_TYPES as readonly string[]).includes(source.sourceType),
      `${source.id}: sourceType "${source.sourceType}" is not a known SourceType`
    );
  }
  for (const type of SOURCE_TYPES) {
    if (UNUSED_SOURCE_TYPES.includes(type)) continue;
    assert.ok(
      SOURCES.some((s) => s.sourceType === type),
      `no configured source carries sourceType "${type}"`
    );
  }
  for (const type of UNUSED_SOURCE_TYPES) {
    assert.ok(
      !SOURCES.some((s) => s.sourceType === type),
      `a source now carries sourceType "${type}": delete it from UNUSED_SOURCE_TYPES`
    );
  }
});

// Phase 7.1 D-23: seven sources removed by user decision 2026-11-02, with the
// URLs they had at HEAD, plus the Ars Technica security-category feed that is
// deliberately not added.
const D23_REMOVED_IDS: readonly string[] = [
  "ars-technica",
  "heimdal",
  "gbhackers",
  "upguard-breaches",
  "bishop-fox",
  "eff",
  "nist-cybersecurity",
];
const D23_FORBIDDEN_URLS: readonly string[] = [
  "https://feeds.arstechnica.com/arstechnica/index",
  "https://heimdalsecurity.com/blog/feed/",
  "https://gbhackers.com/feed/",
  "https://www.upguard.com/breaches/rss.xml",
  "https://bishopfox.com/feeds/blog.rss",
  "https://www.eff.org/rss/updates.xml",
  "https://www.nist.gov/blogs/cybersecurity-insights/rss.xml",
  "https://arstechnica.com/security/feed/",
];

test("D-23 removals stay removed and the Ars security feed is not added (Phase 7.1 D-23)", () => {
  for (const source of SOURCES) {
    assert.ok(!D23_REMOVED_IDS.includes(source.id), `${source.id} was removed by D-23 and must not return`);
    assert.ok(!D23_FORBIDDEN_URLS.includes(source.url), `${source.id}: url ${source.url} is a D-23 removed or forbidden feed`);
  }
});

// D-03 verbatim: the type each source must carry.
const EXPECTED_SOURCE_TYPE: Record<string, SourceType> = {
  krebs: "news",
  cisa: "cert",
  "recorded-future": "vendor",
  "microsoft-security": "vendor",
  "sans-isc": "research",
  "dark-reading": "news",
  crowdstrike: "vendor",
  "bleeping-computer": "news",
  "hacker-news": "news",
  "help-net-security": "news",
  "techcrunch-security": "news",
  "cso-online": "news",
  hackread: "news",
  databreaches: "news",
  "cis-advisories": "cert",
  "cert-cc": "cert",
  "graham-cluley": "research",
  schneier: "research",
  reversinglabs: "vendor",
  "computer-weekly": "news",
  "cert-eu": "cert",
  "ncsc-uk": "cert",
  // Phase 7.1 additions (SRC-06, SRC-07)
  "paloalto-psirt": "advisory",
  "cisco-psirt": "advisory",
};

// Feeds whose live probe showed a batch-day flood and so carry maxItems (D-13).
// Plans 07.1-03 and 07.1-06 extend this list as flood feeds are configured.
const FLOOD_FEEDS: string[] = ["paloalto-psirt", "cisco-psirt"];

test("D-03 mapping: every source carries exactly the type the table assigns it", () => {
  assert.deepEqual(
    SOURCES.map((s) => s.id).sort(),
    Object.keys(EXPECTED_SOURCE_TYPE).sort(),
    "SOURCES ids must equal the D-03 table's ids"
  );
  for (const source of SOURCES) {
    assert.equal(
      source.sourceType,
      EXPECTED_SOURCE_TYPE[source.id],
      `${source.id}: sourceType drifted from the D-03 table`
    );
  }
});

test("every lang is \"en\" (D-11)", () => {
  for (const source of SOURCES) {
    assert.equal(source.lang, "en", `${source.id}: only English sources are active`);
  }
});

test("every family is a lowercase slug (D-04)", () => {
  for (const source of SOURCES) {
    assert.match(source.family, /^[a-z0-9-]+$/, `${source.id}: family "${source.family}" must be a lowercase slug`);
  }
});

test("source names are unique (Phase 9 joins on Article.source)", () => {
  const names = SOURCES.map((s) => s.name);
  assert.equal(new Set(names).size, names.length, "all source names must be unique");
});

test("cert-eu and ncsc-uk are configured as cert sources (D-08)", () => {
  for (const id of ["cert-eu", "ncsc-uk"]) {
    const source = SOURCES.find((s) => s.id === id);
    assert.ok(source, `${id} must be configured`);
    assert.equal(source.sourceType, "cert");
  }
});

test("every url parses as https:", () => {
  for (const source of SOURCES) {
    const parsed = new URL(source.url);
    assert.equal(
      parsed.protocol,
      "https:",
      `${source.id}: url must use https:, got "${parsed.protocol}"`
    );
  }
});

test("no url hostname is an IP literal, loopback/local name, or non-registrable", () => {
  const isIPv4Literal = (hostname: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
  const isIPv6Literal = (hostname: string) => hostname.startsWith("[");
  const isLoopbackOrLocalName = (hostname: string) =>
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".localdomain");
  const isNonRegistrable = (hostname: string) => !hostname.includes(".");

  for (const source of SOURCES) {
    const { hostname } = new URL(source.url);
    assert.equal(
      isIPv4Literal(hostname),
      false,
      `${source.id}: hostname "${hostname}" must not be an IPv4 literal`
    );
    assert.equal(
      isIPv6Literal(hostname),
      false,
      `${source.id}: hostname "${hostname}" must not be a bracketed IPv6 literal`
    );
    assert.equal(
      isLoopbackOrLocalName(hostname),
      false,
      `${source.id}: hostname "${hostname}" must not be localhost or a .local/.internal/.localdomain suffix`
    );
    assert.equal(
      isNonRegistrable(hostname),
      false,
      `${source.id}: hostname "${hostname}" must contain at least one dot`
    );
  }
});

test("maxItems is set on exactly the flood feeds, each an integer from 1 to 5 (Phase 7.1 D-13)", () => {
  assert.deepEqual(
    SOURCES.filter((s) => s.maxItems !== undefined)
      .map((s) => s.id)
      .sort(),
    [...FLOOD_FEEDS].sort(),
    "maxItems must be set on exactly the flood feeds, and nowhere else"
  );
  for (const source of SOURCES) {
    if (source.maxItems === undefined) continue;
    assert.ok(
      Number.isInteger(source.maxItems) && source.maxItems >= 1 && source.maxItems <= 5,
      `${source.id}: maxItems must be an integer from 1 to 5`
    );
  }
});

test("any maxBodyBytes set on a source is above the 2MB default and at most 10MB", () => {
  for (const source of SOURCES) {
    if (source.maxBodyBytes === undefined) continue;
    assert.ok(
      Number.isInteger(source.maxBodyBytes) &&
        source.maxBodyBytes > 2 * 1024 * 1024 &&
        source.maxBodyBytes <= 10 * 1024 * 1024,
      `${source.id}: maxBodyBytes must be an integer in (2MB, 10MB]`
    );
  }
});

test("any maxItems set on a source is a positive integer", () => {
  for (const source of SOURCES) {
    if (source.maxItems === undefined) continue;
    assert.ok(
      Number.isInteger(source.maxItems) && source.maxItems > 0,
      `${source.id}: maxItems must be a positive integer`
    );
  }
});
