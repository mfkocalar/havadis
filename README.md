# Havadis

A public, source-independent daily security newspaper for security practitioners. Havadis aggregates 29 curated cybersecurity feeds, normalizes and deduplicates them, sorts them into urgency-ordered sections, and serves a fast, mobile-friendly, server-rendered front page. No accounts, no database.

## Features

- **29 curated sources** (government and EU CERT advisories, security research, enterprise security, threat intelligence, tech and executive news), fetched in parallel. One failing feed never takes the page down.
- **Source-type label** on every card (News, Research, Vendor, CERT, Government), set per source in config.
- **Per-type lookback:** CERT, government and vendor items stay for 72 hours; news and research items for 24 hours. Low-cadence advisory feeds (CERT-EU, NCSC-UK) often have nothing inside the window on a given day, which is expected.
- **Deduplication:** the same story from several outlets appears once (canonical URL or normalized title match; the earliest copy wins).
- **Seven urgency-ordered sections:** Vulnerabilities, Advisories, Ransomware, Breaches, Threat Intelligence, Tools/Techniques, Industry/Policy. Classification is deterministic and keyword-based (see `src/lib/config/sections.ts`).
- **Ranking** within a section by source tier weight and recency.
- **CVE chips** on cards that mention a CVE ID, linking to the NVD entry.
- **Exploitation signals:** a CVE chip is followed by a KEV chip with the date CISA added the CVE to its Known Exploited Vulnerabilities catalog, and an EPSS chip with the FIRST exploitation probability (a muted "no EPSS yet" for brand-new CVEs). The strongest signal is shown first. When KEV or EPSS data is unavailable, stale or partial, a small notice appears beside "Updated"; nothing on the page ever says a CVE is safe or not exploited.
- **Client-side section filter:** multi-select pills with per-section counts. Filtering never triggers a network request.
- **Freshness:** the sticky bar shows when the snapshot was built ("Updated 14:05 UTC", relative after load).
- **Responsive layout:** 1, 2 or 3 card columns; verified from 360px phones to 1440px desktops.

## How it works

```
29 RSS/Atom feeds
   → fetchSource (validated redirects, size cap, per-source timeout)
   → normalize → per-source lookback (72h cert/government/vendor, 24h news/research) → dedupe → classify → rank → group by section
   → one cached edition (src/lib/snapshot.ts, 900 s) ─┐
   CISA KEV catalogue → validated, slim map (6 h)  ───┼→ merged at render with EPSS (FIRST) → static, server-rendered page
```

The whole composed edition is cached once through Next's `unstable_cache` in `src/lib/snapshot.ts` (`getSnapshot`, `SNAPSHOT_REVALIDATE_SECONDS` = 900 seconds) and shared by every reader. Inside it each feed is fetched uncached, so a feed that fails during a refresh is missing from that edition until the next good refresh. A refresh that errors or composes zero articles keeps the previous edition, whose "Updated" time then shows its age. Parsing uses `rss-parser` on the fetched XML text. The front page is a static route; the filter and clock are the only client code.

Exploitation signals are merged with the cached edition at render, so the page stays static. The CISA KEV catalogue is validated, slimmed to about 135 KB (at today's catalogue size) and cached for 6 hours under its own key; EPSS is requested at render in sorted batches of at most 50 CVEs with a 1-hour fetch cache.

Failure policy, one sentence each. Edition: the last good edition is kept, and a cold build (or the first build after a cache-key bump) fails during a total feed outage while Vercel keeps the previous deployment. Enrichment: a stale KEV map beats an empty one, otherwise KEV and EPSS degrade to "unavailable", every article still renders, and unavailable is never shown as "not in KEV". The reasoning is written once in the header of `src/lib/snapshot.ts`.

## Tech stack

Next.js 16 (App Router, TypeScript), React 19, Tailwind CSS 4, `rss-parser`. Designed to run on Vercel's free tier with no database or cron.

## Getting started

Requires a current Node.js LTS.

```bash
npm install
npm run dev        # http://localhost:4000
```

Production build:

```bash
npm run build
npm start
```

The build prerenders from live feeds, so it needs outbound network access, including to `www.cisa.gov` (KEV) and `api.first.org` (EPSS).

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start the development server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm test` | Unit and production-page tests (build first: `npm run build && npm test`) |

## Testing

`npm test` runs hermetic tests plus production-build tests that read the last build in `.next`, so run `npm run build && npm test`. The static-route gate fails when `/` is no longer prerendered with a 900-second window, and fails with a stale-build message when any non-test file under `src/` or `next.config.ts` is newer than `.next/BUILD_ID`. Enrichment tests run against a local fixture server on 127.0.0.1 and never call CISA or FIRST. Live-network end-to-end tests are opt-in:

```bash
E2E=1 node --test src/lib/pipeline/frontpage.e2e.test.ts
```

Responsive layout is checked at six widths (360, 390, 768, 1024, 1280, 1440px) with an ad hoc Playwright script. Playwright is intentionally not a project dependency:

```bash
npm install --no-save playwright@1.63.0
npm run build
node scripts/verify-viewports.mjs
```

## Configuration

- Sources, their tiers and source types: `src/lib/config/sources.ts` (adding or removing a source is a code change).
- Source-type labels and lookback windows: `src/lib/config/sourceTypes.ts`.
- Crawler identity (User-Agent, public contact URL and opt-out channel): `src/lib/config/crawler.ts`. The contact URL points at this site's `/about` page.
- Section keywords: `src/lib/config/sections.ts`.
- Ranking weights: `src/lib/config/ranking.ts`.
- Per-section card cap: `src/lib/config/frontPageLayout.ts`.
- KEV and EPSS tunables (feed URLs, cache windows, size caps, timeouts, batch size): `src/lib/enrichment/config.ts`.
- Importance rules (critical / high / normal): `src/lib/pipeline/importance.ts`.
- `SITE_URL` environment variable: the public origin used for absolute links in feeds and metadata (e.g. `https://havadis.app`). Falls back to Vercel's production domain, then `http://localhost:4000`. Set it in production.

## Feeds

Other services and agents can subscribe to the front page. Every feed covers the last 24 hours, newest first, is prerendered and refreshed every 15 minutes, needs no key, and allows cross-origin requests.

| Feed | RSS 2.0 | JSON Feed 1.1 |
|------|---------|---------------|
| All stories | `/feed.xml` | `/feed.json` |
| High and critical | `/feed/high.xml` | `/feed/high.json` |
| Critical only | `/feed/critical.xml` | `/feed/critical.json` |
| One section | `/feed/<section>.xml` | `/feed/<section>.json` |

Section slugs: `vulnerabilities`, `advisories`, `ransomware`, `breaches`, `threat-intelligence`, `tools-techniques`, `industry-policy`.

Each item carries Havadis's triage fields: section, importance, importance reason, CVE IDs, source and source tier. JSON Feed items have them in a `_havadis` object; RSS items have them as `havadis:` namespaced elements and `<category>` tags. The site's HTML advertises the feeds via `<link rel="alternate">`, and `/feeds` lists every endpoint.

```bash
curl -s https://havadis.app/feed/critical.json | jq '.items[] | {title, url, why: ._havadis.importance_reason}'
```

## Deployment

Deploy to Vercel (`vercel` for a preview, `vercel --prod` for production). No environment variables are required.

## License

[MIT](LICENSE)
