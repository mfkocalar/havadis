import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreImportance } from "./importance.ts";

/**
 * Unit tests for importance.ts: strongest rule first, first match wins, and
 * section alone never raises the level except for live-incident sections.
 */

function score(title: string, summary = "", section: Parameters<typeof scoreImportance>[1] = "Industry/Policy", cves: string[] = []) {
  return scoreImportance({ title, summary }, section, cves);
}

test("active exploitation is critical", () => {
  assert.deepEqual(score("Hackers Exploit Siemens Flaw", "the vulnerability is being actively exploited"), {
    importance: "critical",
    reason: "Actively exploited",
  });
  assert.equal(score("Bug exploited in the wild").importance, "critical");
});

test("zero-day spellings are critical", () => {
  for (const t of ["Chrome zero-day patched", "New zero day in Exchange", "Two 0-days fixed", "0day market"]) {
    assert.equal(score(t).reason, "Zero-day", t);
  }
});

test("CISA KEV is case-sensitive so the word 'kev' in prose never matches", () => {
  assert.equal(score("CISA adds three flaws to KEV catalog").reason, "CISA KEV");
  assert.equal(score("Kev Smith on security").importance, "normal");
});

test("a critical rule beats a high rule in the same text", () => {
  assert.equal(score("Critical RCE flaw actively exploited").importance, "critical");
});

test("critical severity, RCE and public exploits are high", () => {
  assert.deepEqual(score("Critical flaw in Fortinet"), { importance: "high", reason: "Critical severity" });
  assert.equal(score("Bug scores CVSS 9.8").reason, "Critical severity");
  assert.equal(score("Node.js bug could allow remote code execution").reason, "Remote compromise");
  assert.equal(score("PoC exploit released for Citrix bug").reason, "Public exploit");
});

test("a CVE alone is high, and the reason counts multiple CVEs", () => {
  assert.equal(score("Patch notes", "", "Vulnerabilities", ["CVE-2026-1"]).reason, "CVE assigned");
  assert.equal(score("Patch notes", "", "Vulnerabilities", ["CVE-2026-1", "CVE-2026-2"]).reason, "2 CVEs");
});

test("the Breaches section is high; Ransomware-section malware without the word stays normal", () => {
  assert.equal(score("Retailer leaks data", "", "Breaches").reason, "Breach");
  assert.equal(score("Lazarus uses new loader", "", "Ransomware").importance, "normal");
  assert.equal(score("Akira ransomware hits hospital", "", "Ransomware").reason, "Ransomware");
  assert.deepEqual(score("How we think about patching", "", "Vulnerabilities"), { importance: "normal", reason: null });
});

test("attack-in-progress wording and plural emergency patches are critical", () => {
  assert.equal(score("Critical PHP flaws were under attack days before patches").reason, "Actively exploited");
  assert.equal(score("PHP patches flaws as exploit attempts begin").reason, "Actively exploited");
  assert.equal(score("Two critical PHP flaws as emergency patches arrive").reason, "Emergency patch");
});

test("supply-chain attacks are high", () => {
  assert.equal(score("LiteLLM hit in supply chain attack").reason, "Supply-chain attack");
});

test("the word 'critical' on its own is not a severity signal", () => {
  assert.equal(score("Critical thinking for SOC teams").importance, "normal");
});
