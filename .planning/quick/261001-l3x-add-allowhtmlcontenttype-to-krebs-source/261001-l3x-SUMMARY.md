---
status: complete
quick_id: 261001-l3x
date: 2026-10-01
---

# Quick Task 261001-l3x: Krebs allowHtmlContentType

## Outcome

The requested code fix was already in the repo: `allowHtmlContentType: true` is set on the `krebs` entry in `src/lib/config/sources.ts`, added by commit `da6dbba` (2026-09-27, already on `main`). The milestone-close audit flagged the Phase 3 deferred item only because the docs were stale.

## Done (docs only, per user choice)

- Phase 3 `deferred-items.md`: the 03-01 Task 1 Krebs entry is now `Status: resolved`, citing `da6dbba`. The audit no longer lists it.
- `.planning/PROJECT.md` Key Decisions row: corrected "zero sources currently need it" to "only `krebs` opts in".

## Not done (declined by user)

The planner's hermetic regression tests (`fetchSource.test.ts` gate tests, and a `sources.test.ts` pin of the opted-in set) were not run. `261001-l3x-PLAN.md` describes them if wanted later. No source code changed.
