# Phase 4: Newspaper Front Page, Filtering & Mobile Polish - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-30
**Phase:** 4-Newspaper Front Page, Filtering & Mobile Polish
**Areas discussed:** Section layout upgrade, Section length / 'show more', Filter mechanism (FILTER-01), Freshness & count metadata (UI-04)

---

## Section layout upgrade

| Question | Options | Selected |
|----------|---------|----------|
| Desktop layout per section | Multi-column grid / Single wide column / Featured + grid hybrid | Multi-column grid |
| Column counts | 3→2→1 / 2→1 / You decide | 3→2→1 |
| Page max width | Widen to 6xl/7xl / Keep 4xl / You decide | Widen to 6xl/7xl |
| Sparse sections | Leave the gap / Stretch to fill / You decide | Leave the gap |

**User's choice:** All recommended options.
**Notes:** Masthead must widen with the page shell.

---

## Section length / 'show more'

| Question | Options | Selected |
|----------|---------|----------|
| Cap behavior | Cap + expander / Show everything / You decide | Cap + "Show all N" expander |
| Cap size | 6 / 9 / You decide | 6 |
| Tiny overflow | Render all when overflow tiny / Strict cap / You decide | Render all when overflow tiny |
| Hidden cards | All in HTML, toggle client-side / Render on click / You decide | All in HTML |

**User's choice:** All recommended options.

---

## Filter mechanism (FILTER-01)

| Question | Options | Selected |
|----------|---------|----------|
| Control | Toggle pills / Checkbox list / Dropdown | Toggle pills |
| Zero selected | Show all / All start selected / You decide | Show all |
| Persistence | None / URL sync / You decide | None |
| Placement | Sticky bar below masthead / Static above sections / You decide | Sticky bar |

**User's choice:** All recommended options.

---

## Freshness & count metadata (UI-04)

| Question | Options | Selected |
|----------|---------|----------|
| Last updated location | Sticky filter bar / Masthead sub-line / You decide | Sticky filter bar |
| Time format | Relative + absolute on hover / Absolute only / You decide | Relative + absolute on hover |
| Count display | Muted number by heading / Only in expander / You decide | Muted number by heading (also on pills) |

**User's choice:** All recommended options.
**Notes:** Relative-time staleness under ~15 min caching flagged for the planner (D-13).

---

## Claude's Discretion

Container width (6xl vs 7xl), tiny-overflow threshold, client/server split, filter-expander interaction, sticky bar styling and mobile compaction, UI-05 verification method, pill/expander accessibility details.

## Deferred Ideas

URL-synced filter state, featured lead-story card, stretch-to-fill sparse sections.
