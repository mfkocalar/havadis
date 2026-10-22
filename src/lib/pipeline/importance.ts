import type { Article, Importance, Section } from "../types.ts";

/**
 * Scores how urgently a security reader needs to see an article: "critical",
 * "high" or "normal", plus the human-readable signal that set the level (shown
 * on the card, so a reader can see why something is flagged rather than trust
 * an opaque score).
 *
 * Rules are evaluated strongest first and the first match wins. Every pattern
 * is word-bounded with bounded quantifiers only (ReDoS-safe, like
 * `keywordToRegExp`). The text searched is the title plus the capped summary,
 * so the cost is bounded by `SUMMARY_MAX_CHARS`.
 *
 * Critical means "act today": exploitation is happening now, or an authority
 * has issued an emergency instruction. High means "plan for it": a concrete
 * vulnerability, a critical-severity flaw, or a live ransomware/breach event.
 * Section alone raises the level only for Breaches (see below); a calm
 * Vulnerabilities explainer stays normal, and a CVE in an Industry/Policy story
 * still reads as high.
 */

type Rule = { pattern: RegExp; reason: string };

const CRITICAL_RULES: readonly Rule[] = [
  { pattern: /\b(?:actively|being|widely) exploited\b|\bexploited in the wild\b|\bin-the-wild exploit/i, reason: "Actively exploited" },
  { pattern: /\bunder (?:active )?attack\b|\bmass[- ]exploitation\b|\bexploit(?:ation)? attempts?\b/i, reason: "Actively exploited" },
  { pattern: /\bzero[- ]days?\b|\b0[- ]?days?\b/i, reason: "Zero-day" },
  { pattern: /\bknown exploited vulnerabilit(?:y|ies)\b|\bKEV\b/, reason: "CISA KEV" },
  { pattern: /\bemergency (?:directive|patch|update|fix)(?:e?s)?\b|\bpatch (?:now|immediately)\b/i, reason: "Emergency patch" },
];

const HIGH_RULES: readonly Rule[] = [
  { pattern: /\bcritical (?:flaw|bug|vulnerabilit(?:y|ies)|severity|security update|update)s?\b|\bCVSS(?: score)?(?: of)? (?:9|10)(?:\.\d)?\b/i, reason: "Critical severity" },
  { pattern: /\bremote code execution\b|\bRCE\b|\bauthentication bypass\b|\bauth bypass\b/i, reason: "Remote compromise" },
  { pattern: /\bproof[- ]of[- ]concept\b|\bPoC (?:exploit|released|published)\b|\bexploit (?:code|released|published)\b/i, reason: "Public exploit" },
  { pattern: /\bsupply[- ]chain (?:attack|compromise)s?\b/i, reason: "Supply-chain attack" },
  { pattern: /\bransomware\b/i, reason: "Ransomware" },
];

export type ImportanceResult = { importance: Importance; reason: string | null };

export function scoreImportance(
  article: Pick<Article, "title" | "summary">,
  section: Section,
  cves: readonly string[],
): ImportanceResult {
  const text = `${article.title}\n${article.summary}`;

  for (const rule of CRITICAL_RULES) {
    if (rule.pattern.test(text)) return { importance: "critical", reason: rule.reason };
  }
  for (const rule of HIGH_RULES) {
    if (rule.pattern.test(text)) return { importance: "high", reason: rule.reason };
  }
  if (cves.length > 0) {
    return { importance: "high", reason: cves.length === 1 ? "CVE assigned" : `${cves.length} CVEs` };
  }
  // The Breaches section is keyed on compromise/leak wording, so membership is
  // itself the incident signal. The Ransomware section is not: it also holds
  // general malware stories, which only rise on the ransomware rule above.
  if (section === "Breaches") {
    return { importance: "high", reason: "Breach" };
  }
  return { importance: "normal", reason: null };
}
