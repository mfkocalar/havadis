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

test("SOURCES has exactly 42 entries", () => {
  assert.equal(SOURCES.length, 42);
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
  "fortinet-psirt": "advisory",
  "ivanti-security": "advisory",
  "chrome-releases": "advisory",
  cccs: "cert",
  "jpcert-en": "cert",
  unit42: "vendor",
  talos: "vendor",
  "google-threat-intel": "vendor",
  "eset-research": "vendor",
  securelist: "vendor",
  sentinellabs: "vendor",
  "check-point-research": "vendor",
  "proofpoint-threat-insight": "vendor",
  "dfir-report": "research",
  "citizen-lab": "research",
  huntress: "vendor",
  sekoia: "vendor",
  "nviso-labs": "vendor",
};

// Feeds whose live probe showed a batch-day flood and so carry maxItems (D-13).
// Plans 07.1-03 and 07.1-06 extend this list as flood feeds are configured.
const FLOOD_FEEDS: string[] = ["paloalto-psirt", "cisco-psirt", "fortinet-psirt", "cccs", "sekoia"];

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

// A vendor's blog and its advisories are two distinct sources from one publisher
// organisation, so they share a family (Phase 7.1 D-04, D-06; roadmap SC2).
// Tuples are [first id, second id, family slug]; later plans append tuples.
const FAMILY_PAIRS: readonly (readonly [string, string, string])[] = [
  ["unit42", "paloalto-psirt", "palo-alto"],
  ["talos", "cisco-psirt", "cisco"],
  ["google-threat-intel", "chrome-releases", "google"],
];

test("sources from one publisher organisation share one family (Phase 7.1 D-04, D-06)", () => {
  for (const [firstId, secondId, family] of FAMILY_PAIRS) {
    const first = SOURCES.find((s) => s.id === firstId);
    const second = SOURCES.find((s) => s.id === secondId);
    assert.ok(first, `${firstId} must be configured`);
    assert.ok(second, `${secondId} must be configured`);
    assert.equal(first.family, family, `${firstId}: family must be ${family}`);
    assert.equal(second.family, family, `${secondId}: family must be ${family}`);
    assert.notEqual(first.id, second.id);
    assert.notEqual(first.name, second.name, `${firstId} and ${secondId} must keep distinct names`);
    assert.notEqual(first.url, second.url, `${firstId} and ${secondId} must keep distinct urls`);
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

// Phase 7.1 D-14: on-topic (keep) and marketing (drop) titles each configured
// titleInclude must separate, copied verbatim from the in-sample evaluation of
// 2026-11-02. Delete a row with the titleInclude it covers.
const TITLE_INCLUDE_CASES: Record<string, { keep: string[]; drop: string[] }> = {
  huntress: {
    keep: [
      "Managed for Malice: How Attackers Turn MDM into Remote Access",
      "Camera Management Software Compromise Leads to Malware Deployment",
      "AI, Scripts, Operator: Inside the ConnectWise Attack",
    ],
    drop: [
      "Reports of SIEM's Death Have Been Greatly Exaggerated",
      "Meet the Huntress Neighborhood Watch Program",
      "Introducing ITDR Lookback: Find Out Who Was in Your Microsoft 365 Tenant Before You Were",
    ],
  },
  sekoia: {
    keep: [
      "PHP2Shell Was Exploited Before the Patch",
      "Sekoia Honeypot Captures an Attack on GenAI Infrastructure",
      "Gotta Breach 'Em All! The Journey Of ShinyHunters",
    ],
    drop: [
      "The Future Of The SOC Is Deployment Freedom",
      "Self-Hosted SOC Platforms Can Keep Pace With Modern Threats",
      "ISOC, AI Agents, And The New Shape Of Security Operations",
    ],
  },
  "eset-research": {
    keep: [
      "Amatera: How the prolific infostealer works and spreads",
      "ESET APT Activity Report Q2 2026–Q3 2026",
      "PHP2Shell: What to know about two critical PHP flaws",
    ],
    drop: [
      "This month in security with Tony Anscombe – October 2026 edition",
      "Lessons from Cybersecurity Black Week",
      "Is the ad a scam? How to tell before you click",
    ],
  },
};

test("every titleInclude is anchored, stateless and linear (Phase 7.1 D-14)", () => {
  const hostile = "a ".repeat(50_000) + "x";
  assert.equal(hostile.length, 100_001);
  for (const source of SOURCES) {
    if (source.titleInclude === undefined) continue;
    const re = source.titleInclude;
    assert.ok(re instanceof RegExp, `${source.id}: titleInclude must be a RegExp`);
    assert.ok(re.source.startsWith("^"), `${source.id}: titleInclude must start with ^`);
    assert.equal(re.global, false, `${source.id}: titleInclude must not carry the g flag`);
    assert.equal(re.sticky, false, `${source.id}: titleInclude must not carry the y flag`);
    const t0 = performance.now();
    re.test(hostile);
    const ms = performance.now() - t0;
    assert.ok(ms < 500, `${source.id}: titleInclude took ${ms} ms on a 100,001-character title`);
  }
});

test("every titleInclude keeps its on-topic sample titles and drops its marketing sample titles (Phase 7.1 D-14)", () => {
  assert.deepEqual(
    SOURCES.filter((s) => s.titleInclude !== undefined).map((s) => s.id).sort(),
    Object.keys(TITLE_INCLUDE_CASES).sort(),
    "the ids that set titleInclude must equal the TITLE_INCLUDE_CASES keys"
  );
  for (const [id, cases] of Object.entries(TITLE_INCLUDE_CASES)) {
    const re = SOURCES.find((s) => s.id === id)?.titleInclude;
    assert.ok(re, `${id}: titleInclude must be configured`);
    for (const title of cases.keep) assert.ok(re.test(title), `${id}: must keep "${title}"`);
    for (const title of cases.drop) assert.ok(!re.test(title), `${id}: must drop "${title}"`);
  }
});
