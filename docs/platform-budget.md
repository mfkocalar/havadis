# Platform budget

Phase 21 (PLAT-04). This document is the budget table for the four Hobby meters that the later phases (23 to 27) can push over a limit. The numbers come from runtime logs, from request logs and from the Vercel and Upstash dashboards, and every number says which of those it came from.

Dated 2026-11-16. The capture that feeds the numbers ran from 2026-11-15T13:27:39Z to 2026-11-16T14:52:39Z (started 2026-11-14, restarted 2026-11-15 on AC power; see "Measured (24 h capture)").

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

The Upstash commands row has basis `shapes-harness counts (21-06, Upstash console counter)` for its measured cell and `shapes-harness counts (21-06) + projected` for its projection. In Phase 21 the product's own measured column reads `not measured in product (kvCmd 0 by design)`, because nothing in the product writes to KV until Phase 23 (D-07). The harness counts are in the Upstash commands row of the final table below.

Which Usage-page meter `unstable_cache` bills to for this team, and its allotment, could not be settled from the 21-06 reading (A5 stays open): the Usage page has no Runtime Cache or Data Cache row, and the user gave no allotments. The recompute takes the allotments as flags, so the table can be recomputed with the matching number once a row appears.

## Measured (24 h capture)

Capture: production (`havadis-news.vercel.app`), one deployment (`dpl_8qRJnMcWF4We689SVWXMcjuR6Z41`) for all 338 budget rows. Window, UTC: 2026-11-15T13:27:39Z (start of the first successful poll window) to 2026-11-16T14:52:39Z (end of the last). The first run (started 2026-11-14T18:08Z) lost about 11 h to a battery sleep and was replaced on 2026-11-15 on AC power; its files are kept as `*.partial` and are not used here (Plan 21-03 restart note). 151 poll rows (150 ok, 1 failed), 2 gap rows (cli-exit 2026-11-15T23:47:39Z to 2026-11-16T00:12:39Z, missed-poll 00:02:39Z to 00:22:39Z; both lie inside windows of later successful polls, so the union coverage is complete), 338 budget rows, 367 request rows. Both the capture (node PID 89942) and the D-11 accumulator (node PID 89945) ended by themselves at their 25 h limit, so no signal was sent; no node process for either script and no lock file remained.

Recompute run that feeds this table (`evidence/recompute-final.md`, exit 0, last line `RECOMPUTE_OK`):

    node --experimental-strip-types scripts/budget-recompute.ts --in .planning/phases/21-platform-spikes-budget/evidence/budget-capture.jsonl

    coverage: 1525/1525 min (100.0%)

| producer | lines/day | ok/fail | write ops/day | write units/day | median bytes | cpu s/day |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| edition | 126.5 | 134/0 | 126.5 | 746.0 | 38713 | 302.4 |
| kev | 3.8 | 4/0 | 3.8 | 64.2 | 137981 | 4.5 |
| ssvc | 0.0 | 0/0 | 0.0 | 0.0 | 0 | 0.0 (overlapping, not summed) |
| epss | 94.4 | 100/0 | 94.4 | 94.4 | 297 | 0.9 |
| render | 94.4 | 100/0 | 0.0 | 0.0 | 0 | 239.3 |

Write split by producer (units, measured-log, 8 KB model): edition 82.5%, kev 7.1%, ssvc 0.0%, epss 10.4%. The capture holds no `ssvc` line at all (basis measured-log, 25 h); one `ssvc` line sits in the earlier `*.partial` run, which is not used. The edition is the dominant writer: its median stored size is 38,713 bytes (5 units; largest 80,877 bytes, 10 units), not the 205,367 bytes (26 units) that the research model used.

### Reads correction for the D-11 accumulator

The recompute counts every feed request answered STALE or MISS as one edition read. In this capture the D-11 edition-CVE accumulator (`edition-cves.mjs`, hourly `GET /feed.json`) answered STALE on 26 of 26 polls (26 lines with ok true inside the capture period, all STALE, none MISS), and each of them triggered at most one feed regeneration that reads the edition once. Method: 26 x ceil(38,713 / 8,192) = 26 x 5 = 130 read units are subtracted from the recompute's 2,490 read units for the period (2,351.2 per day x 1,525 / 1,440), leaving 2,360 units, 2,228.5 per day, 66,855 per 30 days. The other 9 feed requests answered STALE (5 `/feed/critical.json`, 4 `/feed/high.json`) are not accumulator traffic and stay in. The recompute script itself is unchanged and still prints 2,351.2; this correction is applied by hand here, and labelled modelled.

The same accumulator also forced edition regenerations: 35 feed requests answered STALE in all (26 accumulator), against 134 edition lines. If every accumulator regeneration cost an average edition line, removing the 26 would lower the edition CPU to about 243.7 s per day (7,312 s per 30 days, 50.8% of 14,400 s) and writes by about 153 units per day. That is a modelled sensitivity, not a measurement, and the status below uses the raw figure (the conservative one).

### Final budget table

Allotments are the Hobby plan docs values (the user gave none from the dashboard). "Later phases add" refers to "Projected adds per later phase" below. Re-check for every non-Upstash row is the recompute command above, with the Usage page as the cross-check.

| Meter | Measured per day (basis) | 30-day projection (basis) | Allotment | 60% tripwire | % of allotment | Later phases add | Status | Re-check path |
| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |
| Runtime Cache writes (8 KB units) | 904.6 (measured-log; units modelled, A1) | 27,138 (projected) | 200,000 | 120,000 | 13.6% | Phase 23: SSVC share is 0.0%, so ENR-13 removes about 0 units; Phase 24-26: the edition grows (projected) | OK on the log-derived figure. The dashboard stand-in (ISR Writes 41K month-to-date) is UNKNOWN as a projection, because no cycle dates were given | the recompute command; Usage page |
| Runtime Cache reads (8 KB units) | 2,228.5 (modelled: recompute 2,351.2 less 130 accumulator units over the period, see above) | 66,855 (projected) | 1,000,000 | 600,000 | 6.7% | Phase 23-26: each added route that regenerates reads the edition once (projected) | OK | the recompute command; Usage page |
| Upstash commands | hgetall 1, hset20 1, mget20 1.00, mset20 1 = 4.00 for the 4-call Phase 23 layout (harness, per call; measured: mget20 1.00 and the combined hgetall+hset20+mset20 3.00; the 1, 1, 1 split is the F16 prediction and was not individually measured). Basis: `shapes-harness counts (21-06, Upstash console counter)`. `not measured in product (kvCmd 0 by design)` | 11,520 (4.00 x 96 regenerations per day x 30; up to 34,560 with three concurrent regenerations; projected). Basis: `shapes-harness counts (21-06) + projected` | 500,000 | 300,000 | 2.3% (6.9% at x3) | Phase 23 introduces the writes (about 11,500 per month, projected) | OK on the projection (not an OK from a zero count: nothing is measured in the product) | Upstash console Commands counter (Phase 21; not logs, D-07); log re-check: NOT-MEASURED until Phase 23 adds kvCmd (SC4 deviation) |
| compose CPU (Active CPU, log-derived, edition rows) | 302.4 s (measured-log, upper bound, D-13; 2.39 s per edition line against the 373 ms local proxy) | 9,073 s (projected) | 14,400 s (4 h) | 8,640 s | 63.0% | Phase 24 roughly doubles compose CPU: 18,144 s, 126.0% on the same upper bound (projected) | OVER-60. Remedy CPU-1 below | the recompute command; the dashboard Active CPU is account-wide |
| compose CPU (Active CPU, dashboard) | 51m 59s = 3,119 s month-to-date, account-wide (dashboard, read 2026-11-16, cycle dates not provided); no per-day figure | not computable without cycle dates | 14,400 s | 8,640 s (288 s per day) | 21.7% of the month, 36.1% of the monthly tripwire | as above | UNKNOWN: 3,119 s equals 10.8 days of the 288 s per day tripwire, so the dashboard is over its per-day tripwire only if the cycle is younger than 10.8 days | Usage page |
| ISR writes (calibration row) | 41K month-to-date (dashboard, 2026-11-16); about 380 of it is the spike's own writes (modelled) | not computable without cycle dates | 200,000 (docs value; none given) | 120,000 | 20.5% month-to-date | not in scope | UNKNOWN as a projection: OVER-60 if the cycle is younger than 10.3 days, OVER-100 if younger than 6.2 days (dashboard run rate alone) | Usage page |
| ISR reads (calibration row) | 30K month-to-date (dashboard, 2026-11-16) | not computable without cycle dates | 1,000,000 (docs value; none given) | 600,000 | 3.0% month-to-date | not in scope | OK on the month-to-date figure | Usage page |

## Dashboard reading

Vantage: dashboard, Usage page values pasted by the user on 2026-11-16 (Plan 21-06 operator session 2); the full row list is in `docs/spikes/21-platform-facts.md` ("Runtime Cache write share (Usage page)"). Rows that matter here: ISR Reads 30K, ISR Writes 41K, Fluid Active CPU 51m 59s, Fluid Provisioned Memory 3.0 GB-Hrs, Function Invocations 1.4K. No Data Cache and no Runtime Cache row exists on the page. No allotments, no billing cycle dates, no last-24 h figures and no Observability view were provided, so the allotments in this document stay docs values.

Spike's own writes: about 380 write units in the cycle (193 page writes at build across the seven spike previews, 104 for four runtime `/` regenerations at 26 units each, 20 for the s1 entries and 63 build-time producer entries), modelled from the "Spike's own writes" list in the record, not read from the dashboard. They are under 1% of the 41K and are subtracted, giving about 40.6K ISR Writes from the product's own deployments (modelled).

Log-derived against dashboard. The dashboard figures are month-to-date, the log figures are per day over a 25 h window, and the cycle start date was not provided, so a per-day comparison is not possible. Month-to-date writes alone (41K, the only write meter with a reading) are 1.5 times the whole 30-day log projection (27,138), a difference above 25%. By the conservative rule the higher number governs the status, so the writes meter is not shown as a plain OK: it is OK on the log-derived figure and UNKNOWN on the dashboard stand-in. Why they may differ is not settled: ISR Writes count page and route regenerations (page bodies are larger than the edition payload), and A5 (which meter `unstable_cache` bills to) is open. The 8 KB unit model (A1) is therefore neither confirmed nor refuted. For reads the same applies (30K month-to-date against a log projection of 66,855 per 30 days: consistent with a cycle of about 13 days, not provable).

Compose CPU (D-14): log-derived edition cpuMs 302.4 s per day x 30 = 9,073 s against 14,400 s, an upper bound (D-13) with the 373 ms local cold-compose figure beside it (the log figure averages 2.39 s per edition line, about 6 times the proxy, which concurrent work in one instance and the cold start can explain but this document does not measure). The dashboard Active CPU against its own 288 s per day tripwire is in the table above.

## Projected adds per later phase

All cells are projected. The source is named in each cell. The measured base is from the 25 h capture: writes 904.6 units per day (13.6%), reads 2,228.5 (6.7%), compose CPU 302.4 s per day as an upper bound (63.0%), edition regenerations 126.5 per day.

| Phase | Added load | Source |
| --- | --- | --- |
| 23 | Upstash: 4.00 commands per regeneration (harness, combined) x 96 = 384 per day, about 11,520 per month (2.3% of 500,000), up to three times that with concurrent regenerations (34,560, 6.9%). At the measured 126.5 regenerations per day: 15,180 (3.0%), up to 45,540 (9.1%). `/sources` adds one ISR route. SSVC leaves the cache meters: the measured SSVC write share is 0.0%, so this saves about 0 write units per day on this capture (the research model said 64 to 400). The edition grows with new fields. | measured base from this document; RESEARCH Budget Math, STACK.md KV table; projected |
| 24 | Compose CPU roughly doubles for 51 to 97 sources: about 605 s per day, 18,144 s per 30 days, 126.0% of 14,400 s on the same upper bound, so OVER-100 unless the remedy CPU-1 below lands first. The 1.5 s per-compose gate applies at 120 sources. The edition grows: at twice the median size (about 77 KB, 10 units) writes are about 1,650 per day (24.8%); the writes meter reaches its 60% tripwire when the edition is about 5 times its measured size. | measured base from this document; RESEARCH Budget Math; projected |
| 25 | Clustering CPU adds to the compose figure above; the edition adds cluster fields. | RESEARCH Budget Math; projected |
| 26 | EPSS bulk scan (gunzip and scan, about 59 ms) inside the edition; CVSS is read from the SSVC record request (no new request); signals go into the edition. | RESEARCH Budget Math, STACK.md; projected |
| 27 | No new producer. | RESEARCH Budget Math; projected |

## Status and remedies

The rules below are the CONTEXT wording (D-09, D-10).

- D-09: If the measured Runtime Cache write share is over 60%, flag it with remedy = ENR-13 (SSVC to KV) in Phase 23. If the projected month-end use is over 100%, also apply a stopgap in Phase 21: raise `SSVC_REVALIDATE_SECONDS` (for example 6 h to 24 h) in `src/lib/enrichment/config.ts`. This is a one-constant change with no new infrastructure.
- D-10: If the measured share is well under 60%, Phase 21 records the number and a recommendation on whether ENR-13 should move to Phase 26. The user confirms any roadmap edit before Phase 23 is planned. Nothing moves automatically.

The status column is computed in exact integer arithmetic. OVER-60 means the projected 30-day use is strictly above 60% of the allotment, so exactly 60% is OK and one unit more is OVER-60. OVER-100 means strictly above 100%. NOT-MEASURED and UNKNOWN mean there is no number to compare, and they are never shown as OK. The recompute prints the write split by producer in percent, which is what the D-09 remedy annotation needs: if the edition dominates the writes, moving SSVC to KV barely moves the meter.

### Meter status (2026-11-16)

| Meter | Status | Remedy |
| --- | --- | --- |
| Runtime Cache writes | OK on the log-derived figure (13.6% of 200,000 per month, 30-day projection); UNKNOWN on the dashboard stand-in (ISR Writes 41K month-to-date, no cycle dates, A5 open) | none required today. If the dashboard stand-in turns out to be the real binding and the cycle is younger than 10.3 days, the writes meter would be OVER-60; that needs the cycle start date to settle |
| Runtime Cache reads | OK (6.7%) | none required |
| Upstash commands | OK on the projection (2.3%, 6.9% at three concurrent regenerations); not measured in product | none required; re-check from the Upstash console Commands counter |
| compose CPU (log-derived upper bound) | OVER-60 (63.0%) | CPU-1, below |
| compose CPU (dashboard) | UNKNOWN (no cycle dates) | the dashboard value joins CPU-1 below |

**Write share and D-09.** Measured write share of the meter `unstable_cache` bills to: 13.6% of the allotment on the log-derived figure, and 20.5% month-to-date on the dashboard stand-in (docs allotment). Neither is over 60%, so the D-09 ENR-13 flag is not raised and D-10 applies (well under 60%). The measured write split by producer is printed next to it: edition 82.5%, kev 7.1%, ssvc 0.0%, epss 10.4% (measured-log). The share ENR-13 alone would remove is the SSVC share, 0.0% (the capture holds no ssvc line). Because the SSVC share is under 50%, the other levers named in RESEARCH Implications are listed here as options for the user's decision, not as decisions: trim stored edition fields, store the edition body in KV, lengthen the edition window.

**D-09 stopgap.** stopgap not applied: projected month-end 34.1% <= 100% of the writes meter (ISR Writes stand-in: month-to-date 41,000 + 904.6 units per day x at most 30 days left, against 200,000; the figure is an upper bound because the billing cycle dates were not provided). The SSVC share of write units is 0.0%, so the stopgap would save at most 0.0% of write units in any case. Reads projected 9.7% (info only). The option is not offered, `src/lib/enrichment/config.ts` is unchanged, and `stopgap=n/a` is recorded.

**Remedy CPU-1 (compose CPU, OVER-60 on the upper bound).** The remedy is named here and its choice is the user's, before Phase 24 is planned, because Phase 24 roughly doubles compose CPU (126.0% projected). Steps in order: (1) confirm the upper bound against the dashboard Fluid Active CPU for a full cycle day (3,119 s month-to-date is account-wide and needs the cycle start date); (2) if confirmed, cut edition regenerations, not per-regeneration work, first: 35 feed requests were answered STALE in the capture, and the edition regenerated 126.5 times per day against 96 expected from the 900 s window, so lengthening the edition window or stopping feed routes from regenerating the edition on their own both lower the figure; (3) in Phase 24 planning, hold the per-compose 1.5 s gate. The log figure averages 2.39 s per edition line against the 373 ms local proxy, which is an upper bound under concurrency (D-13) and not a measurement of the compose alone.

**SC4.** SC4: partly met — Upstash not log-recomputable in Phase 21 by design (D-07). The named deviation `SC4 deviation (Upstash commands meter)` is under Limitations.

## Decisions requested (2026-11-16)

Put to the user at the Plan 21-07 decision checkpoint; none of these changes ROADMAP.md or REQUIREMENTS.md by itself.

Answered 2026-11-16: `enr13=move-26 cvss=n/a upstash=defer-to-phase-23 remove=approve-by-id:7`. The ENR-13 move to Phase 26 is routed through /gsd-phase before Phase 23 is planned; nothing in ROADMAP.md changed here. The seven spike previews were removed by deployment ID.

1. **ENR-13 placement (D-10).** Recommendation: move ENR-13 to Phase 26, next to the other signals. Reasons, all measured here: the write meter is at 13.6%; SSVC writes are 0.0% of write units, so ENR-13 would remove about 0 units; the writes meter reaches its 60% tripwire only if the edition grows to about 5 times its measured size, which Phases 24 to 26 (about 2 times, projected) do not reach on this base. The Phase 23 KV store is still needed for the edition body and the conditional GET work; this only concerns where the SSVC move sits. The pressing meter is compose CPU (CPU-1), not writes. Options: keep-23, move-26, or lever:<your lever>.
2. **CVSS (D-11).** The sample is 43 of 50 (86.0%) on the pool the user approved (edition plus deltaLog fill; the edition-only subset is 5/5), so 100 x 43 = 4,300 is at or above 70 x 50 = 3,500: no decision request. cvss=n/a.
3. **Upstash and SC4 (D-07).** Answer one of `upstash=accept-deviation`, `upstash=defer-to-phase-23` (adds a `Carried to Phase 23` line: Phase 23 logs kvCmd, which closes the Upstash part of SC4) or `upstash=reject:<alternative>` (stops Phase 21 close-out and routes back to the planner). Whatever the answer: SC4: partly met — Upstash not log-recomputable in Phase 21 by design (D-07).
4. **Spike removal (D-05).** Approve or hold removal of the seven spike previews in the guard table (kept in the plan evidence, not in this document).
5. **D-09 stopgap.** Not offered: stopgap not applied, projected month-end 34.1% <= 100%.

**Carried to Phase 23.** Phase 23 adds kvCmd logging to its KV calls, so the Upstash commands meter becomes recomputable from Vercel logs; that closes the Upstash part of SC4. Until then the Upstash console Commands counter is the re-check path.

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
- A1 (8 KB units) is neither confirmed nor refuted by the 2026-11-16 Usage reading: the page has no Runtime Cache or Data Cache row and no cycle dates were given, and A5 (which meter `unstable_cache` bills to) stays open. The measured edition is 38,713 bytes at the median (5 units), not the 205,367 bytes (26 units) used below as the model's example.
- The 8 KB unit model is an assumption until the Usage page confirms it (A1): one write counts once per 8192 bytes of payload, so 8192 bytes is 1 unit, 8193 is 2, the 205,367-byte edition is 26.
- Writes from the Phase 21 spike previews are not in production lines.
- Two records with the same timestamp, request id and message collapse into one row (the dedupe rule); the same timestamp with a different request id stays two rows.
- Gap rows are a report. Coverage is the union of successful poll windows, so a gap inside a successful window is not subtracted.
- In Phase 21 the Upstash commands meter is re-checked from the Upstash console Commands counter, not from logs (D-07: nothing in the product writes to KV, so every budget line has kvCmd 0). From Phase 23 the kvCmd key makes it recomputable from logs.

**SC4 deviation (Upstash commands meter).** The Upstash commands meter cannot be recomputed from one day of Vercel logs in Phase 21, because no product code issues KV commands (D-07), so every budget line has kvCmd 0. In Phase 21 it is re-checked from the Upstash console Commands counter, not from logs. Its log re-check stays NOT-MEASURED until Phase 23 adds kvCmd, which closes the Upstash part. SC4: partly met — Upstash not log-recomputable in Phase 21 by design (D-07).
