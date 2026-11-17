import type { Article, SourceTier, SourceType } from "../types.ts";

/**
 * The fixture edition's marker story title. A fixture build renders it on `/`,
 * which is how CI and the zero-request proof tell a fixture page from a live one.
 */
export const FIXTURE_MARKER_TITLE = "Havadis fixture edition marker: deterministic CI front page";

/**
 * The adversarial MOB-03 cases, exported so tests reference them instead of
 * copying text. All are ASCII-only, so JS string length, bytes, code points and
 * graphemes agree. No title holds an ampersand, angle bracket, double quote or
 * apostrophe, so each one appears verbatim in the built HTML.
 */

/** Exactly 160 characters, with spaces. */
export const FIXTURE_LONG_TITLE =
  "Fixture Standards Board publishes a deliberately wordy and unreasonably long headline so that title wrapping and the three line clamp are exercised at any width";

/** Exactly 160 characters, no space at all. */
export const FIXTURE_UNBROKEN_TITLE =
  "FixtureUnbrokenHeadlineAbcdefghijAbcdefghijAbcdefghijAbcdefghijAbcdefghijAbcdefghijAbcdefghijAbcdefghijAbcdefghijAbcdefghijAbcdefghijAbcdefghijAbcdefghijAbcdefg";

/** Exactly 60 characters, no space. */
export const FIXTURE_TOKEN = "Tok0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTU";

/** A title that holds the 60-character unbroken token among ordinary words. */
export const FIXTURE_TOKEN_TITLE = `Fixture Desk indexes ${FIXTURE_TOKEN} in a fictional archive`;

/** A title naming 12 distinct CVE IDs, so the chip overflow count renders. */
export const FIXTURE_TWELVE_CVE_TITLE =
  "Fixture CERT bulletin lists CVE-2099-30001, CVE-2099-30002, CVE-2099-30003, CVE-2099-30004, CVE-2099-30005, CVE-2099-30006, CVE-2099-30007, CVE-2099-30008, CVE-2099-30009, CVE-2099-30010, CVE-2099-30011, CVE-2099-30012 in one fictional suite";

/** The title of the one story whose summary is the empty string. */
export const FIXTURE_EMPTY_SUMMARY_TITLE = "Fixture Executive Digest runs a short item with no summary at all";

/** One fictional incident reported by three sources: three URLs, three titles that normalise differently. */
export const FIXTURE_CLUSTER_TITLES: readonly string[] = [
  "Fixtureland Freight confirms breach of its dispatch portal",
  "Dispatch portal breach hits Fixtureland Freight customers",
  "Fixtureland Freight breach: what the dispatch portal exposure means",
];

export const FIXTURE_CLUSTER_URLS: readonly string[] = [
  "https://wire.fixture.test/fixtureland-freight-breach",
  "https://digest.fixture.test/dispatch-portal-breach",
  "https://labs.fixture.test/fixtureland-freight-breach-analysis",
];

type FixtureSource = { host: string; source: string; sourceTier: SourceTier; sourceType: SourceType };

const WIRE: FixtureSource = { host: "wire", source: "Fixture Wire", sourceTier: "Tech & General", sourceType: "news" };
const LABS: FixtureSource = { host: "labs", source: "Fixture Labs", sourceTier: "Security Research", sourceType: "research" };
const ADVISORY: FixtureSource = { host: "advisory", source: "Fixture Advisory Desk", sourceTier: "Enterprise Security", sourceType: "advisory" };
const CERT: FixtureSource = { host: "cert", source: "Fixture CERT", sourceTier: "Government", sourceType: "cert" };
const MINISTRY: FixtureSource = { host: "ministry", source: "Fixture Ministry Bulletin", sourceTier: "Government", sourceType: "government" };
const VENDOR: FixtureSource = { host: "vendor", source: "Fixture Vendor Blog", sourceTier: "Enterprise Security", sourceType: "vendor" };
const INTEL: FixtureSource = { host: "intel", source: "Fixture Intel Brief", sourceTier: "Threat Intelligence", sourceType: "research" };
const DIGEST: FixtureSource = { host: "digest", source: "Fixture Executive Digest", sourceTier: "Executive News", sourceType: "news" };

/**
 * The committed, hand-written stories a fixture build renders instead of the
 * 51 live feeds (D-03). Never a live capture, and consumed only behind the
 * fixture switch (`src/lib/config/fixtureMode.ts`). Every name, host and CVE ID
 * is fictional (reserved `fixture.test` host, CVE IDs in 2099). Each
 * `publishedAt` is `now` minus a fixed number of minutes, so the same `now`
 * always gives the same edition.
 *
 * Composed, the edition fills all 7 sections: Vulnerabilities 10 and
 * Advisories 9 (both collapse behind an expander), Ransomware exactly 8 (the
 * no-collapse boundary), Breaches 3 (the cluster), and the rest small. It
 * covers all 6 source tiers and 6 source types, and critical, high and normal
 * importance. The CVE stories use CVE-2099-10001 to 10005 (10001 and 10003 KEV,
 * 10002 SSVC active, 10004 SSVC poc, 10005 no EPSS row) and the 12-CVE title
 * uses CVE-2099-30001 to 30012.
 */
export function fixtureArticles(now: number): Article[] {
  const story = (
    s: FixtureSource,
    slug: string,
    minutesAgo: number,
    title: string,
    summary: string,
    url: string = `https://${s.host}.fixture.test/${slug}`,
  ): Article => ({
    title,
    url,
    source: s.source,
    sourceTier: s.sourceTier,
    sourceType: s.sourceType,
    publishedAt: new Date(now - minutesAgo * 60_000).toISOString(),
    summary,
  });

  return [
    // Industry/Policy (the default bucket): the marker and the adversarial lengths.
    story(WIRE, "marker", 10, FIXTURE_MARKER_TITLE, "A fixed story that marks this page as the committed fixture edition."),
    story(DIGEST, "long-title", 12, FIXTURE_LONG_TITLE, "A fictional standards item whose headline is exactly 160 characters."),
    story(WIRE, "unbroken-title", 14, FIXTURE_UNBROKEN_TITLE, "A fictional item whose headline has no space in it at all."),
    story(WIRE, "token-title", 16, FIXTURE_TOKEN_TITLE, "A fictional item whose headline holds a 60 character unbroken token."),
    story(DIGEST, "no-summary", 18, FIXTURE_EMPTY_SUMMARY_TITLE, ""),
    story(MINISTRY, "reporting-rule", 20, "Fixture Ministry Bulletin outlines a sample reporting rule for small operators", "A fictional ministry sets a fictional reporting date for fictional operators."),

    // Vulnerabilities (10 rows, collapses).
    story(LABS, "cve-2099-10001", 25, "Fixture Labs details CVE-2099-10001, a flaw used in ransomware intrusions", "A fictional write-up of a fictional vulnerability, written for the fixture edition."),
    story(ADVISORY, "cve-2099-10002", 40, "Fixture Advisory Desk tracks CVE-2099-10002 in a fictional product", "A fictional advisory about a fictional product, written for the fixture edition."),
    story(CERT, "twelve-cves", 3, FIXTURE_TWELVE_CVE_TITLE, "A fictional bulletin that names twelve fictional identifiers in its headline."),
    story(INTEL, "cve-2099-10003-10004", 15, "Fixture Intel Brief links CVE-2099-10003 and CVE-2099-10004 to a fictional gateway", "A fictional brief on two fictional identifiers affecting one fictional gateway."),
    story(MINISTRY, "router-flaw", 8, "Fixture Ministry Bulletin says a fictional router flaw is actively exploited", "Tracked as CVE-2099-10005 in a fictional router line, with no fix date given."),
    story(LABS, "login-library", 55, "Fixture Labs explains a fictional vulnerability in a sample login library", "A calm explainer on how a fictional library mishandles a fictional token."),
    story(VENDOR, "storage-vulnerability", 70, "Fixture Vendor Blog describes a vulnerability in a demo storage appliance", "A fictional vendor describes a fictional fix for a fictional appliance."),
    story(WIRE, "plugin-flaw", 85, "Fixture Wire covers a flaw in a sample content plugin", "A fictional report on a fictional plugin used by fictional sites."),
    story(LABS, "parser-flaw", 100, "Fixture Labs reports a parser flaw in a fictional archive tool", "A fictional parser reads a fictional archive in an unexpected way."),
    story(DIGEST, "firmware-vulnerability", 130, "Fixture Executive Digest summarises a vulnerability in sample camera firmware", "A fictional summary for fictional executives about fictional cameras."),

    // Advisories (9 rows, collapses).
    story(ADVISORY, "print-server", 22, "Fixture Advisory Desk publishes an advisory for a sample print server", "A fictional advisory with fictional steps for a fictional print server."),
    story(VENDOR, "hub-advisory", 35, "Fixture Vendor Blog posts an advisory rating a sample hub as critical severity", "A fictional vendor rates a fictional hub and lists fictional versions."),
    story(CERT, "camera-warning", 48, "Fixture CERT warns operators about misconfigured sample cameras", "A fictional notice about fictional cameras left on default settings."),
    story(MINISTRY, "grid-advisory", 62, "Fixture Ministry Bulletin issues an advisory for sample grid controllers", "A fictional ministry lists fictional controllers and fictional settings."),
    story(ADVISORY, "switch-advisory", 77, "Fixture Advisory Desk issues an advisory on a demo network switch", "A fictional advisory for a fictional switch in a fictional lab."),
    story(VENDOR, "backup-advisory", 92, "Fixture Vendor Blog shares an advisory for sample backup software", "A fictional vendor shares fictional guidance for fictional backups."),
    story(CERT, "mail-warning", 108, "Fixture CERT warns about a sample mail gateway setting", "A fictional notice about a fictional gateway option."),
    story(ADVISORY, "dns-advisory", 125, "Fixture Advisory Desk publishes an advisory for a fictional DNS appliance", "A fictional advisory with fictional guidance for a fictional appliance."),
    story(MINISTRY, "meter-warning", 140, "Fixture Ministry Bulletin warns utilities about sample meter settings", "A fictional ministry warns fictional utilities about fictional meters."),

    // Ransomware (exactly 8 rows, does not collapse).
    story(INTEL, "crew-hospitals", 30, "Fixture Intel Brief tracks a ransomware crew targeting sample hospitals", "A fictional crew and its fictional targets, written for the fixture edition."),
    story(LABS, "loader-malware", 45, "Fixture Labs dissects a fictional loader malware family", "A fictional loader and the fictional steps it takes on a fictional host."),
    story(WIRE, "ransomware-school", 60, "Fixture Wire reports ransomware at a fictional school district", "A fictional district restores fictional systems after a fictional event."),
    story(INTEL, "trojan-banking", 75, "Fixture Intel Brief profiles a fictional banking trojan", "A fictional trojan aimed at fictional banking customers."),
    story(LABS, "wiper-malware", 90, "Fixture Labs finds malware that wipes fictional backup volumes", "A fictional wiper and the fictional volumes it targets."),
    story(DIGEST, "ransomware-costs", 105, "Fixture Executive Digest weighs the cost of ransomware for sample firms", "A fictional digest compares fictional costs for fictional firms."),
    story(VENDOR, "ransom-negotiation", 120, "Fixture Vendor Blog explains a fictional ransom negotiation", "A fictional vendor walks through a fictional negotiation."),
    story(WIRE, "clipper-malware", 135, "Fixture Wire covers a fictional clipper malware sample", "A fictional sample that swaps fictional wallet addresses."),

    // Breaches (3 rows): one fictional incident, three sources, three URLs, three titles.
    story(WIRE, "fixtureland-freight-breach", 5, FIXTURE_CLUSTER_TITLES[0], "A fictional freight firm reports a fictional incident at its fictional portal.", FIXTURE_CLUSTER_URLS[0]),
    story(DIGEST, "dispatch-portal-breach", 7, FIXTURE_CLUSTER_TITLES[1], "Fictional customers of a fictional freight firm are told what happened.", FIXTURE_CLUSTER_URLS[1]),
    story(LABS, "fixtureland-freight-breach-analysis", 9, FIXTURE_CLUSTER_TITLES[2], "A fictional analysis of what the fictional portal showed to fictional visitors.", FIXTURE_CLUSTER_URLS[2]),

    // Threat Intelligence (2 rows).
    story(INTEL, "new-campaign", 28, "Fixture Intel Brief links a new campaign to a fictional threat actor", "A fictional actor and its fictional targets."),
    story(LABS, "state-group", 52, "Fixture Labs profiles a fictional nation-state group", "A fictional group and its fictional history."),

    // Tools/Techniques (2 rows).
    story(LABS, "log-tool", 33, "Fixture Labs releases an open tool for sorting sample logs", "A fictional tool that sorts fictional log lines."),
    story(VENDOR, "detection-framework", 66, "Fixture Vendor Blog describes a detection framework for sample networks", "A fictional framework for fictional networks."),
  ];
}
