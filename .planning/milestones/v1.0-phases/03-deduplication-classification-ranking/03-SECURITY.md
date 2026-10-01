---
phase: "03"
slug: "deduplication-classification-ranking"
status: verified
threats_open: 0
asvs_level: 1
created: "2026-09-29"
---

# Phase 03 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|----------------|
| external feed origin -> Vercel Function | Untrusted `title`, `summary`, `link` and `publishedAt` now drive classification (keyword regexes), dedupe-key construction, entity decoding, CVE extraction, and ranking arithmetic, not just display. | Feed-controlled text and dates |
| Vercel Function -> rendered HTML | Section names/emoji enter `<h2>` text and a `data-section` attribute; decoded titles enter JSX text nodes; extracted CVE IDs enter chip text AND an outbound `href`. | Article title/summary text, CVE IDs |
| pipeline stages -> `getFrontPage` never-throws contract | A throw in any new stage (classify, dedupe, decode, extract, rank) would collapse the whole page to the empty state. | Control flow only |
| rendered page -> nvd.nist.gov | A new outbound navigation target opened in a new tab. | CVE ID in URL path |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-03-01 | Denial of Service | `classify.ts` keyword regexes vs. unbounded feed titles (ReDoS) | medium | mitigate | Escaped literals compiled once at module scope, only bounded quantifiers used; `classify.test.ts:210` asserts a 100,000-char adversarial title classifies in <500ms. | closed |
| T-03-02 | Denial of Service | a throw inside classify/groupBySection/rankWithinSection collapsing the page to empty state | high | mitigate | All new stages are total pure functions (empty string -> default section, empty bucket skipped, unparseable date -> score 0). `rank.test.ts:88-93` and `groupBySection.test.ts:54,61` cover empty/malformed-date inputs; still wrapped by `getFrontPage`'s single `try`. | closed |
| T-03-03 | Tampering | ranking manipulation via a far-future `publishedAt` pinning an item to the top | medium | mitigate | `recencyDecay` clamps age with `Math.max(0, ageMs)` before exponentiation (confirmed present in `ranking.ts`); rank tests assert future-dated items score like `now`. | closed |
| T-03-04 | Information Disclosure | scores/matched keywords/diagnostic strings leaking into rendered HTML | low | mitigate | `page.tsx` renders only the section name and the constant `SECTION_EMOJI` map, branching on the discriminant only (confirmed: `page.tsx:3,47,51`). | closed |
| T-03-05 | Tampering | feed text reaching the heading or `data-section` attribute | low | mitigate | Heading text and attribute value come only from the constant `Section` union and `SECTION_EMOJI` map, never feed fields; React escapes attributes regardless. | closed |
| T-03-SC | Tampering | npm/pip/cargo installs (03-01) | n/a | accept | No package-manager install task in this plan; zero new packages on the primary path. | accepted |
| T-03-06 | Tampering (stored XSS) | entity-decoded title turning `&lt;script&gt;` into literal markup | high | mitigate | Decoded string is only ever a plain JSX text child (`ArticleCard.tsx`); confirmed zero `dangerouslySetInnerHTML` anywhere under `src/`. Decode tests pin single-pass, text-only decoding. | closed |
| T-03-07 | Tampering | canonical dedupe key bypassing normalize's http(s)-only check | medium | mitigate | `canonicalizeUrl`'s output is used only as a Map key; `dedupe.ts` returns original article objects unmodified — confirmed by `dedupe.test.ts:195` (reference identity, unchanged `url`) and `:237` (input array not mutated). | closed |
| T-03-08 | Spoofing | a hostile/compromised feed publishing a matching title with an earlier `publishedAt` to displace a legitimate outlet's copy | low | accept | Sources are a fixed, curated, build-time list of 13 publishers; earliest-wins is a documented product decision (D-02); the displaced story still renders. | accepted |
| T-03-09 | Denial of Service | decode/dedupe-key regexes vs. unbounded feed titles | medium | mitigate | Bounded quantifiers only; `decodeHtmlEntities.test.ts:75` asserts a 200,000-char input decodes in <500ms. | closed |
| T-03-10 | Denial of Service | `new URL()` throwing on a malformed link inside dedupe | medium | mitigate | `canonicalizeUrl.ts` wraps parsing in try/catch (confirmed lines 61-63), falling back to the trimmed raw string; `getFrontPage`'s outer `try` remains the last line of defence. | closed |
| T-03-SC | Tampering | npm/pip/cargo installs (03-02) | n/a | accept | No package-manager install task; hand-rolled entity decoder, `entities` package deliberately not installed. | accepted |
| T-03-11 | Tampering | chip `href` built from feed-controlled text (open redirect, `javascript:`, attribute injection) | high | mitigate | IDs come only from `CVE_PATTERN` matches; `nvdUrl` re-validates against anchored `^CVE-\d{4}-\d{4,7}$` (confirmed `cveChips.ts:20,30-31`), returns `null` otherwise; href is the constant NVD base plus validated ID only. | closed |
| T-03-12 | Tampering (reverse tabnabbing) | chip anchors opening in a new tab | medium | mitigate | Every chip carries `rel="noopener noreferrer"` with `target="_blank"` — confirmed `CveChips.tsx:40-41`. | closed |
| T-03-13 | Information Disclosure | referrer leakage of the Havadis URL to NVD | low | mitigate | `noreferrer` suppresses the Referer header (same attribute as T-03-12); page carries no user data regardless. | closed |
| T-03-14 | Denial of Service | CVE regex vs. unbounded feed titles | low | mitigate | Fixed prefix and bounded quantifiers; `extractCves.test.ts:101-107` asserts a 100,000-char input completes in <500ms. | closed |
| T-03-15 | Repudiation / misleading display | a 4th CVE hidden by the summary cap or folded into "+N" | low | accept | Accepted per D-13: a chip always corresponds to text the reader can reach; "+N" states more IDs exist; scanning uncapped text is explicitly prohibited. | accepted |
| T-03-SC | Tampering | npm/pip/cargo installs (03-03) | n/a | accept | No package-manager install task; no dependency added. | accepted |

*Status: open · closed · open — below {block_on} threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|--------------|------|
| AR-03-01 | T-03-08 | Fixed, curated, build-time source list (13 publishers); earliest-wins dedupe tiebreak is a documented product decision (D-02); displaced story still renders, only attribution changes. Revisit if sources become runtime-configurable. | Developer (03-02-PLAN.md) | 2026-09-28 |
| AR-03-02 | T-03-15 | Summary-cap-hidden 4th CVE ID is a documented Phase 2 D-08 consequence; chip always corresponds to reachable text; "+N" discloses that more IDs exist. | Developer (03-03-PLAN.md, D-13) | 2026-09-28 |
| AR-03-03 | T-03-SC (x3) | No package-manager installs in any of the three plans; zero new dependencies added this phase. | Developer (all three plans) | 2026-09-28 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-29 | 18 | 12 closed, 6 accepted | 0 | Claude (gsd-secure-phase, L1 grep-depth — register authored at plan time, threats_open:0, asvs_level:1 short-circuit) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-29
