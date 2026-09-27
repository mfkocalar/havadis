import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, keywordToRegExp } from "./classify.ts";
import {
  CLASSIFICATION_ORDER,
  DEFAULT_SECTION,
  SECTION_DISPLAY_ORDER,
  SECTION_KEYWORDS,
} from "../config/sections.ts";
import { SOURCES } from "../config/sources.ts";
import type { Section } from "../types.ts";

/**
 * Hermetic fixture tests for classify.ts / sections.ts (CLASSIFY-01, D-05
 * through D-08). Every fixture title below is either a hand-built edge case
 * or lifted verbatim from the live 2026-09-23 snapshot recorded in
 * 03-RESEARCH.md's "Live Taxonomy Validation" / Pitfall 3 / Pitfall 4
 * sections. No wall clock, no network — classify() is a pure function of
 * title and summary.
 */

test("D-05 specificity: Vulnerabilities is evaluated before Ransomware and Breaches", () => {
  assert.equal(
    classify({ title: "Microsoft patches CVE-2026-0001 in Windows", summary: "" }),
    "Vulnerabilities"
  );
  assert.equal(
    classify({ title: "Ransomware gang exploits zero-day in VPN appliances", summary: "" }),
    "Vulnerabilities",
    "Vulnerabilities must win even though the title also literally contains the word Ransomware"
  );
  assert.equal(
    classify({ title: "Ransomware attack leaks patient records", summary: "" }),
    "Ransomware",
    "Ransomware must be evaluated before Breaches"
  );
});

test("D-06: title is tried before summary, over the full CLASSIFICATION_ORDER each pass", () => {
  assert.equal(
    classify({
      title: "Retailer confirms data breach",
      summary: "Attackers abused CVE-2026-1111.",
    }),
    "Breaches",
    "a title match must win even when the summary matches an earlier-order rule"
  );
  assert.equal(
    classify({
      title: "Weekly security roundup",
      summary: "A new ransomware strain hit hospitals.",
    }),
    "Ransomware",
    "with no title match, the summary is tried next"
  );
  assert.equal(classify({ title: "Company appoints new CISO", summary: "" }), "Industry/Policy");
  assert.equal(classify({ title: "", summary: "" }), "Industry/Policy");
});

test("D-07: word-boundary keyword matching rejects a substring embedding (tool inside toolkit)", () => {
  assert.equal(
    classify({ title: "Vendor ships new toolkit for developers", summary: "" }),
    "Industry/Policy"
  );
  assert.equal(
    classify({ title: "Open-source tools for defenders released", summary: "" }),
    "Tools/Techniques"
  );
});

test("D-07 Pitfall 3: computer worm is narrowed from the bare word worm — a biology headline never classifies as Ransomware", () => {
  assert.equal(
    classify({
      title: "Woman's brain worm infection confirmed after eggs grow tails in lab test",
      summary: "",
    }),
    "Industry/Policy"
  );
  assert.equal(
    classify({ title: "New computer worm spreads through USB drives", summary: "" }),
    "Ransomware"
  );
});

test("D-07: pruned single generic words never fire a classification rule", () => {
  const prunedFixtures = [
    "Board-level threat modeling gains traction",
    "Attack surface management market grows",
    "Incident response retainers get pricier",
    "Encrypted messaging app adds usernames",
    "Regulators recommend stronger MFA",
    "Weather alert system upgraded",
  ];
  for (const title of prunedFixtures) {
    assert.equal(
      classify({ title, summary: "" }),
      "Industry/Policy",
      `expected "${title}" to fall through to the default bucket`
    );
  }
});

test("D-07: bare malicious is narrowed to the phrase malicious actor", () => {
  assert.notEqual(
    classify({ title: "Malicious npm package found", summary: "" }),
    "Threat Intelligence"
  );
  assert.equal(
    classify({ title: "North Korean threat actors target crypto firms", summary: "" }),
    "Threat Intelligence"
  );
});

test("case-insensitivity and the bounded TA pattern", () => {
  assert.equal(classify({ title: "ZERO-DAY IN BROWSER PATCHED", summary: "" }), "Vulnerabilities");
  assert.equal(classify({ title: "cve-2026-4321 disclosed", summary: "" }), "Vulnerabilities");
  assert.equal(
    classify({ title: "TA505 resurfaces with new loader", summary: "" }),
    "Threat Intelligence"
  );
  assert.equal(
    classify({ title: "Tata Motors reports record sales", summary: "" }),
    "Industry/Policy",
    "the bounded \\bTA\\d{1,5}\\b pattern must not match Tata"
  );
  assert.equal(
    classify({ title: "Siemens publishes security bulletin for SCADA", summary: "" }),
    "Advisories"
  );
  assert.equal(classify({ title: "FBI warns of fake recruiters", summary: "" }), "Advisories");
});

test("plural tolerance on live-observed titles (2026-09-23 snapshot)", () => {
  assert.equal(
    classify({
      title: "Webinar tomorrow: Inside real-world Google Workspace breaches",
      summary: "",
    }),
    "Breaches"
  );
  assert.equal(
    classify({
      title: "Chinese hackers exploit WordPress, Zyxel flaws to steal govt data",
      summary: "",
    }),
    "Vulnerabilities"
  );
  assert.equal(classify({ title: "Microsoft fixes three zero-days", summary: "" }), "Vulnerabilities");
});

test("D-08: CISA gets no source-based override — every source travels the same keyword path", () => {
  assert.equal(
    classify({ title: "CISA Releases Secure by Design Pledge Progress Report", summary: "" }),
    "Industry/Policy"
  );
  assert.equal(
    classify({ title: "CISA Adds Four Known Exploited Vulnerabilities to Catalog", summary: "" }),
    "Vulnerabilities"
  );

  const allowedKeys = new Set(["id", "name", "tier", "url", "allowHtmlContentType"]);
  for (const source of SOURCES) {
    for (const key of Object.keys(source)) {
      assert.ok(
        allowedKeys.has(key),
        `expected ${source.id}'s key "${key}" to be one of id/name/tier/url/allowHtmlContentType — no source gets a default-section override (D-08)`
      );
    }
  }
});

test("Pitfall 4: the ShinyHunters/FBI cluster classifies as Breaches under both outlets' wording", () => {
  assert.equal(
    classify({
      title: "ShinyHunters Claims FBI Breach, Says It Stole Data on Agents and Job Applicants",
      summary: "",
    }),
    "Breaches"
  );
  assert.equal(
    classify({
      title:
        "Hacking group ShinyHunters claims it breached the FBI, stole agents' and applicants' data",
      summary: "",
    }),
    "Breaches"
  );
});

test("classify is deterministic across repeated calls on the same input", () => {
  const input = { title: "Ransomware gang exploits zero-day in VPN appliances", summary: "" };
  const first = classify(input);
  const second = classify(input);
  const third = classify(input);
  assert.equal(first, second);
  assert.equal(second, third);
});

test("every RegExp entry in SECTION_KEYWORDS carries neither the global nor the sticky flag", () => {
  for (const patterns of Object.values(SECTION_KEYWORDS)) {
    for (const pattern of patterns) {
      if (pattern instanceof RegExp) {
        assert.equal(pattern.global, false, `${pattern} must not carry the g flag`);
        assert.equal(pattern.sticky, false, `${pattern} must not carry the y flag`);
      }
    }
  }
});

test("classify handles a 100,000-character adversarial title in under 500ms (ReDoS safety, T-03-01)", () => {
  const adversarial = "a".repeat(50_000) + " CVE-1111-2222 " + "b".repeat(50_000);
  const start = performance.now();
  const result = classify({ title: adversarial, summary: "" });
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 500, `expected classification to finish in under 500ms, took ${elapsed}ms`);
  assert.ok(SECTION_DISPLAY_ORDER.includes(result));
});

test("every fixture classification result is a member of SECTION_DISPLAY_ORDER", () => {
  const fixtures: Array<{ title: string; summary: string }> = [
    { title: "Microsoft patches CVE-2026-0001 in Windows", summary: "" },
    { title: "Ransomware attack leaks patient records", summary: "" },
    { title: "Company appoints new CISO", summary: "" },
    { title: "", summary: "" },
    { title: "TA505 resurfaces with new loader", summary: "" },
    { title: "Tata Motors reports record sales", summary: "" },
  ];
  for (const fixture of fixtures) {
    assert.ok(SECTION_DISPLAY_ORDER.includes(classify(fixture)));
  }
});

test("CLASSIFICATION_ORDER plus DEFAULT_SECTION covers exactly the 7 display sections; the two order constants are different sequences", () => {
  const combined = new Set<Section>([...CLASSIFICATION_ORDER, DEFAULT_SECTION]);
  assert.deepEqual(
    [...combined].sort(),
    [...SECTION_DISPLAY_ORDER].sort(),
    "CLASSIFICATION_ORDER + DEFAULT_SECTION must cover exactly the 7 display sections"
  );
  assert.notDeepEqual(
    CLASSIFICATION_ORDER,
    SECTION_DISPLAY_ORDER,
    "evaluation order and display order must stay two separate sequences (D-05)"
  );
});

test("keywordToRegExp: word-bounded, plural-tolerant matching", () => {
  assert.ok(keywordToRegExp("CVE-").test("CVE-2026-87902"));
  assert.ok(!keywordToRegExp("tool").test("toolkit"), "tool must not match inside toolkit");
  assert.ok(keywordToRegExp("tool").test("tools"), "tool must match its plural, tools");
  assert.ok(keywordToRegExp("patch").test("patches"), "patch must match its plural, patches");
  assert.ok(!keywordToRegExp("leak").test("leakage"), "leak must not match inside leakage");
});
