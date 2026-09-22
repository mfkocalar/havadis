---
phase: "02"
slug: "full-ingestion-failure-isolation"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-09-22"
---

# Phase 02 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| 13 external feed origins → Vercel Function | Untrusted response status, headers, and body bytes cross here — widened this phase from 1 origin to 13 | RSS/Atom XML: status codes, headers, body bytes, every feed field |
| PROJECT.md's source table → `sources.ts` | Transcription boundary: an incorrect URL produces a permanently zero-contributing source, invisible by design (D-05) | static config literals (id/name/tier/url) |
| `fetchSource` content-type gate → body read + XML parse | The point at which an origin's response is granted the right to consume body-download and parse budget | HTTP `Content-Type` header, response body |
| `fetchSource` → `fanOut` | The never-throws / discriminated-result contract INGEST-02 depends on | `FrontPageResult` discriminated union |
| Vercel Function → rendered HTML | Normalized `Article` fields cross into JSX text nodes and an `href` | title, summary, url, source name, tier |
| test fixture → test process | Hostile/malformed responses served only from 127.0.0.1 on an ephemeral port, never importable from shipped code | fixture-only, test process boundary |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-02-01 | Tampering | Feed `title`/`summary` reaching `ArticleCard.tsx` | high | mitigate | `normalize.ts` drops items missing `title`/`link`/`isoDate`, gates `link` to `http:`/`https:`; React escapes all text nodes; no `dangerouslySetInnerHTML` under `src/app` or `src/components` (verified: zero matches) | closed |
| T-02-02 | Denial of Service | One slow origin stalling the whole revalidation cycle now that fetches are concurrent | medium | mitigate | `fetchSource` arms its own 8s `AbortController` per source (`SOURCE_TIMEOUT_MS = 8_000`, verified unchanged); `Promise.allSettled` bounds wall-clock by the slowest single source, not their sum — proven in `fanOutTiming.test.ts` | closed |
| T-02-03 | Denial of Service | A throw inside `fetchSource` or its dependencies collapsing every source into the page-wide error variant | high | mitigate | `fanOut` uses `Promise.allSettled` (verified) and treats a rejected settlement identically to an error-variant value; directly proven (not just asserted) by `fanOut.test.ts`'s injected-fetcher tests — rejection and error-variant produce the identical article set | closed |
| T-02-04 | Information Disclosure | An error `reason` string leaking into rendered HTML | low | mitigate | `page.tsx` branches on the discriminant only, renders fixed copy; verified zero references to `reason` in `src/app/page.tsx` | closed |
| T-02-05 | Spoofing | DNS rebinding to a same-named host after `fetchWithValidatedRedirect`'s exact-host check passes | low | accept | Re-accepted at 13-origin scale (see Accepted Risks Log). Premise now machine-checked by `sources.test.ts`'s https/non-IP-literal/non-local-hostname invariant (verified: 7/7 tests pass) | closed |
| T-02-06 | Denial of Service | An oversized feed body exhausting function memory or the 8s budget across 13 concurrent reads | high | mitigate | `MAX_BODY_BYTES` (2MB, verified unchanged) enforced on both `readBodyWithCap` return paths — the no-stream path now measures via `Buffer.byteLength` and throws the same cap error (verified: bare uncapped `return await res.text()` absent, `Buffer.byteLength` present) | closed |
| T-02-07 | Denial of Service | A non-feed HTML response (WAF challenge, cookie wall, error page) from a non-opted-in origin consuming full download+parse budget before failing | medium | mitigate | HTML acceptance scoped per-source via `SourceConfig.allowHtmlContentType` (verified present in `types.ts` and consulted in `fetchSource.ts`); live probe found zero of 13 sources need the opt-in | closed |
| T-02-08 | Spoofing | A configured URL pointing at an unintended origin through a silently-followed redirect chain | medium | mitigate | Every configured URL is live-verified to return 200 with no redirect hop (13/13 `url:` entries); `fetchWithValidatedRedirect`'s HTTPS-only + exact-host-equality check remains the backstop | closed |
| T-02-09 | Spoofing | A future source added with a private, loopback, or IP-literal URL, invalidating T-02-05's acceptance premise | medium | mitigate | `sources.test.ts` asserts every configured URL is `https:` with a non-IP-literal, non-local, dot-bearing hostname — automated invariant, verified passing (7/7) | closed |
| T-02-10 | Information Disclosure | A per-source `reason` string naming an internal failure detail reaching the rendered page as 13 origins produce more varied failures | low | mitigate | Unchanged from Phase 1: `page.tsx` branches on the discriminant only, never prints `reason` — re-verified, zero references | closed |
| T-02-11 | Elevation of Privilege | The hostile test fixture becoming reachable from shipped application code | medium | mitigate | Verified: no non-test file under `src/app`, `src/components`, or `src/lib` imports `test/fixtures/hostileRedirectServer`; fixture binds `127.0.0.1` on an ephemeral port | closed |
| T-02-12 | Denial of Service | A stray fixture timer holding the test process open indefinitely | low | mitigate | New delayed fixture route follows the established lifecycle: `.unref()`'d, tracked in `activeTimers` (verified: 3 occurrences of each), cleared from the response `close` event | closed |
| T-02-13 | Tampering | A production constant (`SOURCE_TIMEOUT_MS`, `MAX_BODY_BYTES`) weakened to make a slow test faster | medium | mitigate | Both values pinned by literal-match gates; verified unchanged: `SOURCE_TIMEOUT_MS = 8_000`, `MAX_BODY_BYTES = 2 * 1024 * 1024` | closed |
| T-02-14 | Repudiation | The concurrency claim passing vacuously (fixture never delayed) or failing spuriously (same-origin connection pooling) | medium | mitigate | `fanOutTiming.test.ts` asserts both a lower bound (`>=900ms`) and upper bound (`<2000ms`) across 3 distinct fixture origins — measured 938–944ms in practice, ruling out both failure modes | closed |
| T-02-SC | Tampering | npm/pip/cargo installs (supply chain) | n/a | accept | No package-manager install task in any of this phase's 3 plans; no new external packages introduced anywhere in Phase 2 | closed |

*Status: open · closed · open — below {block_on} threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-02 | T-02-05 | DNS rebinding to a same-named host after exact-host-equality check passes. Re-accepted at 13-origin scale (up from Phase 1's single source). No denylist implemented: (1) the literal-IP vector is already closed — `fetchWithValidatedRedirect` requires exact host-string equality, subsuming any IP denylist; (2) the only residual vector is a configured hostname (fixed at build time, all major public security publishers) resolving to a private IP via true DNS rebinding — requires DNS compromise; (3) impact ceiling is low even on success — no credentials, no auth surface, response is only size-capped/parsed/rendered as escaped public text; (4) resolved-IP validation would depend on an unverified undici API surface (02-RESEARCH.md Open Question #2); (5) ASVS L1 with `security_block_on: high` permits acceptance at this (low) severity. Premise (1) is now machine-checked by `sources.test.ts`. **Revisit trigger:** a future phase introducing a user-supplied or runtime-configurable source URL, or a credentialed outbound request. | Phase 02 plans (02-01, 02-02, 02-03) | 2026-09-22 |
| AR-03 | T-02-SC | No package-manager install task exists in any Phase 2 plan; `rss-parser@3.13.0` and `clsx@2.1.1` were gated at project init. Supply-chain gate has nothing new to evaluate this phase. | Phase 02 plans | 2026-09-22 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-22 | 15 | 15 | 0 | /gsd-secure-phase orchestrator (L1 grep-depth classification; ASVS L1 short-circuit — no deep auditor spawn required) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-22
