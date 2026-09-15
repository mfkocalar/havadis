# Walking Skeleton — Havadis

**Phase:** 1
**Generated:** 2026-09-15

## Capability Proven End-to-End

An anonymous visitor loading `/` on the deployed-or-production-built app sees real Krebs on Security articles from the last 24 hours, rendered as newspaper-style cards, served from Next.js's Data Cache rather than a fresh fetch on every request.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework | Next.js 16.3.5, App Router, TypeScript, `--src-dir` | Locked in `.claude/CLAUDE.md` and PROJECT.md before project init. `--src-dir` puts everything under `src/`, so `@/*` resolves to `./src/*`. |
| Rendering | Server Components only; `src/app/page.tsx` awaits `getFrontPage()` directly | No Route Handler indirection (ARCHITECTURE.md Anti-Pattern 1). Zero client JS needed in Phase 1 — the absolute-time-on-hover requirement is a native `title` attribute. |
| Data layer | **None.** No database anywhere. The only persistence is Next.js's per-URL fetch Data Cache (`next: { revalidate: 900 }`). | PROJECT.md statelessness constraint: the cache is a disposable, regenerable artifact, not source-of-truth state. `cacheComponents` stays OFF (default). |
| Feed fetch | Native `fetch()` for raw XML + `rss-parser@3.13.0` `parseString()` | `rss-parser`'s own `parseURL()` uses Node's raw `http`/`https` client, which is invisible to Next's Data Cache — using it would silently delete the entire caching behavior this app is built around. |
| Egress safety | `redirect: 'manual'` + validate-then-refetch loop in `fetchWithValidatedRedirect` | INGEST-03 requires validating a redirect target *before* following it. `redirect: 'follow'` (fetch's default) commits to following before app code sees the response, making the requirement unenforceable after the fact. |
| Timeout | Per-hop `AbortController`, 8s, max 5 hops | A redirect chain must not be able to multiply the effective timeout budget. |
| Failure posture | Fetcher never throws — returns `{ status: 'ok' | 'error' }`; page always renders its full layout | D-03: a dead source produces a quiet empty-state message, never a broken page. This is the seam Phase 2's 13-source failure isolation builds on. |
| Auth | **None, deliberately.** No middleware, no session cookie, no login route, no `src/middleware.ts`. | UI-06 requires the *absence* of this tier. This is an architectural decision to record, not code to write. |
| Visual direction | "Modern editorial" — sans-serif headlines, generous whitespace, cards with subtle shadows (TechCrunch/The Verge feel) | D-02. Establishing decision for all 4 phases' components; rated `costly` to reverse. |
| Test runner | Node's built-in `node --test` running `.ts` files directly (native type stripping, Node v26.3.1) | Zero new dependencies, matching the project's minimal-deps posture. **Constraint:** type stripping does not resolve the `@/*` path alias, so value imports inside `src/lib/**` use relative paths; `@/*` is reserved for `src/app/**` and `src/components/**`. |
| Directory layout | `src/lib/types.ts`, `src/lib/config/sources.ts`, `src/lib/pipeline/*.ts`, `src/app/page.tsx`, `src/components/*.tsx` | ARCHITECTURE.md's recommended structure, adopted from the first commit rather than refactored into later. |
| Deployment target | Vercel (Hobby/free tier) | Locked. No cron (Hobby caps cron at once/day, incompatible with a 15-min window), no KV, no DB. |

## Stack Touched in Phase 1

- [ ] Project scaffold (Next.js 16 + TypeScript + Tailwind 4 + ESLint, build + lint working)
- [ ] Routing — one real route: `/` (`src/app/page.tsx`), public and unauthenticated
- [ ] Data layer — no DB by design; instead **one real external read** (live Krebs RSS fetch) and **one real cache write/read** (Next Data Cache entry under `next.revalidate: 900`)
- [ ] UI — article cards rendering real fetched data, plus the D-03 empty state; native `title` hover for absolute time
- [ ] Deployment — documented local full-stack run: `npm run build && npm start` (NOT `next dev`, which never caches — see below)

## The One Non-Obvious Verification Constraint

Next.js **never** caches pages in development: `next dev` re-runs `getFrontPage()` and refetches the source on every single request regardless of `next.revalidate`. Success Criterion 4 (~15-minute identical cached snapshot) is therefore **unobservable under `next dev`** and must be verified against `npm run build && npm start` or a deployed Vercel preview. Any later phase debugging "the cache doesn't work" against `next dev` is debugging the wrong environment.

## Out of Scope (Deferred to Later Slices)

Explicit, so later phases do not re-litigate Phase 1's minimalism:

- The other 12 sources, parallel fan-out, per-source failure isolation (Phase 2, INGEST-01/02)
- Deduplication, 7-section keyword classification, urgency ordering, recency+weight ranking, CVE chips (Phase 3, NORM-02 / CLASSIFY-01/02/03 / UI-03)
- Full 7-section newspaper layout, "last updated" timestamp, per-section counts, client-side category filter, verified narrow-viewport polish (Phase 4, UI-01/04/05 / FILTER-01)
- Full 6-tier source-tier badge color palette — only the Security Research tier's color is picked now (CONTEXT.md Deferred Ideas)
- Per-source health/diagnostics indicator ("1 source unavailable") — HEALTH-01, v2
- Private-IP-range SSRF denylist — PITFALLS.md scopes this to the 13-source hardening pass; Phase 1's INGEST-03 scope is explicitly narrower (HTTPS + same-host)
- `fast-xml-parser` fallback parser — Krebs's feed is well-formed standard RSS 2.0; the package also currently carries a `[SUS]` "too-new" registry signal, so adding it requires a fresh legitimacy check plus a blocking human checkpoint
- Any archive, account, search, or RSS-output feature (v2 / out of scope per REQUIREMENTS.md)

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- **Phase 2:** the same `SourceConfig[]` array grows from 1 to 13 entries and `getFrontPage()` fans out in parallel; the fetcher-never-throws contract established here is what makes one dead feed harmless.
- **Phase 3:** new pure transforms (dedupe, classify, rank, CVE extract) slot between `filterLookback()` and render inside the same orchestrator — no fetch or cache changes.
- **Phase 4:** the flat card list established here becomes section groups with metadata, and the first Client Component (the category filter) is added over the already-rendered snapshot.

---
*This file is a contract, not a scratchpad. Later phases build on these decisions rather than revisiting them.*
