---
schema_version: 1
open_count: 1
waived_count: 0
fixed_count: 3
total_count: 4
last_updated: 2026-09-22T16:15:43.452Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | unrun-verify | src/lib/pipeline/fetchWithValidatedRedirect.ts |  | Per-hop 8s AbortController timeout path is untested (no fake-timer or real-clock proof); redirect rejection branches are covered but timeout is not. Deferred to 01-03's hermetic fixture. | fixed |  | 2026-09-18T10:27:32.612Z | 2026-09-19T11:13:12.195Z |
| 2 | 01 | unrun-verify | src/lib/pipeline/fetchSource.ts |  | INGEST-05's 15-min stale-while-revalidate timing behavior (simultaneous-request dedup during revalidation, no thundering herd) is platform-governed and cannot be observed by this executor's automated run; needs a production/preview deploy check. | fixed |  | 2026-09-18T10:27:41.981Z | 2026-09-21T12:13:11.268Z |
| 3 | 01 | unrun-verify | src/app/page.tsx |  | Task 2's <human-check> (real browser visit to confirm rendering, working links, no login prompt) was substituted with an automation-only equivalent (build+start+curl+header/body inspection) per human_verify_mode=end-of-phase; a real browser click-through is still recommended at phase-end UAT. | fixed |  | 2026-09-18T10:27:43.869Z | 2026-09-21T12:13:11.374Z |
| 4 | 02 | unrun-verify | src/components/ArticleCard.tsx |  | 02-04 plan verification's <human-check>: visually confirm on the running dev server that card heights are comparable across all 13 sources (CISA/CSO Online vs Bleeping Computer/Ars Technica), the clamped summary shows a visible ellipsis, the CrowdStrike card shows no dead gap, and the headline focus ring is not clipped at desktop and ~375px widths — not run during automated execution. | open |  | 2026-09-22T16:15:43.452Z |  |

````json
[
  {
    "id": 1,
    "kind": "unrun-verify",
    "phase": "01",
    "file": "src/lib/pipeline/fetchWithValidatedRedirect.ts",
    "line": null,
    "description": "Per-hop 8s AbortController timeout path is untested (no fake-timer or real-clock proof); redirect rejection branches are covered but timeout is not. Deferred to 01-03's hermetic fixture.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-18T10:27:32.612Z",
    "resolved_at": "2026-09-19T11:13:12.195Z"
  },
  {
    "id": 2,
    "kind": "unrun-verify",
    "phase": "01",
    "file": "src/lib/pipeline/fetchSource.ts",
    "line": null,
    "description": "INGEST-05's 15-min stale-while-revalidate timing behavior (simultaneous-request dedup during revalidation, no thundering herd) is platform-governed and cannot be observed by this executor's automated run; needs a production/preview deploy check.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-18T10:27:41.981Z",
    "resolved_at": "2026-09-21T12:13:11.268Z"
  },
  {
    "id": 3,
    "kind": "unrun-verify",
    "phase": "01",
    "file": "src/app/page.tsx",
    "line": null,
    "description": "Task 2's <human-check> (real browser visit to confirm rendering, working links, no login prompt) was substituted with an automation-only equivalent (build+start+curl+header/body inspection) per human_verify_mode=end-of-phase; a real browser click-through is still recommended at phase-end UAT.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-18T10:27:43.869Z",
    "resolved_at": "2026-09-21T12:13:11.374Z"
  },
  {
    "id": 4,
    "kind": "unrun-verify",
    "phase": "02",
    "file": "src/components/ArticleCard.tsx",
    "line": null,
    "description": "02-04 plan verification's <human-check>: visually confirm on the running dev server that card heights are comparable across all 13 sources (CISA/CSO Online vs Bleeping Computer/Ars Technica), the clamped summary shows a visible ellipsis, the CrowdStrike card shows no dead gap, and the headline focus ring is not clipped at desktop and ~375px widths — not run during automated execution.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-22T16:15:43.452Z",
    "resolved_at": null
  }
]
````
