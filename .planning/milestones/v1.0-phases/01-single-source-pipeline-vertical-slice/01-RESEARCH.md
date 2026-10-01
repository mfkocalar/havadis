# Phase 1: Single-Source Pipeline (Vertical Slice) - Research

**Researched:** 2026-09-15
**Domain:** Next.js 16 App Router scaffold + first real RSS fetch/cache/render slice (Krebs on Security)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** The single real source for this phase is **Krebs on Security** (`https://krebsonsecurity.com/feed`, Security Research tier). — Reversibility: reversible — swapping the one configured source is a one-line change in `lib/config/sources.ts`; no downstream logic depends on which specific source it is.
- **D-02:** Front page visual direction is **"Modern editorial"** — sans-serif headlines, generous whitespace, card-based layout with subtle shadows. Reads like a modern tech-news site (TechCrunch/The Verge), not a literal broadsheet-newspaper pastiche and not a dark terminal/hacker aesthetic. — Reversibility: costly — establishing decision for all 4 phases' components.
- **D-03:** If the single configured source times out, fails, or returns zero articles within the 24h lookback, the page still renders its full layout (masthead, structure) with a **quiet empty-state message** (e.g. "No articles in the last 24 hours") rather than a skeleton placeholder or a bare empty section with no copy. — Reversibility: reversible.
- **D-04:** Source tier (e.g. "Security Research") is shown as a **colored text label/pill** next to the source name — distinct color per tier, not a plain-text-only badge and not an icon+label combo. — Reversibility: reversible. Only the "Security Research" tier's color needs to be picked in Phase 1.

### Claude's Discretion

- Exact accent color values, spacing scale, and typography choices within the "Modern editorial" direction (D-02).
- Whether the Phase 1 page shows a single generic section header (e.g. "Latest") or no header at all above the flat article list.
- Mechanism for the absolute-time-on-hover requirement (UI-02) — native `title` attribute vs. a custom tooltip component; either satisfies the requirement.
- Full 6-tier badge color palette beyond Security Research (deferred, incremental).

### Deferred Ideas (OUT OF SCOPE)

- Full 6-tier color palette for source-tier badges — finalize incrementally (Phase 2) or in Phase 4 polish; only Security Research's color is needed now.
- Per-source health/diagnostics indicator ("1 source unavailable") — REQUIREMENTS.md's HEALTH-01, explicit v2 scope, not this phase.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INGEST-03 | Each source fetch enforces a per-source timeout (~8s) and validates any redirect target (HTTPS only, same host) before following it | See "Architecture Patterns → Pattern 1: `fetchWithValidatedRedirect`" and "Common Pitfalls → Pitfall P1-1" — includes a live-verified redirect case (Krebs's own configured URL) and the `redirect: 'manual'` + manual re-fetch pattern needed because native `fetch` cannot validate-then-follow atomically |
| INGEST-04 | Only articles published within the last 24 hours (per source, at fetch time) are considered | See "Code Examples → 24h lookback filter"; trivial pure-function filter over `isoDate`/`pubDate`, applied right after normalization per ARCHITECTURE.md's already-planned structure |
| INGEST-05 | The front page is served from Next.js's per-URL fetch cache with a ~15 minute revalidation window | See "Architecture Patterns → Pattern 2" and "Common Pitfalls → Pitfall P1-4" (dev-mode cache bypass) — confirms `next: { revalidate: 900 }` alone (no `cache: 'force-cache'` needed) is sufficient per official docs, and that this criterion is unverifiable under `next dev` |
| NORM-01 | Each article is normalized to a common shape: title, url, source, source tier, published time, summary | See "Code Examples → normalize.ts" — verified against Krebs's actual live feed field-by-field |
| UI-02 | Article card shows source name, tier badge, verbatim title, summary, relative+absolute time, link to original | See "Code Examples → ArticleCard skeleton" and "Don't Hand-Roll" (relative-time formatter) |
| UI-06 | The site is fully public — no login, no authentication anywhere | No auth code exists anywhere in the stack researched; nothing to build, only to avoid introducing (see Security Domain) |

</phase_requirements>

<claude_md_constraints>
## Project Constraints (from CLAUDE.md)

- Tech stack is locked: Next.js (App Router, TypeScript) + Tailwind CSS on Vercel — not open for re-litigation.
- Must run on Vercel free tier: no paid DB/KV, no cron beyond free-tier daily cap.
- Statelessness: the only "state" is Next.js's own Data Cache (disposable/regenerable) — no database anywhere.
- Pin `typescript@^5.7` explicitly rather than trusting bare `latest` (which resolves to the `7.x` line). **Research below found this warning does not apply to the `create-next-app` scaffold itself** — see Common Pitfalls P1-6.
- Use native `fetch(url, { next: { revalidate } })` for the raw XML text, then `rss-parser.parseString()` to structure it — never `rss-parser`'s own `parseURL()` (bypasses Next's Data Cache).
- `cacheComponents` stays **off** (default) — do not add `cacheComponents: true` to `next.config.ts`.
- No `date-fns` for relative timestamps — hand-roll a ~15-line formatter (24h window collapses to 3 cases: minutes / hours / "just now").
- GSD workflow enforcement: file edits must go through a GSD command (`/gsd-execute-phase` for this planned phase work), not direct ad-hoc edits.

</claude_md_constraints>

## Summary

This phase scaffolds the Next.js 16 project **in place inside an existing, non-empty repo** (`.git/`, `.claude/`, `.planning/`, `.gitignore` already exist) and wires exactly one real, already-verified-live RSS source (Krebs on Security) through fetch → normalize → 24h-trim → cache/revalidate → render, on a public unauthenticated page. Everything in the pre-existing `STACK.md`/`ARCHITECTURE.md`/`PITFALLS.md` research holds and is not re-derived here; this document adds only what's specific to standing up *this* phase: (1) `create-next-app` **refuses to scaffold** into this exact repo as-is because of the `.planning/` directory — verified this session with a byte-for-byte repro — and needs a documented workaround; (2) the Krebs feed, live-fetched and parsed this session, is a clean, standard RSS 2.0 feed reachable with a default `fetch` User-Agent from this network — the anti-bot mitigation PITFALLS.md flags for Krebs could not be reproduced from here (see Assumptions Log — it remains an open, Vercel-specific question, not refuted); (3) the exact configured feed URL from CONTEXT.md D-01 (`https://krebsonsecurity.com/feed`, no trailing slash) 301-redirects, same-host/HTTPS, to `/feed/` — a live, naturally-occurring exercise of INGEST-03's redirect-validation path; and (4) Next.js's persistent Data Cache is fundamentally unverifiable under `next dev` (dev mode always refetches), which changes how Success Criterion 4 (~15 min cache) must be checked during this phase.

**Primary recommendation:** Move `.planning/` aside before running `create-next-app` (it is the one existing path that blocks the scaffold), scaffold with `--src-dir --typescript --tailwind --eslint --app --disable-git --yes`, restore `.planning/` and manually re-append the pre-existing `.gitignore` line, then build `lib/pipeline/fetchSource.ts` around a `redirect: 'manual'` + validate-then-refetch loop (not automatic redirect-following) so INGEST-03's "validate before following" requirement is actually enforced rather than assumed.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| RSS fetch + XML parse | API/Backend (Server Component call graph, no Route Handler) | — | `fetch()` inside a Server Component is the same Vercel Function; no separate backend service exists or is needed (ARCHITECTURE.md Pattern 1, reaffirmed) |
| Redirect/SSRF validation | API/Backend | — | Must happen inline in the fetch wrapper, server-side, before any bytes from the redirect target are trusted — cannot be delegated to the browser or a CDN layer |
| 24h lookback / normalization | API/Backend (pure functions) | — | Pure `Article[]` transforms, no I/O, run inside the same request/revalidation cycle as the fetch |
| Revalidation/caching | CDN/Static (Vercel Data Cache) | API/Backend (triggers it via `fetch` options) | The cache itself is Vercel's platform layer; the app only configures it via `next.revalidate` — there is no app-owned cache-store code |
| Article card rendering | Frontend Server (SSR) | Browser/Client (hover-title tooltip is native HTML, zero JS) | Server Component tree renders the full page; the only client-side behavior in Phase 1 (native `title` attribute hover) needs no Client Component at all |
| Auth / access control | — (none) | — | UI-06 requires *absence* of this tier entirely; no middleware, no session cookie, no login route should be introduced |

## Standard Stack

> Builds on `.planning/research/STACK.md` (already HIGH confidence, verified 2026-09-14). This table records only what changed or was re-verified live today (2026-09-15) for this phase's actual install list.

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16.3.5 | Framework, App Router, per-fetch Data Cache | Re-confirmed via `npm view next version` this session: `16.3.5` [VERIFIED: npm registry query, 2026-09-15]. Matches STACK.md. |
| React | 19.2.8 (scaffold-installed) vs. 19.3.0 (STACK.md, dated 2026-09-14) | UI runtime | [VERIFIED: live `create-next-app@latest` scaffold run this session installed `"react": "19.2.8"` and `"react-dom": "19.2.8"` in the generated `package.json`] — a one-day drift from STACK.md's `19.3.0`. Not a blocker either way (both are current 19.x patches auto-selected by the scaffold); do not hand-pin a specific patch, let `create-next-app` choose. |
| TypeScript | `^5` (scaffold default) | Type safety | [VERIFIED: live scaffold's generated `package.json` pins `"typescript": "^5"`, not `latest`/`7.x`] — see Common Pitfalls P1-6: the CLAUDE.md warning about bare `typescript@latest` resolving to `7.0.2` [VERIFIED: `npm view typescript dist-tags` this session returned `"latest": "7.0.2"`] applies only if someone *later* runs `npm install -D typescript@latest`; the scaffold itself never touches that tag. |
| Tailwind CSS | `^4` (scaffold pins `@tailwindcss/postcss@^4`, `tailwindcss@^4`) | Styling | [VERIFIED: live scaffold `package.json` + generated `postcss.config.mjs`/`globals.css`] — CSS-first v4 setup confirmed exactly as STACK.md described (`@import "tailwindcss";` + `{ plugins: { "@tailwindcss/postcss": {} } }`). |
| `rss-parser` | 3.13.0 | Parse Krebs's RSS 2.0 XML | [VERIFIED: npm registry query this session] version unchanged from STACK.md. Field mapping re-verified against Krebs's **live** feed this session (see Code Examples). |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `clsx` | 2.1.1 | Conditional class composition for `SourceTierBadge` | [VERIFIED: npm registry query this session]. Needed as soon as the badge has more than one color variant (even with only 1 tier wired up, the component should be written to accept a `tier` prop and branch — Phase 2 adds 5 more tiers to the same component with zero refactor). |
| `eslint-config-next` | 16.3.5 | Lint | [VERIFIED: npm registry + live scaffold] ships automatically with `create-next-app`. |

**Not installed this phase:**
- `fast-xml-parser` — STACK.md correctly scopes this to "only if a specific feed's XML is malformed/non-standard." Krebs's live feed (fetched and inspected this session) is well-formed, standard RSS 2.0 with no unusual namespaces beyond the common `dc:`/`content:`/`atom:`/`sy:`/`slash:` set `rss-parser` handles natively — no fallback parser is needed for this phase. See Package Legitimacy Audit for why it's flagged if it's ever added later.
- `tailwind-merge` — not needed until a shared component accepts a `className` override prop (not required for Phase 1's fixed card layout, per STACK.md).

### Alternatives Considered

No new alternatives beyond STACK.md's existing table — this phase makes no stack decisions STACK.md didn't already make.

**Installation (this phase, run against the repo root — see Common Pitfalls P1-5 for the required sequencing):**
```bash
npm install rss-parser@3.13.0 clsx@2.1.1
```
(TypeScript, Tailwind, ESLint, and their exact pinned versions come from the `create-next-app` scaffold itself — no separate `npm install -D typescript@^5.7` step is required; see P1-6.)

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `rss-parser` | npm | latest published 2023-04-11 | 702,185/wk | github.com/bobby-brennan/rss-parser | OK | Approved |
| `clsx` | npm | latest published 2024-04-23 | 87,550,818/wk | github.com/lukeed/clsx | OK | Approved |
| `fast-xml-parser` | npm | latest published 2026-08-27 (flagged "too-new") | 59,996,619/wk | github.com/NaturalIntelligence/fast-xml-parser | SUS ("too-new" heuristic) | **Not installed this phase** — not needed (see Standard Stack). If a later phase needs it as the malformed-XML fallback, re-run the legitimacy check at that time and note the "too-new" signal is very likely a false positive against a 60M-download/week package with frequent point releases, not evidence of a hijacked/typosquatted package — but a `checkpoint:human-verify` before install is still required per the gate protocol. |

**Packages removed due to `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** `fast-xml-parser` — not installed this phase, no checkpoint needed yet; re-audit if/when a future phase actually adds it.

## Architecture Patterns

> Builds on `.planning/research/ARCHITECTURE.md` (Patterns 1–3, already HIGH confidence). The two patterns below are Phase-1-specific elaborations needed to satisfy INGEST-03 and INGEST-05 concretely — ARCHITECTURE.md's own example `fetchSource()` (its Pattern 2) does **not** yet implement redirect validation; it only shows the timeout+try/catch shape.

### System Architecture Diagram (Phase 1 scope only)

```
Browser (unauthenticated GET /)
     │
     ▼
Vercel Function (Server Component render)
     │
     ▼
app/page.tsx  ──awaits──>  lib/pipeline/getFrontPage()
                                  │
                                  ▼
                    lib/pipeline/fetchSource(KREBS_CONFIG)
                                  │
                    ┌─────────────┴──────────────┐
                    │ fetchWithValidatedRedirect  │  ← INGEST-03
                    │  - redirect: 'manual'       │
                    │  - AbortController @ 8s     │
                    │  - validate Location:       │
                    │    protocol===https:        │
                    │    host===original host     │
                    │  - re-fetch validated target │
                    │    with next:{revalidate:900}│  ← INGEST-05 (Vercel Data Cache)
                    └─────────────┬──────────────┘
                                  ▼
                    rss-parser.parseString(xmlText)
                                  ▼
                    normalize() → Article shape        ← NORM-01
                                  ▼
                    filterLookback(24h)                 ← INGEST-04
                                  ▼
                    { status: 'ok'|'error', articles }  (never throws)
                                  ▼
              app/page.tsx renders <ArticleCard> list    ← UI-02
              (or D-03's quiet empty-state message)
```

### Pattern 1: `fetchWithValidatedRedirect` — validate before following, not after

**What:** Native `fetch()` cannot inspect a redirect's target before deciding whether to follow it — `redirect: 'follow'` (the default) commits to following before your code runs. To satisfy INGEST-03 ("validates any redirect target ... before being followed"), the fetch must be issued with `redirect: 'manual'`, the `Location` header inspected and validated, and — only if valid — a **second** `fetch()` issued to the validated target. This is a loop (bounded by a max-hop count), not a single call.

**When to use:** For every one of the 13 (eventually) source fetches — not just Krebs. Krebs happens to need it in Phase 1 already: its own configured URL redirects.

**Live-verified redirect case (this session, 2026-09-15):**
```
$ curl -s -o /dev/null -w "http_code=%{http_code} redirect_url=%{redirect_url}\n" \
    "https://krebsonsecurity.com/feed"
http_code=301 redirect_url=https://krebsonsecurity.com/feed/
```
```
$ node -e "fetch('https://krebsonsecurity.com/feed', {redirect:'manual'}).then(r =>
    console.log(r.status, r.type, r.headers.get('location'), r.url))"
301 basic https://krebsonsecurity.com/feed/ https://krebsonsecurity.com/feed
```
[VERIFIED: live curl + live Node `fetch` executed this session against the exact URL configured in CONTEXT.md D-01] Node's native `fetch` (undici) with `redirect: 'manual'` returns a normal `Response` (status `301`, `type: 'basic'`) with a readable `Location` header — **not** an opaque redirect (that's browser-only `fetch` behavior) — so the validation logic below works unmodified server-side.

Because the redirect target here (`https://krebsonsecurity.com/feed/`) is same-host and HTTPS, it is a **legitimate** redirect that must be followed, not rejected — this is a real positive-case exercise of INGEST-03, not just a hypothetical attack scenario.

**Example:**
```typescript
// lib/pipeline/fetchWithValidatedRedirect.ts
const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 5;

export async function fetchWithValidatedRedirect(
  startUrl: string,
  init: RequestInit & { next?: { revalidate?: number } } = {}
): Promise<Response> {
  let currentUrl = new URL(startUrl);
  const originalHost = currentUrl.host;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(currentUrl.toString(), {
        ...init,
        redirect: "manual", // never let fetch auto-follow — we validate first
        signal: controller.signal,
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          throw new Error(`Redirect (${res.status}) with no Location header`);
        }
        const target = new URL(location, currentUrl); // resolves relative Location
        if (target.protocol !== "https:") {
          throw new Error(`Rejected redirect: non-HTTPS target ${target.protocol}`);
        }
        if (target.host !== originalHost) {
          throw new Error(
            `Rejected redirect: host mismatch (${target.host} !== ${originalHost})`
          );
        }
        currentUrl = target; // validated — follow on the next loop iteration
        continue;
      }
      return res; // 2xx (or a non-redirect error status) — caller handles res.ok
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Too many redirects (> ${MAX_REDIRECTS}) fetching ${startUrl}`);
}
```

**Trade-offs:**
- Pros: enforces "validate the *resolved* target, not the string you typed" exactly as INGEST-03 requires; each hop still gets its own `AbortController` timeout, so a redirect chain can't be used to multiply the effective timeout budget.
- Cons: the intermediate (301) response is never persisted in Next.js's Data Cache — [CITED: nextjs.org/docs/app/api-reference/functions/fetch, `lastUpdated: 2026-08-25`, "Only responses with a 200 HTTP status code are stored"] — so if `sources.ts` configures the pre-redirect URL, that hop is re-fetched on every revalidation cycle (not every request — see Pattern 2). See Common Pitfalls P1-2 for the cheap mitigation (configure the canonical post-redirect URL directly).

### Pattern 2: `next.revalidate` alone is sufficient — no `cache: 'force-cache'` needed

**What:** ARCHITECTURE.md's own example already uses `fetch(source.url, { next: { revalidate: 900 }, signal })` without an explicit `cache` option. This is correct, not an oversight to fix: [CITED: nextjs.org/docs/app/guides/caching-without-cache-components, `lastUpdated: 2026-08-25`] shows the canonical time-based-revalidation example as exactly `fetch('https://...', { next: { revalidate: 3600 } })` with no `cache` key set. Specifying `next.revalidate` as a number is itself what opts the request into the persistent Data Cache; `cache: 'force-cache'` is a separate, alternate way to opt in (indefinite caching, no time-based revalidation), not a required companion option.

**When to use:** Every source fetch in this phase and future phases. Do not add `cache: 'force-cache'` alongside `next.revalidate` — [CITED: same doc] "Conflicting options such as `{ revalidate: 3600, cache: 'no-store' }` are not allowed... in development mode a warning will be printed" — while `force-cache` + a `revalidate` number isn't explicitly listed as conflicting, there's no documented benefit to combining them and STACK.md's own example (already correct) omits `cache` entirely.

**Critical interaction with INGEST-03's `AbortController` (verified this session via official docs + cross-checked WebSearch, MEDIUM-HIGH confidence):** [CITED: nextjs.org/docs/app/api-reference/functions/fetch] "To opt out [of *memoization*], pass an `AbortController` signal to `fetch`." This is memoization only — the single-render-pass dedup of identical fetch calls — **not** the persistent Data Cache. The persistent cache (governed by `next.revalidate`) is unaffected by passing a `signal`. This matters because INGEST-03 (timeout via `AbortController`) and INGEST-05 (`next.revalidate` caching) must coexist on the very same fetch call in this phase, and a naive reading of "AbortSignal breaks caching" could lead someone to build a second, redundant caching layer that isn't needed.

**Trade-off worth documenting explicitly in the plan, not discovering during QA:** [CITED: same doc] "In Development, Pages are *always* rendered on-demand and are never cached." Success Criterion 4 ("revisiting the page within ~15 minutes serves the identical cached snapshot... no new network fetch") **cannot be observed under `next dev`** — every request in dev re-runs `getFrontPage()` and refetches, regardless of `revalidate`. Verifying this criterion requires `next build && next start` (or a deployed Vercel preview) and inspecting the `x-vercel-cache` response header / observing that the Krebs origin isn't re-hit within the window. Plan a verification step against a production build, not `next dev`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| RSS 2.0 → common `Article` shape | A regex/DOMParser-based hand XML walker | `rss-parser@3.13.0` `parseString()` | Already normalizes `dc:creator`→`creator`, strips HTML in `contentSnippet`, exposes `isoDate` — re-verified field-by-field against Krebs's live feed this session (see Code Examples) |
| Per-source fetch caching | A hand-rolled in-memory TTL map keyed by URL | `fetch(url, { next: { revalidate: 900 } })` | This *is* Vercel's Data Cache — building a parallel cache defeats the entire "no DB, no extra infra" constraint and would silently diverge from what INGEST-05 actually tests |
| Redirect-target validation | A general-purpose private-IP-range denylist library (the fuller SSRF defense PITFALLS.md describes for the eventual 13-source fan-out) | The same-host + HTTPS-only check in Pattern 1 above | INGEST-03's Phase 1 scope is explicitly narrower ("HTTPS, same host") than PITFALLS.md's full private-IP-range denylist discussion (written for the 13-source Phase 2/3 hardening pass) — a same-host check is sufficient for *this* phase's single, hardcoded source and needs no third-party dependency; residual DNS-rebinding risk against a same-named host is a Phase 2/3 concern, not new scope here |
| Relative-time display ("2 hours ago") | `date-fns`/`dayjs`/`luxon` | A ~15-line hand-rolled formatter | Already decided in STACK.md — the 24h lookback window collapses relative time to 3 cases (minutes / hours / "just now"); confirmed unchanged, no new library needed |

**Key insight:** Every "don't hand-roll" item in this phase already has a research-verified, zero-new-dependency answer. The only place a plan might be tempted to over-build is redirect validation — the fuller SSRF denylist machinery belongs to the 13-source phase, not this one.

## Common Pitfalls

### Pitfall P1-1: `redirect: 'follow'` (fetch's default) makes INGEST-03 unenforceable after the fact

**What goes wrong:** If `fetchSource()` is written with the default `fetch(url, { next: {...} })` (implicit `redirect: 'follow'`), the redirect has already been followed by the time your code sees the `Response` — there is no hook to reject it. Any later "validate the redirect" code added on top is validating `res.url` *after* the fact, which is validation-as-theater, not validation-as-gate.

**Why it happens:** `redirect: 'follow'` is fetch's default; it's easy to write the happy-path fetch first and treat redirect-validation as a follow-up "hardening" pass.

**How to avoid:** Use `redirect: 'manual'` from the first line of code, per Pattern 1 above — there is no safe way to retrofit this after building on `redirect: 'follow'`.

**Warning signs:** Code review shows `fetch(url, options)` with no `redirect` key at all, or `redirect: 'follow'` explicitly, anywhere in `fetchSource`/`fetchWithValidatedRedirect`.

**Phase to address:** This phase (INGEST-03 is explicitly in scope), at initial implementation — not deferred.

---

### Pitfall P1-2: The Krebs config URL's own redirect adds a permanently-uncached extra hop

**What goes wrong:** CONTEXT.md D-01 and PROJECT.md both configure `https://krebsonsecurity.com/feed` (no trailing slash) — [VERIFIED: `PROJECT.md:48`, "`| Security Research | Krebs on Security | https://krebsonsecurity.com/feed |`"]. That exact URL 301-redirects (verified live this session) to `https://krebsonsecurity.com/feed/`. Because Next.js's Data Cache only stores `200` responses, the `/feed` → 301 hop is refetched on *every* revalidation cycle, forever — a small, permanent, avoidable extra network round-trip and one extra `AbortController`/timer setup per cycle.

**Why it happens:** The URL in the requirements docs is the one a human would naturally type/copy from the source's own site; the trailing-slash canonical form is an implementation detail nobody checks until they trace an actual redirect.

**How to avoid:** Two independent, non-conflicting mitigations — do both:
1. Configure `sources.ts`'s Krebs entry with the canonical, post-redirect URL (`https://krebsonsecurity.com/feed/`, trailing slash) so the common-case fetch never redirects.
2. Keep `fetchWithValidatedRedirect`'s redirect-handling loop fully implemented and exercised regardless (via a deliberate test — see P1-3) — INGEST-03 must hold for *any* future source, not just the one that happens to redirect today.

**Warning signs:** Vercel function logs showing two outbound requests to `krebsonsecurity.com` per revalidation instead of one.

**Phase to address:** This phase, when writing `lib/config/sources.ts`.

---

### Pitfall P1-3: Nothing in production traffic exercises the "reject an invalid redirect" branch — Success Criterion 5 needs a deliberate fixture

**What goes wrong:** Krebs's real redirect is *valid* (same host, HTTPS) — it exercises the "follow" branch of Pattern 1, never the "reject" branch. Success Criterion 5 ("any redirect target is validated... it never hangs the page or blindly follows to an arbitrary host") is unverified until something deliberately redirects cross-host or non-HTTPS and the test confirms rejection.

**How to avoid:** Add a small, deterministic fixture — a local Node `http` server (built-in module, zero new dependency) started only during a test/dev script, that: (a) sleeps past 8s to prove the `AbortController` timeout fires, and (b) responds `302` with `Location: http://169.254.169.254/` or `Location: https://example.com/` to prove `fetchWithValidatedRedirect` throws/rejects rather than following. This keeps the test hermetic (no dependency on a third-party service like httpbin.org staying up) and matches the project's own "minimal dependencies" posture.

**Warning signs:** The only redirect-handling test in the suite (if any) asserts that Krebs's real feed loads successfully — that proves the "follow a valid redirect" path, not the "reject an invalid one" path.

**Phase to address:** This phase — Success Criterion 5 names this explicitly as a required, observable behavior.

---

### Pitfall P1-4: Success Criterion 4 (~15 min cache) cannot be verified under `next dev`

**What goes wrong:** [CITED: nextjs.org/docs/app/guides/caching-without-cache-components] "In Development, Pages are *always* rendered on-demand and are never cached." A developer manually reloading `localhost:3000` twice within 15 minutes during `next dev` will see two real fetches to Krebs regardless of whether `next.revalidate` is wired correctly — and might wrongly conclude the caching code is broken.

**How to avoid:** Verify Success Criterion 4 against `next build && next start` locally, or a deployed Vercel preview, and check response headers (`x-vercel-cache`) / Krebs-origin request logs — not `next dev`. Document this explicitly as the verification method in the plan so it isn't debugged against the wrong environment.

**Warning signs:** A bug report or plan step that says "cache doesn't work, page refetches every reload" based on `next dev` observation alone.

**Phase to address:** This phase, as a documented verification-method note (not a code fix — the code is fine).

---

### Pitfall P1-5: `create-next-app` refuses to scaffold into this exact repo as-is

**What goes wrong:** Running `npx create-next-app@latest .` (or any variant) directly in `/Users/mkh/CyberSecurity/SecurityNews` fails immediately with a hard error and writes zero files, because the CLI checks the target directory for "conflicting" existing paths.

**Live-reproduced this session (2026-09-15):** Created a throwaway directory containing only `.git/`, `.gitignore`, `.claude/`, and `.planning/` (mirroring the real repo's root) and ran the exact intended scaffold command:
```
$ npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir \
    --import-alias "@/*" --use-npm --disable-git --yes
The directory fakeproj contains files that could conflict:

  .planning/

Either try using a new directory name, or remove the files listed above.
```
[VERIFIED: exact command + exact output captured this session] — **`.git/`, `.gitignore`, and `.claude/` did NOT trigger this error** (confirmed with a second run of the identical command against a directory containing only those three, which scaffolded successfully) — it is specifically `.planning/` that `create-next-app`'s built-in allowlist doesn't recognize.

**How to avoid:** Move `.planning/` out of the repo root before scaffolding, then move it back immediately after:
```bash
mv .planning /tmp/havadis-planning-backup
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir \
  --import-alias "@/*" --use-npm --disable-git --yes
mv /tmp/havadis-planning-backup .planning
```
This must be the **first task** of this phase's plan, before any other file is created.

**Warning signs:** Running the scaffold command produces the "contains files that could conflict" error and creates no `app/`, `src/`, or `package.json`.

**Phase to address:** This phase — it blocks everything else. First task, first plan.

---

### Pitfall P1-6: `create-next-app` overwrites the repo's existing `.gitignore` wholesale

**What goes wrong:** The repo's current `.gitignore` contains exactly one line — [VERIFIED: `Read` of `/Users/mkh/CyberSecurity/SecurityNews/.gitignore` this session, full content: `.planning/research/.cache/`]. `create-next-app` writes its own complete `.gitignore` template (node_modules, `.next/`, `.env*`, `.vercel`, etc.) **replacing** whatever was there — confirmed this session by scaffolding into a directory whose `.gitignore` initially contained a single sentinel character, which was gone (fully replaced by the Next.js template) after scaffolding completed.

**How to avoid:** After scaffolding (and after moving `.planning/` back per P1-5), re-append the original ignore line to the generated `.gitignore`:
```bash
echo ".planning/research/.cache/" >> .gitignore
```
Do this as an explicit plan step, not an assumption that the line survives.

**Warning signs:** `git status` after scaffolding shows `.planning/research/.cache/` contents as untracked/stageable when they previously weren't.

**Phase to address:** This phase, immediately after the scaffold step (P1-5).

---

### Pitfall P1-7: The bare-`typescript@latest` warning in STACK.md/CLAUDE.md does not apply to the scaffold itself

**What goes wrong:** A plan step that says "explicitly run `npm install -D typescript@^5.7` after scaffolding, per CLAUDE.md" is solving a problem that doesn't exist at scaffold time, and risks accidentally *downgrading* or otherwise diverging from whatever 5.x patch `create-next-app` already selected.

**How to avoid:** [VERIFIED: this session's live scaffold `package.json` — `"typescript": "^5"`] `create-next-app@latest` (as of 16.3.5) already pins `"typescript": "^5"` in the generated `package.json`, which — under normal `npm install` semver resolution — can never resolve to the `7.x` line [VERIFIED: `npm view typescript dist-tags` this session: `"latest": "7.0.2"`, `"7.1.0-dev...": ...` — all excluded by a `^5` range]. The CLAUDE.md/STACK.md warning is correctly aimed at someone *later* casually running `npm install -D typescript@latest` or `typescript` with no version pin outside the scaffold's own `package.json` control — not at the scaffold step itself. No extra pin command is needed in this phase's plan.

**Warning signs:** A plan or task list that includes a standalone "pin TypeScript" step with no other rationale than "CLAUDE.md said so" — verify the scaffold's own `package.json` first.

**Phase to address:** This phase — informs whether to include a redundant task.

## Code Examples

### `normalize.ts` — verified field-by-field against Krebs's live feed

**Source feed structure (live-fetched this session, 2026-09-15, via `curl -A "<browser UA>" https://krebsonsecurity.com/feed/`):**
```xml
<item>
    <title>Microsoft Plugs Nearly 1,000 Security Holes</title>
    <link>https://krebsonsecurity.com/2026/09/microsoft-plugs-nearly-1000-security-holes/</link>
    <dc:creator><![CDATA[BrianKrebs]]></dc:creator>
    <pubDate>Tue, 08 Sep 2026 21:44:22 +0000</pubDate>
    <category><![CDATA[Latest Warnings]]></category>
    <category><![CDATA[CVE-2026-69730]]></category>
    <guid isPermaLink="false">https://krebsonsecurity.com/?p=74277</guid>
    <description><![CDATA[Microsoft Corp. today issued updates to plug at least 974 security holes...]]></description>
    <content:encoded><![CDATA[<p><strong>Microsoft Corp.</strong> today issued updates...]]></content:encoded>
</item>
```
[VERIFIED: raw XML captured this session, byte-identical excerpt above from the live response]

`rss-parser`'s default field mapping (per its README, `parser.parseString()`) turns this into `item.title`, `item.link`, `item.creator` (from `dc:creator`), `item.pubDate`/`item.isoDate`, `item.categories` (array — **note:** Krebs puts CVE IDs like `CVE-2026-69730` in `<category>` tags, not necessarily inline in the title/summary text — relevant context for Phase 3's UI-03 CVE-chip work, not required here), `item.contentSnippet` (HTML-stripped), `item.content` (raw HTML from `content:encoded`) — [CITED: github.com/rbren/rss-parser README, default item field list].

```typescript
// lib/pipeline/normalize.ts
import type Parser from "rss-parser";
import type { SourceConfig } from "@/lib/types";

export type Article = {
  title: string;
  url: string;
  source: string;
  sourceTier: string;
  publishedAt: string; // ISO 8601
  summary: string;
};

export function normalize(
  item: Parser.Item,
  source: SourceConfig
): Article | null {
  if (!item.title || !item.link || !item.isoDate) return null; // skip malformed entries defensively
  return {
    title: item.title.trim(),
    url: item.link,
    source: source.name,
    sourceTier: source.tier,
    publishedAt: item.isoDate,
    summary: (item.contentSnippet ?? item.content ?? "").trim(),
  };
}
```

### 24h lookback filter (INGEST-04)

```typescript
// lib/pipeline/filterLookback.ts
export function filterLookback(articles: Article[], hours = 24): Article[] {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return articles.filter((a) => new Date(a.publishedAt).getTime() >= cutoff);
}
```

### Relative-time formatter (UI-02, no `date-fns`)

```typescript
// lib/formatRelativeTime.ts
export function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
```
Usage satisfying UI-02's "absolute time available on hover" via the native `title` attribute (Claude's Discretion, simplest mechanism):
```tsx
<time dateTime={article.publishedAt} title={new Date(article.publishedAt).toLocaleString()}>
  {formatRelativeTime(article.publishedAt)}
</time>
```

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Krebs on Security requires special anti-bot handling (browser `User-Agent`) when fetched from **Vercel's** IP ranges specifically. | Common Pitfalls (inherited from PITFALLS.md Pitfall 2); **this session's live probe from a non-Vercel network succeeded with both a default and a no-custom-UA `fetch`, returning `200` with valid `application/rss+xml` content** — this neither confirms nor refutes the Vercel-specific claim, since PITFALLS.md's own claim is conditioned on Vercel's shared IP reputation, which this sandbox does not share. | If wrong (Krebs doesn't actually need special headers even from Vercel), sending a browser UA is harmless extra code. If PITFALLS.md's claim is right and this is skipped, the source could silently return 0 articles from a Vercel deployment specifically — recommend keeping the browser-`User-Agent` header defensively (zero cost) and verifying against the actual first production/preview deploy, per PITFALLS.md's own "Warning signs" guidance, rather than trusting either this probe or the original claim alone. |
| A2 | The recommended `SourceTierBadge` color for "Security Research" tier (only color decision explicitly in scope per D-04) — no specific value researched or proposed here; left fully to Claude's Discretion at plan/build time per CONTEXT.md. | Standard Stack / Architectural Responsibility Map | Low — purely cosmetic, reversible per D-04's own reversibility note. |
| A3 | `maxDuration` / Vercel Function region pinning are not required for this phase's single-source, single-fetch workload to stay within any duration/latency budget. | Architecture Patterns (implicitly, by omission — ARCHITECTURE.md flags these for the 13-source phase, not this one) | Low — a single ~8s-capped fetch is far under any documented Hobby duration ceiling; revisit explicitly in the Phase 2/3 fan-out research, not here. |

## Open Questions

1. **Does Krebs actually need a browser-like `User-Agent` when fetched from a real Vercel Function (not this research sandbox)?**
   - What we know: PITFALLS.md documents this as a known pattern for Cloudflare-fronted sites specifically flagged in the reference repo; this session's live probe from a non-Vercel network succeeded without one.
   - What's unclear: whether Vercel's specific shared IP ranges trigger different behavior from Krebs/Cloudflare than this sandbox's network.
   - Recommendation: Send the browser-like `User-Agent` header defensively regardless (zero cost, matches PITFALLS.md's existing recommendation) and add a build-time verification checklist item — "confirm Krebs returns valid RSS from the first real Vercel preview deploy, not just local `next dev`" — matching PITFALLS.md's own suggested verification method.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | `create-next-app`, `npm install`, all builds | ✓ | v26.3.1 [VERIFIED: `node --version` this session] | — |
| npm | package installs | ✓ | 11.17.0 [VERIFIED: `npm --version` this session] | — |
| `create-next-app@latest` | project scaffold | ✓ | resolves to Next.js 16.3.5 [VERIFIED: live scaffold run this session] | — |
| Outbound HTTPS to `krebsonsecurity.com` | INGEST-03/04/05, NORM-01 | ✓ | feed reachable, `200`, valid RSS 2.0 [VERIFIED: live curl + Node fetch this session] | — |
| git | commit workflow | ✓ | repo already initialized at `/Users/mkh/CyberSecurity/SecurityNews/.git` [VERIFIED: `ls -la` this session] | — |

**Missing dependencies with no fallback:** none identified.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | UI-06 requires the *absence* of authentication — do not introduce any auth middleware, session cookie, or login route |
| V5 Input Validation | Yes | Treat every field from the fetched RSS XML (title, description, content, links) as untrusted external input — validate presence/shape in `normalize()` before use (see Code Examples' `null` guard) |
| V5 (Output Encoding, adjacent) | Yes | Render feed-supplied `title`/`summary` as plain text (React's default JSX text-node escaping), never via `dangerouslySetInnerHTML` — a compromised or malicious feed entry containing `<script>` in its title/description must not execute. React's default behavior already satisfies this as long as no raw-HTML-injection API is used. |
| SSRF (redirect-following) | Yes | INGEST-03's own scope: validate `Location` host/protocol before following any redirect (Pattern 1) — this is the concrete Phase 1 control; the fuller private-IP-range denylist belongs to the later multi-source phase per PITFALLS.md |
| V12 File/Resource handling | Yes (lightweight) | Cap response size read from the feed and treat non-`2xx`/non-XML content-type as a distinct failure (per ARCHITECTURE.md Anti-Pattern 3 / PITFALLS.md Pitfall 4) — not new scope, just confirming it applies starting this phase since it's the first phase touching a real network response |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SSRF via unvalidated feed redirect | Tampering / Elevation of Privilege | `redirect: 'manual'` + host/protocol validation before re-fetching (Pattern 1) |
| Stored XSS via feed title/summary | Tampering | Render as plain text via JSX's default escaping; never `dangerouslySetInnerHTML` on feed-supplied fields |
| Resource exhaustion via a slow/hanging feed origin | Denial of Service (of the app's own Function budget) | `AbortController` timeout (~8s) — already required by INGEST-03 |

## Sources

### Primary (HIGH confidence)
- Live `curl`/Node `fetch` probes of `https://krebsonsecurity.com/feed` and `/feed/`, executed this session (2026-09-15) — redirect behavior, response headers, raw XML structure
- Live `npx create-next-app@latest` scaffold runs (2x, isolated scratch directories), executed this session — scaffold conflict behavior, generated `package.json`/`tsconfig.json`/`postcss.config.mjs`/`.gitignore` contents
- `npm view <pkg> version` / `dist-tags` direct registry queries, executed this session, for `next`, `react`, `tailwindcss`, `rss-parser`, `clsx`, `typescript`, `fast-xml-parser`, `eslint-config-next`
- [nextjs.org/docs/app/api-reference/functions/fetch](https://nextjs.org/docs/app/api-reference/functions/fetch) (fetched this session, `lastUpdated: 2026-08-25`)
- [nextjs.org/docs/app/guides/caching-without-cache-components](https://nextjs.org/docs/app/guides/caching-without-cache-components) (fetched this session, `lastUpdated: 2026-08-25`)
- [nextjs.org/docs/app/api-reference/cli/create-next-app](https://nextjs.org/docs/app/api-reference/cli/create-next-app) (fetched this session, `lastUpdated: 2026-08-25`)
- [github.com/rbren/rss-parser](https://github.com/rbren/rss-parser) README (fetched this session) — item field shape, `customFields`, RSS/Atom normalization rules
- `.planning/PROJECT.md` (read this session, lines 45–59) — 6-tier source table, 7-section taxonomy, quoted verbatim above where used

### Secondary (MEDIUM confidence)
- WebSearch cross-check on AbortController-vs-persistent-Data-Cache interaction (multiple independent summaries, consistent with the official docs' own memoization-only framing)
- WebSearch cross-check on `create-next-app` current default flags/behavior (Turbopack default-on, `--src-dir`, `--agents-md`) — consistent with the CLI reference doc fetched directly

### Tertiary (LOW confidence)
- None used as the basis for any claim in this document without a primary/secondary cross-check.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version claim re-verified live against npm registry and/or a live scaffold run this session, not carried over from training data
- Architecture (redirect validation, cache mechanics): HIGH — verified against official Next.js docs fetched this session plus live executable probes against the real configured source
- Scaffold sequencing pitfalls (P1-5, P1-6): HIGH — directly reproduced with the exact target-directory shape this session, not inferred
- Anti-bot/Vercel-specific behavior (A1): LOW/unresolved — explicitly flagged as needing production verification, not resolvable from this environment

**Research date:** 2026-09-15
**Valid until:** 30 days (stack versions, especially React's patch version, may drift again by the time this phase executes — re-run `npm view` checks if execution is delayed)

---
*Phase: 1-Single-Source Pipeline (Vertical Slice)*
*Researched: 2026-09-15*
