# Phase 2: Full Ingestion & Failure Isolation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-21
**Phase:** 2-Full Ingestion & Failure Isolation
**Areas discussed:** Source-tier badge colors, Silent degradation reconfirmed

---

## Source-tier badge colors

| Option | Description | Selected |
|--------|-------------|----------|
| Claude picks a cohesive palette | Full 6-color Tailwind palette matching the existing indigo pill's style; no semantic meaning between tiers | ✓ |
| Semantic mapping | Colors carry meaning (e.g. Government gets an "official" blue); Claude proposes with rationale | |
| You specify exact colors | User names specific colors/Tailwind tokens per tier | |

**User's choice:** Claude picks a cohesive palette.

| Option | Description | Selected |
|--------|-------------|----------|
| Avoid red/orange | Keep reserved for CVE chips (Phase 3) / urgency cues (Phase 4) | ✓ |
| No restrictions | Pick whatever set reads best; resolve conflicts later | |

**User's choice:** Avoid red/orange.

| Option | Description | Selected |
|--------|-------------|----------|
| All equal weight | Same pill size/shape/weight across all 6 tiers, color-only differentiation | ✓ |
| Government stands out | CISA/Government tier gets bolder styling for institutional weight | |

**User's choice:** All equal weight.

| Option | Description | Selected |
|--------|-------------|----------|
| Keep indigo locked | Security Research's shipped Phase 1 color stays as-is; other 5 complement it | ✓ |
| Open to changing it | All 6 colors treated as up for revision together | |

**User's choice:** Keep indigo locked.

**Notes:** None — all four answers took the recommended option.

---

## Silent degradation, reconfirmed

| Option | Description | Selected |
|--------|-------------|----------|
| Still fully invisible | A quiet source and a broken source look identical — no per-source signal anywhere | ✓ |
| Add a minimal, non-diagnostic signal | Something short of HEALTH-01 (e.g. an "N sources reporting" note) | |

**User's choice:** Still fully invisible.

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse the same quiet empty state | Total outage (all 13 fail) reuses Phase 1's D-03 message verbatim | ✓ |
| Something different for total outage | A distinct non-diagnostic message specifically for the all-failed case | |

**User's choice:** Reuse the same quiet empty state.

| Option | Description | Selected |
|--------|-------------|----------|
| Any success renders | No minimum article-count floor; even a single article from one source renders normally | ✓ |
| Something else | User describes a different rule | |

**User's choice:** Any success renders.

**Notes:** User confirmed HEALTH-01's v2 deferral holds even with 13 sources of real, uneven posting cadence — not just an untested Phase-1-scale assumption.

---

## Claude's Discretion

- Combined article-list ordering for the interim flat list before Phase 3 builds real classification + ranking (user explicitly declined to discuss this area when selecting gray areas).
- Exact hex/Tailwind color tokens for the 5 remaining tier badges, within the constraints agreed above.
- CISA's specific posting cadence and any feed-format quirks — technical/research concern, not a product decision.
- Parallel-fetch mechanism and any concurrency staggering for the 13-source fan-out.
- Per-source timeout uniformity (default ~8s from Phase 1) unless a specific source's real-world latency demands otherwise.

## Deferred Ideas

None new. HEALTH-01 remains a tracked v2 requirement, not scheduled into the current roadmap.
