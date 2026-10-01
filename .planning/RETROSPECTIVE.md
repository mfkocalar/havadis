# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-10-01
**Phases:** 4 | **Plans:** 14

### What Was Built
- A static, 900s-revalidated Next.js 16 front page fed by 13 RSS/Atom sources through a failure-isolated parallel fan-out.
- Normalization, deduplication (canonical URL or normalized title), keyword classification into 7 urgency-ordered sections, tier-weighted recency ranking, and NVD-linked CVE chips.
- A newspaper layout with sticky count-bearing section pills, client-side filtering with no new fetch, an honest "Updated" clock, and per-section caps with "Show all N".

### What Worked
- Vertical-slice phases: each phase shipped something real, and hermetic fixtures proved failure branches that live traffic never exercises.
- Emulated-width verification caught a real mobile bug (hidden pill text widening the layout to ~1038px) that unit tests and a desktop resize would have missed.
- Blocking human checkpoints (package legitimacy, real-device check) kept the user in control of the irreversible steps.

### What Was Inefficient
- The Krebs `allowHtmlContentType` fix landed on 2026-09-27 but the docs and a deferred item still reported it open until milestone close.
- A diagnosed debug session stayed open long after its fix shipped in Phase 2.
- Verification reports for Phases 1, 3 and 4 went stale (later code and review fixes), and no milestone audit was run, so v1.0 closed as an override closeout.
- Worktree isolation conflicted with a local `main` ahead of `origin`, and `origin` push access (403) was unresolved at close.

### Patterns Established
- Spec amendments are flagged in a SUMMARY, put to the user at a checkpoint, then recorded in PROJECT.md Key Decisions.
- Playwright is used ad hoc (`--no-save`), never as a dependency.
- Gates print sentinels (e.g. `VIEWPORTS_OK`) so scripts can be grepped.

### Key Lessons
1. Record a fix against the deferred item or debug session that raised it at the time it lands, or milestone close has to reconcile it.
2. Run `/gsd-audit-milestone` and re-verify before closing; stale verification turned a clean close into an override.
3. Settle push credentials and branch strategy before the first phase, not at milestone close.

### Cost Observations
- Model mix and session counts were not tracked for this milestone.
