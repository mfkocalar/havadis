import type { Section } from "../types.ts";

/**
 * Section classification config, ported from PROJECT.md's 7-section
 * reference taxonomy (Context) and tuned against a live 81-article snapshot
 * of all 13 configured sources fetched 2026-09-23 (03-RESEARCH.md "Live
 * Taxonomy Validation"). Every deviation from the reference list is
 * documented in a comment next to `SECTION_KEYWORDS` below (D-07).
 *
 * `SECTION_DISPLAY_ORDER` (render order, D-12) and `CLASSIFICATION_ORDER`
 * (rule-evaluation specificity order, D-05) are deliberately two separate
 * constants — never merge them, even though both are permutations of the 7
 * sections. Mirrors `sources.ts`'s pure-data, no-default-export convention.
 */

/** D-12: exact display/render order. Empty sections are skipped by groupBySection. */
export const SECTION_DISPLAY_ORDER: readonly Section[] = [
  "Vulnerabilities",
  "Advisories",
  "Ransomware",
  "Breaches",
  "Threat Intelligence",
  "Tools/Techniques",
  "Industry/Policy",
];

/** D-06: Industry/Policy is purely the default bucket — never itself a classification rule. */
export const DEFAULT_SECTION: Section = "Industry/Policy";

/** Every section except the default bucket, which has no active keyword rule (D-05). */
export type RuleSection = Exclude<Section, "Industry/Policy">;

/**
 * D-05: specificity evaluation order — most specific rules first, so a
 * broad word only ever claims what a more specific rule didn't already
 * take. This is why CISA's CVE-laden ICS advisories correctly land in
 * Vulnerabilities rather than Advisories (Vulnerabilities is evaluated
 * first). Kept as a separate constant from SECTION_DISPLAY_ORDER — never
 * reorder this to match display order.
 */
export const CLASSIFICATION_ORDER: readonly RuleSection[] = [
  "Vulnerabilities",
  "Ransomware",
  "Breaches",
  "Advisories",
  "Threat Intelligence",
  "Tools/Techniques",
];

/** PROJECT.md's taxonomy emoji, keyed by section. Ranking/tier data never renders here — this is purely presentational. */
export const SECTION_EMOJI: Record<Section, string> = {
  Vulnerabilities: "🐛",
  Advisories: "📢",
  Ransomware: "💀",
  Breaches: "🚨",
  "Threat Intelligence": "⚠️",
  "Tools/Techniques": "🔧",
  "Industry/Policy": "🏛️",
};

/**
 * D-07: keyword/phrase rules per section, ported from PROJECT.md's
 * reference taxonomy then tuned against the live snapshot. String entries
 * are literal keywords/phrases run through `keywordToRegExp` (word-bounded,
 * plural-tolerant, case-insensitive); RegExp entries are used as-is.
 *
 * Deviations from the reference taxonomy, each validated live
 * (03-RESEARCH.md "Live Taxonomy Validation"):
 * - Pruned bare single generic words `threat`, `attack`, `incident`,
 *   `encrypted`, `recommend`, `notice`, `alert` — each incidentally matches
 *   unrelated live articles (RESEARCH Pitfall 4: bare `threat` would have
 *   pulled a same-story ShinyHunters/FBI copy into Threat Intelligence via
 *   its summary even though the title matched Breaches first; `alert` also
 *   fires on ordinary product/verb usage and CISA's own feed branding).
 * - Narrowed bare `worm` to the two-word phrase `computer worm` — live false
 *   positive: Ars Technica's "Woman's brain worm infection confirmed after
 *   eggs grow tails in lab test" (a biology story) matches `\bworm\b`
 *   (RESEARCH Pitfall 3). Re-running the snapshot with this one change
 *   removed the false positive with zero loss of true positives.
 * - Narrowed `malicious` to `malicious actor` — D-07 names bare `malicious`
 *   as over-broad (e.g. "Malicious npm package found" should not classify as
 *   Threat Intelligence).
 * - Bounded the `TA\d+` reference pattern to `\bTA\d{1,5}\b` — a bounded
 *   quantifier (ReDoS-safe) that is also word-bounded so "Tata Motors"
 *   never matches.
 * - Added live-observed morphological variants and obvious missing terms:
 *   `vulnerabilities`, `exploited`, `exploitation`, `patched`, `breached`,
 *   `leak`, `compromised`, `advisories`, `warns`, `threat group`,
 *   `nation-state` — e.g. live titles "Webinar tomorrow: Inside real-world
 *   Google Workspace breaches" and "Chinese hackers exploit WordPress,
 *   Zyxel flaws to steal govt data" (2026-09-23 snapshot) are why plural
 *   forms matter; the plural-tolerant matcher (see classify.ts's
 *   `keywordToRegExp`) is why `patches` needs no separate entry once
 *   `patch` is listed.
 * - Industry/Policy's reference keywords (regulation, policy, compliance,
 *   GDPR, HIPAA, law, government) are intentionally NOT wired in as an
 *   active rule set — Industry/Policy is purely the default bucket (D-05),
 *   populated by exhaustion, not by a keyword match.
 */
export const SECTION_KEYWORDS: Record<RuleSection, ReadonlyArray<string | RegExp>> = {
  Vulnerabilities: [
    "CVE-",
    "vulnerability",
    "vulnerabilities",
    "zero-day",
    "0-day",
    "exploit",
    "exploited",
    "exploitation",
    "flaw",
    "patch",
    "patched",
  ],
  Ransomware: ["ransomware", "malware", "trojan", "computer worm", "ransom"],
  Breaches: [
    "breach",
    "breached",
    "data leak",
    "leaked",
    "leak",
    "compromise",
    "compromised",
    "unauthorized access",
  ],
  Advisories: ["advisory", "advisories", "security bulletin", "warns", "warning"],
  "Threat Intelligence": [
    "APT",
    "threat actor",
    "threat group",
    /\bTA\d{1,5}\b/i,
    "state-sponsored",
    "nation-state",
    "campaign",
    "malicious actor",
  ],
  "Tools/Techniques": ["tool", "technique", "framework", "methodology", "defense", "detection"],
};
