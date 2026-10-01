---
phase: "01"
slug: "single-source-pipeline-vertical-slice"
status: verified
threats_open: 0
asvs_level: 1
created: "2026-09-21"
---

# Phase 01 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| visitor browser → Vercel Function (`GET /`) | Untrusted request. Phase 1 consumes no query parameters, headers, cookies or body from the visitor, and adds no authentication, session, or request-scoped read at this boundary — by design (UI-06 requires the site fully public). | none (no attacker-controlled input accepted) |
| Vercel Function → `krebsonsecurity.com` over HTTPS | The primary boundary. Untrusted external *response* data crosses here: title, link, description, content, and every other feed field, plus response timing itself. | feed XML/RSS content; response headers; response timing |
| redirect `Location` header → Function egress | A response header controls the next outbound request's destination — the SSRF surface INGEST-03 exists to close. | URL string |
| normalized `Article` fields → rendered HTML | Untrusted external text (title, summary) crosses into the DOM. | feed-sourced text |
| normalized `article.url` → outbound `href` | A feed-controlled URL becomes a user-clickable destination. | URL string |
| npm registry → build | Supply-chain boundary for `rss-parser` and `clsx`. | package code |
| test fixture → localhost network | The fixture opens a listening socket on the developer's machine, including stalled-response and repeating-timer routes added in 01-04. | none (dev/test only) |
| test fixture → application code | A fixture that leaked into shipped code would put a deliberately-hostile HTTP server in the production bundle. | n/a (must never cross) |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01-01 | Tampering / Elevation of Privilege | `fetchWithValidatedRedirect.ts` redirect handling | high | mitigate | `redirect: "manual"`; `Location` resolved against current URL; rejected unless protocol is exactly `https:` AND host string-equals the original host; capped at 5 hops. Verified present in code. | closed |
| T-01-02 | Denial of Service | slow/hanging feed origin consuming Function execution budget | medium | mitigate | Fresh per-hop `AbortController`; converted to `{status:"error"}` rather than an unhandled rejection. Superseded/strengthened by T-01-16 (continuous per-source budget, 01-04). Verified present. | closed |
| T-01-03 | Tampering | oversized or non-feed response body handed to the parser | medium | mitigate | Non-2xx rejected; content-type gated (now `xml` or `html`, tightened rationale under T-01-19); byte-capped read before parse. Verified present in `fetchSource.ts`. | closed |
| T-01-04 | Tampering | feed-supplied `link` becoming an `href` with a non-HTTP scheme | high | mitigate | `normalize` parses `link` as URL, returns `null` unless protocol is `https:`/`http:`. Verified present in `normalize.ts` (unchanged since 01-01, re-confirmed by re-verification in 01-04). | closed |
| T-01-05 | Spoofing | DNS rebinding to a same-named host after the host check passes | low | accept | Single hardcoded HTTPS source; full private-IP denylist deferred to the 13-source hardening pass (Phase 2) where the risk becomes material. ASVS-L1-appropriate. | closed (accepted) |
| T-01-06 | Information Disclosure | error `reason` strings leaking internal detail into rendered HTML | low | mitigate | Page branches on result discriminant only, renders fixed copy; `reason` never printed. Verified: no `reason` reference in `page.tsx`/`ArticleCard.tsx`. | closed |
| T-01-07 | Tampering | stored XSS via feed-supplied title/summary in `ArticleCard.tsx` | high | mitigate | Rendered as ordinary JSX text nodes (React default escaping). Verified: no `dangerouslySetInnerHTML` under `src/app` or `src/components`. | closed |
| T-01-08 | Information Disclosure | `target="_blank"` handing the opened tab a `window.opener` reference and referrer | low | mitigate | Every outbound anchor carries `rel="noopener noreferrer"`. Verified present in `ArticleCard.tsx`. | closed |
| T-01-09 | Spoofing | no authentication exists, so any visitor reads everything | low | accept | UI-06 requires the site be fully public; no protected resource, no user state, no write path to protect. The absence of auth is the requirement. | closed (accepted) |
| T-01-10 | Information Disclosure | internal failure detail leaking into rendered HTML via the empty state | low | mitigate | Page branches on discriminant only; negative grep gate asserts `reason` never reaches render. Verified. | closed |
| T-01-11 | Denial of Service | `hostileRedirectServer.ts` binding a port on the developer's machine | low | mitigate | Binds `127.0.0.1` only on port `0` (OS-assigned ephemeral); closed in teardown. Verified: `server.listen(0, "127.0.0.1", ...)`. | closed |
| T-01-12 | Tampering | the hostile fixture reaching shipped code | low | mitigate | No file under `src/app`, `src/components`, `src/lib` references the fixtures directory; negative grep gate. Re-verified as `FIXTURE_NOT_SHIPPED` in 01-04's corrected gate (quoted globs, test-file exclusion). | closed |
| T-01-13 | Denial of Service | `productionPage.test.ts` leaving an orphaned production server holding its port | low | mitigate | Child process killed in teardown including on the failure path; readiness poll is bounded. Verified: `server.kill()` in both the success path and `after()`. | closed |
| T-01-14 | Tampering | silent regression of caching configuration (companion cache option, Cache Components on, `parseURL` reintroduced) turning 15-min revalidation into per-request origin fetch | medium | mitigate | Four comment-filtered grep gates, each with a distinct pass token. Re-run in 01-04 Task 3 after Task 1 edited the same options object; all four tokens (`REVALIDATE_SET`, `NO_COMPANION_CACHE_OPTION`, `CACHE_COMPONENTS_OFF`, `STRING_PARSER_ONLY`) confirmed emitting this session. | closed |
| T-01-15 | Spoofing | the production page serving content to an unauthenticated request | low | accept | UI-06 requires exactly this; test asserts absence of a credential surface. No protected resource, no user state, no write path. | closed (accepted) |
| T-01-16 | Denial of Service | `fetchSource` body-read phase against a slow-drip origin | high | mitigate | The gap 01-VERIFICATION.md found and 01-04 closed. One per-source `AbortController` armed at `fetchSource` entry, composed into every hop's signal, cleared only in a `finally` on the outer try — connect, headers and body inside one continuous ~8s window. Independently re-verified this session: stalled-body test aborts at ~8003ms (was pending at 12,000ms pre-fix); positive control (drip-then-complete) succeeds at ~331ms, proving no over-fire. | closed |
| T-01-17 | Denial of Service | fixture repeating timers outliving the suite | low | mitigate | Every repeating timer tracked per-server, `unref()`-ed, cleared on the response's `close` event and inside the exported `close()` handle. Independently confirmed by adversarial code review this session (ran the full suite to completion — process exits cleanly, no leaked timer). | closed |
| T-01-18 | Denial of Service | the tightened per-source budget rejecting a legitimately slow source | medium | accept | Budget now spans all hops plus body rather than resetting per hop, matching INGEST-03/Success Criterion 5's per-source ~8s bound. Drip-then-complete positive control pins the permissive boundary. Revisit in Phase 2 when 13 sources widen the sample. | closed (accepted) |
| T-01-19 | Tampering | caching configuration regressing while the options object is edited | medium | mitigate | Same four gates as T-01-14, re-run against the exact object 01-04 Task 1 edited. All four confirmed passing this session, plus `npm run build` output showing `Revalidate: 15m` for `/`. | closed |
| T-01-20 | Tampering | the hostile fixture reaching shipped code (fixture-not-shipped gate specifically) | low | mitigate | 01-04's corrected gate (quoted globs, test files excluded) — the original gate passed vacuously due to unquoted globs. Re-confirmed emitting `FIXTURE_NOT_SHIPPED` this session. | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above `workflow.security_block_on` (high) count toward `threats_open`*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-01-05 | DNS rebinding to a same-named host after the host-equality check passes. Phase 1 configures exactly one hardcoded HTTPS source (Krebs on Security); the full private-IP-range denylist is explicitly scoped by PITFALLS.md to the 13-source hardening pass, where the residual risk becomes material across a larger, less-trusted source list. ASVS-L1-appropriate for a single known origin. | 01-01-PLAN.md (plan-time) | 2026-09-18 |
| AR-02 | T-01-09 | No authentication exists anywhere in the app. UI-06 requires the site be fully public and stateless; there is no protected resource, no user state, and no write path to protect. The absence of an auth tier is the requirement itself, not a gap. | 01-02-PLAN.md (plan-time) | 2026-09-18 |
| AR-03 | T-01-15 | The production page serves content to unauthenticated requests by design, per UI-06. The corresponding test asserts the *absence* of a credential surface rather than the presence of one. | 01-03-PLAN.md (plan-time) | 2026-09-19 |
| AR-04 | T-01-18 | The per-source timeout budget now spans connect + headers + body continuously (~8s total) rather than resetting per hop, so a legitimately slow-but-not-hostile source has less headroom than the pre-01-04 per-hop-only budget. Accepted because INGEST-03 and ROADMAP Success Criterion 5 both specify a *per-source* ~8s bound — this is that bound correctly implemented, not an over-tightening. The drip-then-complete positive control (331ms, well inside budget) pins the permissive boundary so the tightening cannot silently regress into "abort everything." Revisit when Phase 2 widens the source sample from 1 to 13. | 01-04-PLAN.md (plan-time) | 2026-09-20 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-21 | 20 | 20 | 0 | /gsd-secure-phase (L1 grep-depth verification against implementation; register authored at plan time across all 4 plans — no auditor spawn needed per short-circuit rule: `threats_open: 0 AND register_authored_at_plan_time: true AND asvs_level == 1`) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-21
