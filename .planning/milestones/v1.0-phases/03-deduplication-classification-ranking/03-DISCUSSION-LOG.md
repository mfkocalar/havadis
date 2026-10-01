# Phase 3: Deduplication, Classification & Ranking - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-23
**Phase:** 3-Deduplication, Classification & Ranking
**Areas discussed:** Dedupe strictness, Rule order & keyword breadth, Ranking formula, CVE chip & interim sections (+ pagination question)

---

## Dedupe strictness

| Option | Description | Selected |
|--------|-------------|----------|
| Normalized title OR url | Canonical URL match or normalized-title match; deterministic | ✓ |
| Normalized + fuzzy title similarity | Token-overlap threshold; catches more, risks false merges | |
| Literal (title, url) pair only | NORM-02 literal; catches almost nothing cross-outlet | |

| Option | Description | Selected |
|--------|-------------|----------|
| Earliest published | Credit who broke it; tie-break by source weight | ✓ |
| Highest source weight | Most authoritative copy | |
| Longest/richest summary | Most context | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| No, silently collapse | Matches NORM-02 and D-05 | ✓ |
| Yes, small '+N sources' note | New card element | |

| Option | Description | Selected |
|--------|-------------|----------|
| Decode entities in displayed title | Fixes `&trade;` blocker; not an editorial rewrite | ✓ |
| Only in the dedupe key | Display stays byte-for-byte | |

---

## Rule order & keyword breadth

| Option | Description | Selected |
|--------|-------------|----------|
| Specificity order | Specific rules first; separate from display order | ✓ |
| Urgency/display order | One ordering concept | |
| Reference repo config order | Threat Intel swallows most | |

| Option | Description | Selected |
|--------|-------------|----------|
| Title first, then summary | Headline strongest signal | ✓ |
| Title + summary combined | More incidental matches | |
| Title only | More fall to default | |

| Option | Description | Selected |
|--------|-------------|----------|
| Port, then tune against live data | Word boundaries, prune broad terms, document deviations | ✓ |
| Verbatim port | Traceable but noisy | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| No, keywords only for every source | Uniform path | ✓ |
| CISA → Advisories by default | Fallback override | |
| CISA always → Advisories | Hard override | |

---

## Ranking formula

| Option | Description | Selected |
|--------|-------------|----------|
| Recency decay × source weight | Multiplicative score | ✓ |
| Recency-dominant, weight as tiebreak | | |
| Weight-dominant tier buckets | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Per-tier weights | One weight per SourceTier | ✓ |
| Per-source weights | 13 numbers | |
| Per-tier with per-source override | | |

| Option | Description | Selected |
|--------|-------------|----------|
| No boost for v1 | Two inputs only | ✓ |
| Small multiplier per extra source | | |

| Option | Description | Selected |
|--------|-------------|----------|
| No diversity rule | Pure score order | ✓ |
| Soft diversity penalty | | |
| You decide | | |

---

## CVE chip & interim sections

| Option | Description | Selected |
|--------|-------------|----------|
| Up to 3 chips, then '+N' | Handles Patch Tuesday roundups | ✓ |
| One chip per unique CVE, no cap | | |
| Single chip only | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Link to NVD detail page | URL built from regex-validated ID | ✓ |
| Link to cve.org record | | |
| Plain label, not a link | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Meta row, next to the tier badge | Red, same pill shape, monospace | ✓ |
| Below the summary | | |
| You decide (UI-SPEC) | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal stacked sections | Plain headings, single column, skip empty | ✓ |
| Data only, no UI change | | |
| Section label on each card | | |

| Option | Description | Selected |
|--------|-------------|----------|
| REQUIREMENTS/ROADMAP order | Vulns → Advisories → Ransomware → Breaches → TI → Tools → Industry | ✓ |
| PROJECT.md order | Conflicting Active-line order | |

**Notes:** Found a real conflict between PROJECT.md's Active line and CLASSIFY-03. User confirmed the REQUIREMENTS order; PROJECT.md is to be corrected.

---

## Pagination (user-raised)

User asked: "do we have any plan for pagination?" Answer: none planned; infinite scroll is explicitly out of scope.

| Option | Description | Selected |
|--------|-------------|----------|
| Defer to Phase 4: per-section cap + 'show more' | Client-side expander over the rendered snapshot | ✓ |
| Defer to Phase 4, undecided | | |
| No pagination at all | | |

## Claude's Discretion

- Decay function/constant and numeric tier weights
- Tuned keyword lists and adjacent-rule reordering (validated against live data)
- Tracking-param strip list, module layout, type extensions, entity decoder choice

## Deferred Ideas

- Pagination / per-section cap + "Show all" → Phase 4
- Fuzzy dedupe (rejected for v1)
- Multi-outlet boost / "also reported by" (rejected for v1)
