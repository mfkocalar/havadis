# Platform budget

Phase 21 (PLAT-04). This document is the budget table for the four Hobby meters that the later phases (23 to 27) can push over a limit. The numbers come from runtime logs, from request logs and from the Vercel and Upstash dashboards, and every number says which of those it came from.

Dated 2026-11-14 (capture started that day, see "Measured (24 h capture)").

## Basis label rule

Every number in this document and in the recompute output carries one basis label. A modelled or projected number is never presented as measured.

| Label | Meaning |
| --- | --- |
| measured-log | counted or summed from the `budget {` runtime log lines or the CDN request records captured by `scripts/budget-capture.ts` |
| modelled | derived from measured sizes by a stated model (for example reads, which cannot be logged because a cache hit logs nothing) |
| dashboard | read by a person from the Vercel Usage page or the Upstash console, with the date of the reading |
| projected | an estimate for a later phase or for a month, with its source named in the cell |

## Budget line format

One structured runtime log line per producer call and one `render` line per `/` render:

    budget {"p":"edition","ok":1,"ms":812,"cpuMs":371,"n":143,"bytes":205367,"rcW":1,"rcR":0,"kvCmd":0}

| Key | Meaning | Exact or modelled |
| --- | --- | --- |
| p | producer: edition, kev, ssvc, epss, render | exact |
| ok | 1 when the producer resolved (epss: no batch failed), else 0 | exact |
| ms | wall time in whole milliseconds | upper bound (concurrent work in one instance) |
| cpuMs | `process.cpuUsage()` user plus system delta, whole ms | upper bound (D-13) |
| n | items handled | exact |
| bytes | JSON size of the stored or fetched payload | exact |
| rcW | Runtime Cache writes | exact for edition, kev and ssvc; upper bound for epss |
| rcR | Runtime Cache reads, render line only | modelled |
| kvCmd | Upstash commands | always 0 in Phase 21 (D-07) |
| st | ssvc only: assessed, not-assessed or failed | exact |

A line never carries a CVE ID, URL, error text or any upstream text. A cache hit logs nothing, because only producer bodies and the render call the logger.

## Meters

Allotments are the Hobby plan values. The per-day figure is the monthly figure divided by 30. The tripwire is 60% of the allotment (D-09).

| Meter | Allotment per month | 60% tripwire per month | 60% tripwire per day | Source of the number | Re-check path |
| --- | ---: | ---: | ---: | --- | --- |
| Runtime Cache writes (8 KB units) | 200,000 | 120,000 | 4,000 | measured-log, units modelled (A1) | `scripts/budget-recompute.ts` on the capture; cross-check on the Vercel Usage page |
| Runtime Cache reads (8 KB units) | 1,000,000 | 600,000 | 20,000 | modelled | `scripts/budget-recompute.ts` on the capture; cross-check on the Vercel Usage page |
| Upstash commands | 500,000 | 300,000 | 10,000 | not measured in product (kvCmd 0 by design); the 21-06 shapes-harness per-call counts join this cell in Plan 21-07 | Upstash console Commands counter (Phase 21; not logs, D-07) |
| Active CPU (compose) | 14,400 s (4 h) | 8,640 s | 288 s | measured-log (upper bound, edition rows only) | `scripts/budget-recompute.ts` on the capture; the dashboard Active CPU is the account-wide figure |
| ISR writes (calibration row) | 200,000 | 120,000 | 4,000 | dashboard | Vercel Usage page |
| ISR reads (calibration row) | 1,000,000 | 600,000 | 20,000 | dashboard | Vercel Usage page |
| Active CPU, dashboard (calibration row) | 14,400 s | 8,640 s | 288 s | dashboard | Vercel Usage page |

The Upstash commands row has basis `shapes-harness counts (dashboard counter) + projected`. In Phase 21 its measured column reads `not measured in product (kvCmd 0 by design)`, because nothing in the product writes to KV until Phase 23 (D-07). Plan 21-07 puts the 21-06 harness per-call counts in that cell.

Which Usage-page meter `unstable_cache` bills to for this team, and its allotment, is settled by the dashboard reading in Plan 21-06 (A5). The recompute takes the allotments as flags, so the table can be recomputed with the matching number.

## Measured (24 h capture)

Plan 21-07 fills this section from the capture that was started on the date in Plan 21-03's SUMMARY (2026-11-14, production, `evidence/budget-capture.jsonl`). Until then it is empty on purpose.

## Dashboard reading

Plan 21-07 fills this section from the Usage-page reading taken in Plan 21-06, next to the capture started on the date in Plan 21-03's SUMMARY. Until then it is empty on purpose.

## Projected adds per later phase

All cells are projected. The source is named in each cell.

| Phase | Added load | Source |
| --- | --- | --- |
| 23 | Upstash: 4 commands per regeneration x 96 = 384 per day (about 11,500 per month, 2.3% of 500,000), up to three times that with concurrent regenerations. `/sources` adds one ISR route. SSVC leaves the cache meters (saves 64 to 400 write units per day). The edition grows with new fields. | RESEARCH Budget Math, STACK.md KV table; projected |
| 24 | Compose CPU roughly doubles for 51 to 97 sources; the 1.5 s per-compose gate applies at 120 sources. The edition grows. | RESEARCH Budget Math; projected |
| 25 | Clustering CPU; the edition adds cluster fields. | RESEARCH Budget Math; projected |
| 26 | EPSS bulk scan (gunzip and scan, about 59 ms) inside the edition; CVSS is read from the SSVC record request (no new request); signals go into the edition. | RESEARCH Budget Math, STACK.md; projected |
| 27 | No new producer. | RESEARCH Budget Math; projected |

## Status and remedies

The rules below are the CONTEXT wording (D-09, D-10).

- D-09: If the measured Runtime Cache write share is over 60%, flag it with remedy = ENR-13 (SSVC to KV) in Phase 23. If the projected month-end use is over 100%, also apply a stopgap in Phase 21: raise `SSVC_REVALIDATE_SECONDS` (for example 6 h to 24 h) in `src/lib/enrichment/config.ts`. This is a one-constant change with no new infrastructure.
- D-10: If the measured share is well under 60%, Phase 21 records the number and a recommendation on whether ENR-13 should move to Phase 26. The user confirms any roadmap edit before Phase 23 is planned. Nothing moves automatically.

The status column is computed in exact integer arithmetic. OVER-60 means the projected 30-day use is strictly above 60% of the allotment, so exactly 60% is OK and one unit more is OVER-60. OVER-100 means strictly above 100%. NOT-MEASURED and UNKNOWN mean there is no number to compare, and they are never shown as OK. The recompute prints the write split by producer in percent, which is what the D-09 remedy annotation needs: if the edition dominates the writes, moving SSVC to KV barely moves the meter.

## How to recompute

Capture (runs for 25 h, detached; see the SUMMARY of Plan 21-03 for the PID and the exact start commands):

    node --experimental-strip-types scripts/budget-capture.ts \
        --out .planning/phases/21-platform-spikes-budget/evidence/budget-capture.jsonl --hours 25

Flags: `--out`, `--hours` (default 24), `--interval-min` (default 10), `--window-min` (default 25), `--environment production|preview`, `--deployment <id>`, `--once`. Exit codes: 0, 1 (`--once` poll failed), 2 (bad arguments, an `--out` inside the repository that is not git-ignored, a CLI older than 64, or another capture holding `<out>.lock`).

Hobby keeps runtime logs for 1 h and rejects `--since 1h`, so each poll reads a window of at most 50 min (`--window-min` 51 or more is rejected, and so is a window shorter than interval + 5 min). Consecutive polls overlap, and rows are deduplicated, so re-polling or restarting adds no row twice. Every failed poll, CLI exit, excluded interval and truncated page becomes a gap row with an enum reason (cli-exit, timeout, excluded, truncated, missed-poll) and no CLI text.

Keep the Mac on AC power with the lid open for the whole run. `caffeinate -is -w <pid>` blocks idle sleep and, on AC power, system sleep, but it does not stop lid-close sleep, and a sleep longer than about 50 min loses those logs for good (gap rows record it).

Recompute:

    node --experimental-strip-types scripts/budget-recompute.ts --in <capture.jsonl> [--min-coverage 0.9] [--from <iso> --to <iso>] \
        [--allot-rc-writes 200000] [--allot-rc-reads 1000000] [--allot-kv 500000] [--allot-cpu-s 14400]

Coverage is the union of the windows of successful polls, in minutes, out of the period. The period defaults to the first successful window start and is at least 24 h long, so a young capture is judged against a full day. Below `--min-coverage` (default 90%) the recompute prints `coverage: <covered>/<period> min (<pct>%)` and `INSUFFICIENT_COVERAGE` and exits 3, with no table; this includes an empty file and a file with no successful poll. Otherwise it prints the coverage line, the per-producer table, the meters table, the write split and `RECOMPUTE_OK`, and exits 0. Exit 2 means bad arguments or an unreadable file. The output does not depend on the order of the input rows.

## Limitations

- Reads are modelled (basis `modelled`): a cache hit logs nothing. Each render line adds the edition units plus the KEV units plus one per SSVC lookup and EPSS batch; each feed request answered STALE or MISS adds one edition read. The Usage page is the cross-check.
- `cpuMs` is an upper bound under Fluid concurrency: it is a process-wide delta, so concurrent work in the same instance is included. The 373 ms local cold-compose figure (`snapshot.ts` header item 8) is the comparison point. SSVC cpu is shown but not summed, because its 12 lookups run in parallel.
- `epss` `rcW` is an upper bound: fetch cache hits are not observable, so it counts batches, which overstates EPSS writes by at most about 96 a day.
- The 8 KB unit model is an assumption until the Usage page confirms it (A1): one write counts once per 8192 bytes of payload, so 8192 bytes is 1 unit, 8193 is 2, the 205,367-byte edition is 26.
- Writes from the Phase 21 spike previews are not in production lines.
- Two records with the same timestamp, request id and message collapse into one row (the dedupe rule); the same timestamp with a different request id stays two rows.
- Gap rows are a report. Coverage is the union of successful poll windows, so a gap inside a successful window is not subtracted.
- In Phase 21 the Upstash commands meter is re-checked from the Upstash console Commands counter, not from logs (D-07: nothing in the product writes to KV, so every budget line has kvCmd 0). From Phase 23 the kvCmd key makes it recomputable from logs.
