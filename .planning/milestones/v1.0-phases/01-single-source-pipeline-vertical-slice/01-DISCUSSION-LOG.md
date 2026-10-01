# Phase 1: Single-Source Pipeline (Vertical Slice) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-15
**Phase:** 1-Single-Source Pipeline (Vertical Slice)
**Areas discussed:** Source pick, Visual style, Empty/fail state, Tier badge

---

## Source pick

| Option | Description | Selected |
|--------|-------------|----------|
| Krebs on Security | Security Research tier. Simple, well-formed RSS, frequent posts (good for demoing the 24h lookback + relative-time behavior). Research flags it needs a browser-like User-Agent (Cloudflare-fronted). | ✓ |
| Bleeping Computer | Threat Intelligence tier. High-volume, reliably live feed — good density to prove pagination/card rendering isn't sparse. | |
| CISA Alerts | Government tier, mentioned as the architecture doc's example. Lower post frequency, extra XML/UA quirks — a slightly harder first source to debug against. | |
| Dark Reading | Enterprise Security tier. Standard RSS, moderate volume, no known anti-bot flags — lower-friction pick if minimizing feed-specific quirks. | |

**User's choice:** Krebs on Security
**Notes:** Chosen over CISA (the architecture doc's example) specifically to avoid debugging XML/UA quirks in the first source; the Cloudflare/User-Agent mitigation Krebs needs is already documented in PITFALLS.md and should be built in from this phase.

---

## Visual style

| Option | Description | Selected |
|--------|-------------|----------|
| Classic broadsheet | Serif headlines, dense text, muted ink-like palette, thin rule lines — leans into the literal "newspaper" metaphor. | |
| Modern editorial | Sans-serif headlines, generous whitespace, card-based layout with subtle shadows — reads like a modern tech-news site (TechCrunch/The Verge). | ✓ |
| Terminal/security-tool aesthetic | Monospace accents, dark background, sharp corners — signals "built for security practitioners" over a general news reader. | |

**User's choice:** Modern editorial
**Notes:** Establishing decision for the whole app's visual direction (not just Phase 1) — future components should follow this direction unless revisited explicitly.

---

## Empty/fail state

| Option | Description | Selected |
|--------|-------------|----------|
| Quiet empty-state message (Recommended) | Page still renders (masthead, layout) with a plain "No articles in the last 24 hours" message — matches Pitfall 9/UX guidance to avoid a blank/broken-looking page. | ✓ |
| Skeleton/loading-style placeholder | Show a greyed-out placeholder card shape instead of a text message — implies "still catching up" rather than "nothing happened." | |
| Minimal — just an empty section, no message | Simplest to build; the section header still shows but no explanatory copy underneath if empty. | |

**User's choice:** Quiet empty-state message (Recommended)
**Notes:** Applies uniformly to both "source failed/timed out" and "source succeeded but zero articles in 24h window" — no separate error-vs-empty UI needed in Phase 1.

---

## Tier badge

| Option | Description | Selected |
|--------|-------------|----------|
| Colored text label | Small colored text/pill per tier next to the source name — clear at a glance, scales to all 6 tiers without icon design work. | ✓ |
| Plain text, no color coding | Just the tier name as plain small text — simplest, avoids picking/maintaining a 6-color palette this early. | |
| Icon + label | A small icon paired with the tier name — most visually distinct but adds icon-sourcing/design work in phase 1. | |

**User's choice:** Colored text label
**Notes:** Only the Security Research tier's color needs to be picked now (only Krebs is wired up in Phase 1); the rest of the 6-tier palette can be filled in as more sources are added in Phase 2, or finalized in Phase 4 polish.

---

## Claude's Discretion

- Exact accent color values, spacing scale, and typography choices within "Modern editorial"
- Whether Phase 1 shows a generic single section header (e.g. "Latest") or no header above the flat article list
- Mechanism for absolute-time-on-hover (native `title` attribute vs. custom tooltip)
- Full 6-tier badge color palette beyond Security Research

## Deferred Ideas

- Per-source health/diagnostics indicator ("1 source unavailable") — this is REQUIREMENTS.md's HEALTH-01, already an explicit v2 requirement, not raised as new scope creep here but reaffirmed as out of scope for v1.
