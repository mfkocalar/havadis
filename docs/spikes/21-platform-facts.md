# Phase 21 platform facts (PLAT-03 spike record)

Purpose: record the platform facts that Phase 23 (KV, conditional GET) and Phase 26 (EPSS bulk file) are designed on. Each fact was predicted from source and laptop probes in the Phase 21 research (F1, F5 to F8) and is confirmed here from the place it matters. Requirement PLAT-03, decisions D-05, D-07, D-08, D-12.

Rule: every entry names its vantage point, one of preview (a Vercel preview deployment, Vercel egress), local build (`next build` and `next start` on the laptop), laptop (a plain probe from the laptop), dashboard, or docs. A fact measured only locally or from the laptop is never recorded as measured on Vercel.

Spike code lives on branch `spike/21-platform-facts` in the separate git worktree `/Users/mkh/CyberSecurity/havadis-spike-21`, created from `origin/main` (f403978). It is never merged and never pushed, and no spike route or dependency exists on `feat/public-product-v1` or `main`. The previews are CLI deployments (`vercel deploy --yes`) behind Vercel Authentication, reached only through `vercel curl`. Plan 21-07 removes them after the user approves its guard table.

Entries added by Plan 21-04: Setup facts, S4, S1, S3, Spike's own writes. Plan 21-05 adds S2 and environment scoping, Plan 21-06 adds the Upstash command shapes (harness and predictions now, measured columns after the operator reading), the CVSS coverage and the Usage share, and Plan 21-07 adds the summary table.

## Setup facts

Vantage for this section: dashboard and CLI readings reported by the user in Plan 21-02, plus the docs value where the dashboard was not read.

| Item | Value | Vantage |
| --- | --- | --- |
| Vercel CLI | 65.16.0 (`vercel whoami` returns the project account) | laptop |
| Project function region | iad1 (`serverlessFunctionRegion`, and the build log line "Running build in Washington, D.C., USA (East) – iad1") | dashboard API and preview build log |
| Upstash | Integration resource `upstash-kv-aqua-horizon`, product Upstash for Redis, connected to project havadis-news for Production and Preview (user report, agrees with `vercel env ls`) | dashboard |
| Upstash env var names | KV_REST_API_URL, KV_REST_API_TOKEN, KV_REST_API_READ_ONLY_TOKEN, KV_URL, REDIS_URL, all Secret, on Preview and Production. Values were never read | dashboard |
| Upstash store creation date, store region, plan | Not recorded in Plan 21-02: the user did not confirm the store region and the CLI cannot read it. Open item, to be filled by the Plan 21-05 or 21-06 checkpoint | not measured |
| Cron jobs configured | 0 (user report; `vercel crons ls` printed "No cron jobs found") | dashboard and CLI |
| Hobby cron job limit and minimum interval | Docs value only: 100 cron jobs per project, minimum interval once per day on Hobby, scheduling precision per hour (RESEARCH F15). The dashboard text was not read in Plan 21-02 and stays unverified | docs |
| Next.js version Vercel builds | 16.4.1 (Turbopack), from the build log of the S4 preview ("Detected Next.js version: 16.4.1"). The main checkout's node_modules hold 16.4.6, so the spike worktree runs its own `npm ci` from the lockfile | preview build log |
| Node on the preview | v24.22.3 (reported by the S4 route). Laptop: v26.3.1 | preview and laptop |

## S4: EPSS bulk file

- Date (UTC): 2026-11-15, 13:57 local build, 13:58 preview
- Vantage: preview (Vercel egress, project function region iad1) for the verdict; local build and laptop only for the comparison column
- Next version: 16.4.1
- Spike commit: 0cbc520 (spike/21-platform-facts, worktree HEAD; the route is `src/app/spike/s4/route.ts`, GET only, no request input read, no environment value echoed)
- Deployment ID: dpl_C64KnfaffJ3mQ6xtuHek3TD1fxZ3 (`https://havadis-news-c9c1yjkk8-mfkocalars-projects.vercel.app`, READY, target preview)
- Calls: `vercel curl /spike/s4 --deployment <url>`, twice, 13:58:40Z and 13:58:46Z. Both returned the same chain and the same header values

Evidence excerpt from the preview (first call, JSON as returned):

```json
{"hops":[
  {"hop":0,"host":"epss.empiricalsecurity.com","status":302,"location":"relative","locationHost":"epss.empiricalsecurity.com","sameHost":true,"https":true},
  {"hop":1,"host":"epss.empiricalsecurity.com","status":200,"location":"none"}],
 "wrapper":{"finalStatus":200,
  "finalUrl":"https://epss.empiricalsecurity.com/epss_scores-2026-11-15.csv.gz",
  "contentLength":"2849232","lastModified":"Sun, 15 Nov 2026 13:30:36 GMT",
  "etag":"\"77d6dbc6b66c9f00d4921882ccdd9a02\"","contentType":"binary/octet-stream"},
 "scan":{"firstLine":"#model_version:v2026.06.15,score_date:2026-11-15T12:03:04Z",
  "secondLine":"cve,epss,percentile","dataRows":406615,"ms":207,"cpuUserMs":196,"cpuSystemMs":38},
 "cyentia":{"threw":true,"message":"Rejected redirect: host mismatch (epss.empiricalsecurity.com !== epss.cyentia.com)"}}
```

What the preview showed:

| Fact | Preview (Vercel egress) | Laptop / local build (comparison) |
| --- | --- | --- |
| Host chain | 1 hop: `epss.empiricalsecurity.com/epss_scores-current.csv.gz` answers 302 with a relative `Location`, which resolves to `epss.empiricalsecurity.com/epss_scores-2026-11-15.csv.gz`, which answers 200. Every hop is https and on the start host | same chain |
| Passes `fetchWithValidatedRedirect` | Yes, unchanged wrapper, final status 200 | same |
| content-length | 2,849,232 bytes (about 2.72 MiB) | 2,849,232 |
| Last-Modified | Sun, 15 Nov 2026 13:30:36 GMT | same |
| ETag | `"77d6dbc6b66c9f00d4921882ccdd9a02"` | same |
| Line 1 | `#model_version:v2026.06.15,score_date:2026-11-15T12:03:04Z` | same |
| Line 2 | `cve,epss,percentile` | same |
| Data rows | 406,615 | 406,615 |
| Streaming gunzip + line scan | call 1: 207 ms wall, cpu 196 ms user + 38 ms system. Call 2: 118 ms wall, cpu 116 ms user + 26 ms system | local build: 189 ms wall, cpu 83 ms user + 15 ms system |
| `https://epss.cyentia.com/epss_scores-current.csv.gz` as start URL | rejected by the wrapper: `Rejected redirect: host mismatch (epss.empiricalsecurity.com !== epss.cyentia.com)` | same message (RESEARCH F5, laptop) |

The score_date lags the publish time: the file was Last-Modified at 13:30 UTC and carries a model score_date of 12:03 UTC the same day. The URL path name (`epss_scores-2026-11-15.csv.gz`) uses the publish date. The research run on 2026-11-13 saw 2,841,325 bytes and 405,484 rows (STACK) for the 2026-11-12 file, so the file grew by about 8 KB and 1,100 rows in three days.

CPU note: the route reads the body once through `Readable.fromWeb` into `createGunzip` and splits lines in JS. The preview figures include a cold instance on call 1 (about 234 ms CPU) and a warm instance on call 2 (about 142 ms). Both are upper bounds for the scan itself, because `process.cpuUsage` covers the whole process while the scan runs, including any other work on that instance.

Verdict: passes the SSRF-safe fetch from Vercel egress when the start URL is on `epss.empiricalsecurity.com`. Fails it when the start URL is on `epss.cyentia.com`.

Implications:

- The configured EPSS start URL must be `https://epss.empiricalsecurity.com/epss_scores-current.csv.gz`. The cyentia host must never be configured: it redirects to a different host and the wrapper rejects that on purpose.
- A body cap and a streaming gunzip reader (the shape used in this spike) are Phase 26 work. The file is 2.7 MiB compressed and 406 thousand rows, which the scan handled in about 120 to 210 ms wall on the preview.
- The relative `Location` is resolved against the current URL by the wrapper, so no wrapper change is needed for EPSS.
- ETag and Last-Modified are both present on the final file, so a conditional GET to the dated URL is possible (S3 measures it).

## S1: nested unstable_cache

- Date (UTC): 2026-11-15, local build 14:01 to 14:09, preview 14:02 to 14:09
- Vantage: local build (`next build` then `next start -p 4100` in the spike worktree, laptop, Node v26.3.1) and preview (Vercel, Node v24.22.3)
- Next version: 16.4.1 (both; the worktree runs `npm ci` from the lockfile, `npx next --version` prints v16.4.1, and the preview build log says "Detected Next.js version: 16.4.1")
- Spike commit: fffd251 (spike/21-platform-facts, `src/app/spike/s1/page.tsx`)
- Deployment ID: dpl_2xexgZwb35NrMwCRTaXEbRS16JJn (`https://havadis-news-19uzmg8o1-mfkocalars-projects.vercel.app`, READY, target preview; the same deployment serves S3)

S1 tests the nested-cache mechanism (an outer cachedSnapshot calling an inner cachedLookup on a spike page), not the edition path. The edition callback makes no nested cache call today: src/lib/snapshot.ts getFrontPageData (line 233 at planning time) passes readSsvc at render, outside the edition callback.

Set-up: the page is static with `revalidate = 120`. `outer` is a `cachedSnapshot("spike-s1-outer-v1", ..., { revalidate: 120 })` whose callback awaits `inner("nested")` twice. `inner` is a `cachedLookup("spike-s1-inner-v1", ..., { revalidate: 120 })` that logs `spike s1 inner-run <x>`. The page body then calls `inner("control")` directly (a non-nested control) and `inner("nested")` once more directly (a write probe: if a nested call wrote an entry, this call hits it and logs nothing). The callback also returns a per-process sequence number, so the HTML shows whether two calls were separate runs.

Counts per outer run (one outer run per page generation, found from the `spike s1 outer-run` line):

| Vantage | Generations observed | inner-run lines per outer run | Source of the count |
| --- | --- | --- | --- |
| local build | 4 (the build, then 3 regenerations at 14:04:11, 14:06:21 and 14:08:32, requests spaced 130 s over 3 windows) | 2 nested + 1 control = 3, every generation | `next build` output and `next start` log: 4 `outer-run`, 8 `inner-run nested`, 4 `inner-run control` |
| preview | 4 (the build at 14:02:29, then regenerations at 14:05:01, 14:07:12 and 14:09:25, requests spaced 130 s over 3 windows) | 2 nested + 1 control = 3, every generation | build log (1 generation) and `vercel logs runtime --environment preview --deployment <id> --since 25m --json --query "spike s1"` (3 generations: 3 `outer-run`, 6 `inner-run nested`, 3 `inner-run control`) |

A hit would show 0 or 1 nested inner-runs per outer run once the first one is stored; both vantages show 2. The two nested calls of one outer run were separate runs milliseconds apart in every generation (sequence numbers n and n+1, timestamps 0 to 7 ms apart), so the second nested call never hit the first one's result.

Did a bypassed nested call write an entry? Yes, as F1 predicts. The direct probe call after the outer run logged no third `inner-run nested` in any generation, so it was served from an entry that a nested call had stored. Locally the probe returned the second nested call's value in all three generations the HTML showed. On the preview it returned the first nested call's value in the two regenerations the HTML showed (14:05 and 14:07) and the second one's in the build generation, so the order in which the two nested writes land is not guaranteed. The control (a direct call) is an ordinary non-nested call and ran once per generation, as its entry is a window old at each regeneration.

Verdict (D-12): **bypass**. Local and preview agree, so there is no mismatch to resolve. The design never relies on nested caching (snapshot.ts item 9).

Implications:

- A `cachedLookup` called inside a `cachedSnapshot` callback runs its producer on every outer run and still writes, so it costs a Runtime Cache write and the producer's work and saves nothing.
- A KV call placed inside the edition callback (S2) is not a nested `unstable_cache` call and is not affected by this result.

## S3: no-store conditional GET

- Date (UTC): 2026-11-15, local run 14:02:47, preview runs 14:02:49 and 14:07:13
- Vantage: preview (Vercel egress, Node v24.22.3) and local build (laptop, Node v26.3.1). The CVE Program rows at the end are laptop probes
- Next version: 16.4.1
- Spike commit: fffd251 (`src/app/spike/s3/route.ts`, force-dynamic, GET only, no request input)
- Deployment ID: dpl_2xexgZwb35NrMwCRTaXEbRS16JJn
- Targets (fixed constants): the EPSS dated file `epss_scores-2026-11-15.csv.gz`, `KEV_URL`, and `https://cveawg.mitre.org/api/cve/CVE-2026-114713` (one ID from the live edition, re-checked against `CVE_ID_SHAPE` before use)

Method: validators come from unconditional requests outside any cache (HEAD for EPSS, GET for KEV and the CVE record, bodies cancelled). Then, inside a `cachedSnapshot("spike-s3-v1", ..., { revalidate: 60 })` callback, five raw `fetch(url, { cache: "no-store", headers })` calls run, and the same EPSS If-None-Match call runs through the unchanged `fetchWithValidatedRedirect`. The first preview call ran the callback (its `ranAt` equals its own time).

| Case | Preview: status, body bytes | Local build: status, body bytes | Headers on the response (preview) |
| --- | --- | --- | --- |
| EPSS If-None-Match | 304, 0 | 304, 0 | etag and last-modified back, no cache-control |
| EPSS If-Modified-Since | 304, 0 | 304, 0 | etag and last-modified back, no cache-control |
| KEV If-Modified-Since | 304, 0 | 304, 0 | etag and last-modified back, `max-age=3374` |
| KEV If-None-Match | 200, 1,854,379 | 200, 1,854,379 | etag and last-modified back, `max-age=3374` |
| CVE If-None-Match (weak ETag) | 200, 3,988 | 200, 3,988 | etag back, no last-modified, `no-store` |
| EPSS If-None-Match through `fetchWithValidatedRedirect` | threw `Redirect (304) with no Location header` | threw the same message | none |

Notes on the table:

- Locally the EPSS 304 carried an etag but no last-modified; on the preview it carried both. The 304 is the same, the extra header depends on the edge that answered.
- KEV: the unconditional GET reported `content-length` 203,665 (the compressed transfer), while the decoded 200 body was 1,854,379 bytes.
- A second preview call at 14:07:13 returned the stored result (`ranAt` still 14:02:49) although `revalidate` is 60, so `unstable_cache` served a stale entry; whether its background refresh ran was not observed and no further call was made.

CVE Program API, laptop probes on 2026-11-15 (vantage: laptop; not repeated on the preview). RESEARCH F8 predicted a 304 on If-None-Match with the weak ETag, and the spike's raw `fetch` got 200, so the cause was isolated:

| Request (same URL, same weak ETag) | Status |
| --- | --- |
| curl, plain, HTTP/1.1 or HTTP/2, with or without compression | 304 |
| curl with `Pragma: no-cache` only | 304 |
| curl with `Cache-Control: max-age=0` | 304 |
| curl with `Cache-Control: no-cache` | 200 |
| Node fetch with `If-None-Match` (default, or `cache: "no-store"`) | 200 |
| Node fetch with `cache: "no-store"`, `If-None-Match` and an explicit `cache-control: max-age=0` | 304 |

A local echo server showed that Node's fetch sent `pragma` and `cache-control` headers on a request carrying `If-None-Match`; the values were not printed, and the fetch spec sets `no-cache` for such a request, which matches the 200. So the CVE Program API ignores If-None-Match when the request carries `Cache-Control: no-cache`, and a Node fetch adds that header by itself. This is a laptop finding, not yet a preview one.

Verdict: observable with raw fetch (EPSS both validators, KEV If-Modified-Since only); not through fetchWithValidatedRedirect, which throws on a 304. The CVE Program record is observable only when the request does not carry `Cache-Control: no-cache`.

Phase 23 implications (text only; no wrapper change was merged, D-07):

1. `fetchWithValidatedRedirect` must return a 304 before its 3xx branch (`if (res.status === 304) return res;`), and a test must show that a 304 returns without following.
2. `boundedFetchJson` must treat 304 as not-an-error; it currently reports `status 304` as a failure.
3. A 304 has no body, so a source with no stored last-good items must fall back to an unconditional fetch (PITFALLS C2).
4. KEV honours If-Modified-Since only. If-None-Match returns the full 1.85 MB body, so store and send Last-Modified for KEV, not the ETag.
5. The EPSS dated file honours both validators with a 304, so either can be stored.
6. For the CVE Program API, a conditional request must carry an explicit `cache-control: max-age=0` (or equivalent), because the default Node fetch adds `Cache-Control: no-cache` and the API then returns 200. Re-measure this on a preview in Phase 23.
7. `unstable_cache` served a stale entry on the second preview call, so a conditional refresh run inside a cached callback should not be assumed to have completed before the response is sent.

## S2: KV inside the edition callback

- Date (UTC): 2026-11-15, local build finished 14:24, preview build 14:25, readings 14:26 to 14:44
- Vantage: preview (Vercel, project function region iad1) for every verdict; local build (laptop, no KV env set, so the KV call fails softly) for the manifest check
- Next version: 16.4.1 (preview build log "Detected Next.js version: 16.4.1"; the worktree's lockfile build prints the same)
- Spike commit: 785e2c3 (spike/21-platform-facts). `src/lib/spikeKv.ts` (client and `produceS2`), the KV call inside `produceEdition` in `src/lib/edition.ts`, and the static route handler `src/app/spike/s2/route.ts`. `src/lib/snapshot.ts` and its cached arrow are unchanged
- Deployment ID (ok mode): dpl_Dg56rHQMmtQUyvcJxpGrNiJjiC4w (`https://havadis-news-p6suen16m-mfkocalars-projects.vercel.app`, READY, preview, Vercel Authentication on; the unauthenticated probe answered 302 to https://vercel.com/ at 14:25:33Z, before the first route request at 14:26:35Z)
- Modes: this entry holds ok mode. The three injected failures (badtoken, badhost, blackhole) are added below by the same plan as one per-mode table

Set-up: the client is built per STACK.md (`retry: false`, `signal: () => AbortSignal.timeout(1500)`, `automaticDeserialization: false`, `enableTelemetry: false`, @upstash/redis 1.41.0 exact, installed only in the spike worktree) from the Marketplace env vars read at runtime (names only, no `vercel env pull`). `produceS2(label)` runs `INCR spike:<VERCEL_ENV>:<label>:regen` then `SET spike:<VERCEL_ENV>:<label>:ts`, and its whole body, client construction included, sits in try/catch, so it never throws. Inside `produceEdition` it runs after the loaded edition passes both checks and before the edition is returned, labelled `edition`, and logs `spike s2 edition kv=<ok|failed> class=<class> mode=<mode> n=<counter> ms=<ms>`. `/` is measured directly. `/spike/s2` is a force-static route handler (`revalidate = 120`) on a `cachedSnapshot("spike-s2-v1")` callback with label `s2`, a 120 s companion on the same seam.

(a) Build route table and (c) local manifest. The preview build log and the local build print the same rows:

| Route | Revalidate | Expire |
| --- | --- | --- |
| `/` | 15m | 1y |
| `/spike/s2` | 2m | 1y |

Local `.next/prerender-manifest.json`: `/` compute static, `initialRevalidateSeconds` 900; `/spike/s2` compute static, 120. `assertStaticRoute` from `test/fixtures/staticRouteGate.ts` passed on both (`/` with 900, `/spike/s2` with 120). The local build (no KV env, exit 0) logged `spike s2 edition kv=failed class=other mode=ok n=0 ms=0` ten times, so a missing store leaves `/` static and the build green.

(e) Build time on the preview. The deployment is READY. The build log shows the edition callback ran 5 times (the same 5 edition budget lines the earlier previews showed; why the callback repeats at build was not investigated, and the local build ran it 10 times) and each ran its KV call: `kv=ok class=none mode=ok` with n=1, 2, 3, 4, 5 and ms=177, 52, 6, 7, 9. So a live KV call inside the edition callback runs at build time and does not stop the build or make `/` dynamic. The build's `/spike/s2` generation ran once (body n=1, ms 206).

(b) ISR on `/` (900 s), headers through `vercel curl`:

| UTC | x-nextjs-prerender | x-vercel-cache | age |
| --- | --- | --- | --- |
| 14:26:35 | 1 | PRERENDER | 0 |
| 14:31:10 | 1 | HIT | 274 |
| 14:42:06 (reading 2, 15 min 31 s after reading 1) | 1 | STALE | 931 |
| 14:43:13 (reading 3) | 1 | HIT | 62 (reset) |

The first request returned PRERENDER (the build's own HTML), where RESEARCH predicted HIT; the CDN had no copy yet. The STALE reading triggered one regeneration: `vercel logs runtime --environment preview --deployment dpl_Dg56rHQMmtQUyvcJxpGrNiJjiC4w --since 25m --json --query "spike s2 edition"` shows exactly one line, `2026-11-15T14:42:11.947Z info spike s2 edition kv=ok class=none mode=ok n=6 ms=24`, one higher than the build's last value (5). The HTML size changed between readings 2 and 3 (332,959 to 332,963 bytes), which shows the page really was regenerated.

(b) and (d) ISR on `/spike/s2` (120 s companion), readings spaced about 130 s:

| UTC | x-vercel-cache | age | body n |
| --- | --- | --- | --- |
| 14:26:37 | PRERENDER | 0 | 1 |
| 14:28:57 | STALE | 140 | 1 |
| 14:31:08 | STALE | 130 | 2 |
| 14:33:21 | STALE | 132 | 3 |
| 14:36:07 | STALE | 165 | 4 |
| 14:36:34 | HIT | 26 (reset) | 5 |
| 14:44:05 (the task's verify call) | served the n=5 entry, which triggered one more regeneration (n=6, not observed) | | 5 |

The counter rose by one per window and the body is `application/json` with `"kv":"ok"` unescaped, as the greps need. With 130 s spacing against a 120 s window every reading after the first lands past the window, so each is STALE and starts a regeneration; the HIT with a reset age appears when a reading follows within the window (26 s). The route handler sends no `x-nextjs-prerender` header; `/` does. The Upstash console was not read: the counters are the page body's n values.

Verdict, ok mode: **static preserved**. A live KV call inside the edition callback runs at build time and on ISR regeneration, `/` stays static with its 900 s window, and the KV call ran once per regeneration of `/`. This matches RESEARCH F3: inside `unstable_cache` the SDK's `cache: "no-store"` fetch is inert and does not turn the route dynamic.

Notes for Phase 23 from ok mode:

- The edition callback ran 5 times in one preview build, so a KV call inside it costs 5 round trips per build. The product's `budget {` lines report `kvCmd` 0 for these runs: the spike's KV calls are outside the product's own counter, so they are counted in "Spike's own writes" below.
- The warm KV call took 6 to 56 ms from iad1; the cold first call 177 to 206 ms.

### S2 with KV failure injected (badtoken, badhost, blackhole)

- Date (UTC): 2026-11-15, deployments 14:45 to 14:47, readings 14:47 to 15:05. Vantage: preview (Vercel, iad1). Next 16.4.1, spike commit 785e2c3 (the same code as ok mode; only `SPIKE_KV_MODE` differs, passed by `--build-env` and `--env`)
- Deployments, all READY, preview, Vercel Authentication on, each answering the unauthenticated probe with a 302 to https://vercel.com/ before its first route request:

| Mode | Deployment ID | Probe (UTC) | First route request (UTC) |
| --- | --- | --- | --- |
| badtoken | dpl_9SdYsd2xumMPqPDz7yfHA8PcVT79 (`https://havadis-news-jv9bvlp0y-mfkocalars-projects.vercel.app`) | 14:46:08 | 14:47:42 |
| badhost | dpl_HtNYBZn2BVjoNPL9ULwF1ShTx9C8 (`https://havadis-news-euqrvinel-mfkocalars-projects.vercel.app`) | 14:46:41 | 14:47:44 |
| blackhole | dpl_EzxQnwgkx2QvYVQaawbc6jbZwPBp (`https://havadis-news-27yeb3wv4-mfkocalars-projects.vercel.app`) | 14:47:21 | 14:47:48 |

The failure fixtures are fixed fake literals in spike code: the token `spike-invalid-token`, the host `https://spike-nonexistent.invalid` and the address `https://10.255.255.1`. The three `/` ISR windows ran side by side: reading 1 on all three at 14:47:42 to 14:47:48, reading 2 at 15:04:04 to 15:04:07 (16 min 22 s after reading 1), reading 3 at 15:05:10 to 15:05:13.

Per-mode results:

| Mode | Deployment state | `/` build-log edition lines (5 runs, class and ms) | `/` ISR window (x-vercel-cache, age) | `/` runtime line (the one regeneration) | /spike/s2 kv | errorClass | /spike/s2 ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| badtoken | READY | `kv=failed class=auth`, 81 to 183 ms | PRERENDER 0, STALE 982, HIT 61 (reset) | `15:04:10.068Z kv=failed class=auth mode=badtoken n=0 ms=110` | failed | auth | 155 (build), 90, 109 |
| badhost | READY | `kv=failed class=network`, 13 to 39 ms | PRERENDER 0, STALE 980, HIT 61 (reset) | `15:04:11.036Z kv=failed class=network mode=badhost n=0 ms=17` | failed | network | 199 (build) |
| blackhole | READY | `kv=failed class=timeout`, 1,501 to 1,504 ms | PRERENDER 0, STALE 978, HIT 60 (reset) | `15:04:13.853Z kv=failed class=timeout mode=blackhole n=0 ms=1505` | failed | timeout | 1500 (build) |

All three: `/` and `/spike/s2` are static in the build route table (`/` 15m, `/spike/s2` 2m, same rows as ok mode), the build's `Generating static pages` step reached 28/28, and the HTML size of `/` changed on the regeneration (332,959 to 312,661 bytes on all three), so each page really was regenerated with KV failing. `x-nextjs-prerender` was 1 on every `/` reading. Each runtime query (`vercel logs runtime --environment preview --deployment <id> --since 25m --json --query "spike s2 edition"`) returned exactly one `kv=failed` line, with the class that mode predicts.

Blackhole build cost: the edition callback ran 5 times at build and each waited for the 1.5 s client timeout (1,501 to 1,504 ms), so there was no hang. The build's static-page step took 13.9 s against 8.5 s (ok), 8.8 s (badtoken) and 8.5 s (badhost), about 5 s longer, not 1.5 s, because the 5 waits add up (partly overlapped). The total "Build Completed" figure is noisier (22 s ok, 16 s badtoken, 16 s badhost, 21 s blackhole) and is not used. At runtime the one regeneration of `/` paid the 1.5 s timeout once (ms=1505).

Shared cache entry across deployments (measured, not predicted). The `/spike/s2` callback has the same source text and key (`spike-s2-v1`) in every deployment, so the four previews share one `unstable_cache` entry. The HIT readings show it: at 14:50:49 the badhost deployment and at 14:50:51 the blackhole deployment served a body with `"mode":"badtoken"` written at 14:50:21 by the badtoken deployment's regeneration, and the plan's own verify call on the blackhole deployment (15:06:31) got the same badtoken body. So for `/spike/s2` only the build-time body and the readings before the first cross-deployment regeneration are own-mode evidence (the table's `/spike/s2` column uses only those). The plan's greps for `"kv":"failed"` pass on that foreign body, so they show only that a failed value was served. This does not touch the `/` verdicts: each deployment's own runtime log shows its own `/` callback ran once in its own mode (the three regenerations began within 3 s of each other, while the shared entry was stale). Whether a preview shares its Runtime Cache entries with production for the edition key was not measured.

Classification caveat: `errorClass` is decided by error name only. `@upstash/redis` 1.41.0 drops the HTTP status: a rejected request arrives as `UpstashError` with no status field, so the auth class is "the store answered with an error". A bad token and an exhausted quota would look the same by name. The SDK's fetch `TypeError` maps to network and the abort `TimeoutError` to timeout.

**S2 verdict (SC1): a KV call inside the edition callback keeps `/` static at build and on ISR regeneration, also with KV failing (bad token, unresolvable host, black-holed address).**

Basis: build time and ISR regeneration on `/` are measured directly in all four modes (ok, badtoken, badhost, blackhole): READY build, `/` static in the route table, PRERENDER then STALE after the window then HIT with age reset (ok mode also shows an early HIT), and one runtime edition line per regeneration. `/spike/s2` is a 120 s companion on the same `cachedSnapshot` seam, and no claim rests on it alone. The local build with no KV env at all gives the same result.

Phase 23 implications:

1. A fail-open try/catch is required inside `produceEdition` around every KV call, covering client construction. With it, all three failure modes left the build green and `/` static. This spike never tested a throwing KV call, so the cold-build failure it would cause rests on `snapshot.ts` item 7(3), not on a measurement here.
2. The KV-down path must also cover over-quota (an undocumented Free-plan behaviour, F16). The SDK reports any non-2xx answer as the same `UpstashError` without a status, so if Phase 23 needs to tell an auth fault from over-quota it needs the status from its own fetch wrapper.
3. Keep the 1.5 s client timeout. A black-holed store adds about 1.5 s to a regeneration and about 5 s to a build (5 callback runs), where an unbounded call could stall both.
4. The edition callback runs several times per build (5 on the preview, 10 locally), so a KV call inside it costs that many round trips at build time, and the product's `kvCmd` counter must count each one.
5. Runtime Cache entries with the same key and callback source are shared across deployments of the project. Phase 23 must not assume a deployment's callback runs on its own regeneration, and any KV key must carry the environment (as the spike's `spike:<VERCEL_ENV>:` prefix does).

## Marketplace env scoping

Vantage: dashboard through `vercel env ls` on 2026-11-15 (names, types and environments only; values show as Hidden and were never read).

| Variable | Type | Environments |
| --- | --- | --- |
| KV_REST_API_URL | Secret | Preview, Production |
| KV_REST_API_TOKEN | Secret | Preview, Production |
| KV_REST_API_READ_ONLY_TOKEN | Secret | Preview, Production |
| KV_URL | Secret | Preview, Production |
| REDIS_URL | Secret | Preview, Production |

Answer to the Production-only question (D-06): the Marketplace integration injected the variables into Preview as well as Production (created 2 days before the check, all five alike). A preview can therefore reach the store: the ok-mode preview above wrote `spike:preview:` keys and read the counter back (INCR returned 1 to 6). The user reported in Plan 21-02 that one resource (`upstash-kv-aqua-horizon`) is connected to both environments, so this is the production-intended store, not a separate one. Restricting the variables to Production is a setting the user can change later; this plan did not change it. Until then every preview deployment can read and write the same store, which is why all spike keys sit under `spike:<VERCEL_ENV>:` and the Plan 21-06 cleanup deletes `spike:*`.

## Spike's own writes

Every spike deployment and regeneration is counted here so Plans 21-06 and 21-07 can subtract them from the dashboard reading (D-05). Each deployment's build runs the product's own build-time producers, which write Runtime Cache entries and print `budget {` lines in the build log.

| Deployment | Label | Created (UTC) | Routes prerendered at build | Build-time producer lines (from the build log) | Upstash writes |
| --- | --- | --- | --- | --- | --- |
| dpl_C64KnfaffJ3mQ6xtuHek3TD1fxZ3 | s4 | 2026-11-15 13:57 | 26 static pages generated (the build log's own count: `/`, `/about`, `/feeds`, `/feed.xml`, `/feed.json`, the `/feed/[name]` paths and `/_not-found`); `/spike/s4` is dynamic | edition 5, kev 1, ssvc 1, epss 1, render 1, each reporting `rcW` 1 (render `rcR` 4) and `kvCmd` 0 | none |
| dpl_2xexgZwb35NrMwCRTaXEbRS16JJn | s1 and s3 (one deployment serves both labels) | 2026-11-15 14:02 | 27 static pages generated (the build log's own count; adds `/spike/s1`); `/spike/s3` and `/spike/s4` are dynamic | edition 5, kev 1, ssvc 1, epss 1, render 1 (same counts as the s4 build), plus the s1 build generation: 1 outer-run, 2 inner-run nested, 1 inner-run control | none |
| dpl_Dg56rHQMmtQUyvcJxpGrNiJjiC4w | s2-ok | 2026-11-15 14:25 | 28 static pages generated (the build log's own count; adds `/spike/s2`); `/spike/s3` and `/spike/s4` are dynamic | edition 5, kev 1, ssvc 1, epss 1, render 1 (9 budget lines, same counts as the earlier previews; the product's `kvCmd` still reads 0), plus 5 edition-callback KV calls and 1 `/spike/s2` KV generation | 12 commands at build (6 regenerations of 2 commands: INCR and SET) |
| dpl_9SdYsd2xumMPqPDz7yfHA8PcVT79 | s2-badtoken | 2026-11-15 14:45 | 28 static pages generated (build log count); `/spike/s3` and `/spike/s4` are dynamic | edition 5, kev 1, ssvc 1, epss 1, render 1 (9 budget lines), plus 5 edition-callback KV attempts and 1 `/spike/s2` attempt, all `kv=failed class=auth` | none: each attempt sent 1 INCR with an invalid token, which the store rejected, so no key was written |
| dpl_HtNYBZn2BVjoNPL9ULwF1ShTx9C8 | s2-badhost | 2026-11-15 14:46 | 28 static pages generated | same 9 budget lines, plus 5 edition-callback attempts and 1 `/spike/s2` attempt, all `kv=failed class=network` | none: the host does not resolve, nothing reached the store |
| dpl_EzxQnwgkx2QvYVQaawbc6jbZwPBp | s2-blackhole | 2026-11-15 14:47 | 28 static pages generated | same 9 budget lines, plus 5 edition-callback attempts and 1 `/spike/s2` attempt, all `kv=failed class=timeout` at about 1,500 ms | none: the address is non-routable, nothing reached the store |
| dpl_GwvgDKPQKXJwPibHJ5rWNS9xPgni | shapes harness (ok mode) | 2026-11-16 15:00 | 28 static pages generated (build log count); adds `/spike/shapes` as a dynamic route | edition 5 callbacks (the log shows `spike s2 edition kv=ok n=7` to `n=11`), kev 1, epss 1, render 1; the product's `kvCmd` reads 0 | about 12 commands at build by the same structure as s2-ok (5 edition-callback regenerations and 1 `/spike/s2` generation, 2 commands each; counted from log lines, not read from the console), plus the self-test commands below; all keys removed by the cleanup call |

Request-time writes by `/spike/s4`: none to any cache. The route is force-dynamic and fetches the EPSS file at most twice per call (one cancelled header read for the hop trace, one streamed read through the wrapper), plus one wrapper call for the cyentia start URL whose body is cancelled. It was called twice on the preview for the measurement, once more by the task's own verify command, and once on the local build, so the full file was streamed four times in total (one over the plan's limit of three, caused by the verify call; noted as a deviation in the SUMMARY).

Request-time writes on dpl_2xexgZwb35NrMwCRTaXEbRS16JJn:

- `/spike/s1` regenerated 3 times in the runtime logs (14:05:01, 14:07:12, 14:09:25), after 1 generation at build. Each generation runs 1 outer callback, 2 bypassed nested inner callbacks and 1 control inner callback, so by the product's own cache model (F1, confirmed by the write probe) each generation stores up to 4 `unstable_cache` entries plus the page's own ISR write. That is up to 16 Runtime Cache entries for the 4 generations and 4 ISR page writes; these are modelled from the logged callback counts, not read from the dashboard.
- `/spike/s3` was called twice (14:02:49 and 14:07:13). The first ran its callback (1 `spike-s3-v1` entry written, 5 conditional upstream requests plus 1 wrapper request, 3 unconditional validator requests); the second returned the stored result.
- Upstream etiquette: the three validator requests per fresh run, the KEV If-None-Match 200 (1.85 MB) once per fresh run, and one extra CVE record request per fresh run. One local run and one fresh preview run were made, plus about 19 laptop requests to the CVE record while choosing the ID and isolating the Cache-Control cause (above the plan's one-record-per-run limit; the CVE Program API's own limit is 25,000 requests per minute).
- Total spike deployments by this plan: 2 (approved up to 3 at the Task 1 gate: s4, s1, s3).

Request-time writes on dpl_Dg56rHQMmtQUyvcJxpGrNiJjiC4w (s2-ok, Plan 21-05):

- `/` regenerated once at runtime (14:42:11Z, one `spike s2 edition kv=ok n=6` line): 26 write units by the plan's model (not read from the dashboard) and 2 KV commands under `spike:preview:edition:`.
- `/spike/s2` regenerated 4 times in the readings (n=2 to 5, 14:28:59 to 14:36:08) and once more after the verify call at 14:44:05 (n=6, not observed): 5 regenerations, 10 KV commands under `spike:preview:s2:`.
- Total for this deployment: 24 KV commands (12 at build, 2 for `/`, 10 for `/spike/s2`), against 500K per month. Keys written: `spike:preview:edition:regen`, `spike:preview:edition:ts`, `spike:preview:s2:regen`, `spike:preview:s2:ts`. They stay until the Plan 21-06 cleanup.
- The reading calls were `vercel curl` only (4 on `/`, 7 on `/spike/s2` including the verify call), plus the unauthenticated probe.

Request-time writes on the three failure-mode deployments (Plan 21-05 Task 3):

- `/` regenerated once at runtime on each (15:04:10, 15:04:11 and 15:04:13Z): 26 write units each by the plan's model (not read from the dashboard), plus 1 KV attempt each, none of which stored a key.
- `/spike/s2` regenerations are not counted per deployment, because its `unstable_cache` entry is shared across the four previews (see the S2 entry): the `/spike/s2` callback logs nothing, so how many callbacks ran per deployment was not counted. Each callback that ran was 1 failed KV attempt and no key.
- No Upstash key was written by these three deployments. The only keys this plan wrote are the four from s2-ok above.
- Reading calls were `vercel curl` only: 3 on `/` and 3 on `/spike/s2` per deployment (the blackhole deployment had 1 more on `/spike/s2` from the verify call), plus the unauthenticated probe.
- Total spike deployments by this plan: 4, all approved at the gate=21-05 reconfirm (s2-ok, s2-badtoken, s2-badhost, s2-blackhole). The harness label was not approved and was not deployed. Six spike deployments are listed in all, out of Hobby's 100 per day.

Request-time writes on dpl_GwvgDKPQKXJwPibHJ5rWNS9xPgni (shapes harness, Plan 21-06 Task 1):

- Deployed at 2026-11-16 15:00Z after the gate=21-06 approval line (15:00:28Z, `approved=harness count=1`). The unauthenticated probe at 15:01:19Z answered 302 to `https://vercel.com/sso-api` (Vercel Authentication) before any request to `/spike/shapes`.
- Self-test, all through `vercel curl`: seven shapes at `reps=1` (by F16's predictions 66 commands in total: 1, 20, 22, 1, 1, 1, 20), `shape=bogus` and `reps=51` (both rejected with 400 before any KV client was built, so 0 commands), and one cleanup call (SCAN, DEL and a second SCAN of `spike:*`, a handful of commands that the SCAN and DEL count does not predict). The cleanup returned `remaining` 0, which also removed the four Plan 21-05 S2 keys and the keys the build wrote.
- Total spike deployments by this plan: 1, approved at the gate=21-06 line. Seven spike deployments are listed in all, out of Hobby's 100 per day.

## Upstash command count per batched call

Vantage: preview (harness self-test) for the route behaviour; the measured counts come from the Upstash console counter as the user reads it (vantage: dashboard) after the Task 2 reading and are not in this entry yet.

Harness: route `/spike/shapes` on dpl_GwvgDKPQKXJwPibHJ5rWNS9xPgni (spike branch only, never merged), operator script `spike/shapes.sh` (idle reading of 120 s, then one 50-rep run per shape with 90 s of counter lag wait, drift correction from the idle reading, then cleanup). Every key sits under `spike:<VERCEL_ENV>:shapes:` and the route can touch nothing else (D-06).

Predicted counts (F16 of the research; these are predictions, not measurements):

| Shape | Predicted commands per call | Basis |
| --- | --- | --- |
| mget20 | 1 | MGET of many keys counts as one command (predicted) |
| pipe20 | 20 | each command in a pipeline is billed individually (predicted) |
| multi20 | 22 | a transaction of N counts N + 2 (predicted) |
| hset20 | 1 | one HSET with 20 field/value pairs, assumed to count as one (A4, predicted, the least certain) |
| hgetall | 1 | predicted |
| mset20 | 1 | one per call (predicted) |
| promiseall20 | 20 | the SDK auto-pipelines, each command still counts one (predicted) |

Per-regeneration layout from STACK.md (the 4-command layout): one HGETALL, one HSET, one MGET and one MSET are 4 commands if the predictions hold.

Over-quota behaviour on Free: undocumented, not tested (it would spend the 500K quota).

Self-test result (vantage: preview): all seven shapes returned `ok: true` at `reps=1`; `shape=bogus` and `reps=51` returned 400; cleanup returned `remaining` 0.

The measured counts and the verdict on the 4-command layout are added after the Task 2 counter reading.
