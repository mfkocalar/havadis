# Phase 21 platform facts (PLAT-03 spike record)

Purpose: record the platform facts that Phase 23 (KV, conditional GET) and Phase 26 (EPSS bulk file) are designed on. Each fact was predicted from source and laptop probes in the Phase 21 research (F1, F5 to F8) and is confirmed here from the place it matters. Requirement PLAT-03, decisions D-05, D-07, D-08, D-12.

Rule: every entry names its vantage point, one of preview (a Vercel preview deployment, Vercel egress), local build (`next build` and `next start` on the laptop), laptop (a plain probe from the laptop), dashboard, or docs. A fact measured only locally or from the laptop is never recorded as measured on Vercel.

Spike code lives on branch `spike/21-platform-facts` in the separate git worktree `/Users/mkh/CyberSecurity/havadis-spike-21`, created from `origin/main` (f403978). It is never merged and never pushed, and no spike route or dependency exists on `feat/public-product-v1` or `main`. The previews are CLI deployments (`vercel deploy --yes`) behind Vercel Authentication, reached only through `vercel curl`. Plan 21-07 removes them after the user approves its guard table.

Entries added by Plan 21-04: Setup facts, S4, S1, S3, Spike's own writes. Plan 21-05 adds S2 and environment scoping, Plan 21-06 adds the Upstash command shapes, the CVSS coverage and the Usage share, and Plan 21-07 adds the summary table.

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

## Spike's own writes

Every spike deployment and regeneration is counted here so Plans 21-06 and 21-07 can subtract them from the dashboard reading (D-05). Each deployment's build runs the product's own build-time producers, which write Runtime Cache entries and print `budget {` lines in the build log.

| Deployment | Label | Created (UTC) | Routes prerendered at build | Build-time producer lines (from the build log) | Upstash writes |
| --- | --- | --- | --- | --- | --- |
| dpl_C64KnfaffJ3mQ6xtuHek3TD1fxZ3 | s4 | 2026-11-15 13:57 | 26 static pages generated (the build log's own count: `/`, `/about`, `/feeds`, `/feed.xml`, `/feed.json`, the `/feed/[name]` paths and `/_not-found`); `/spike/s4` is dynamic | edition 5, kev 1, ssvc 1, epss 1, render 1, each reporting `rcW` 1 (render `rcR` 4) and `kvCmd` 0 | none |

Request-time writes by `/spike/s4`: none to any cache. The route is force-dynamic and fetches the EPSS file at most twice per call (one cancelled header read for the hop trace, one streamed read through the wrapper), plus one wrapper call for the cyentia start URL whose body is cancelled. It was called twice on the preview for the measurement, once more by the task's own verify command, and once on the local build, so the full file was streamed four times in total (one over the plan's limit of three, caused by the verify call; noted as a deviation in the SUMMARY).
