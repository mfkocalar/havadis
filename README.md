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
- **Client-side section filter:** multi-select pills with per-section counts. Filtering never triggers a network request.
- **Freshness:** the sticky bar shows when the snapshot was built ("Updated 14:05 UTC", relative after load).
- **Responsive layout:** 1, 2 or 3 card columns; verified from 360px phones to 1440px desktops.

## How it works

```
29 RSS/Atom feeds
   → fetchSource (validated redirects, size cap, per-source timeout)
   → normalize → per-source lookback (72h cert/government/vendor, 24h news/research) → dedupe → classify → rank → group by section
   → server-rendered page (revalidated every 15 minutes)
```

Each feed is fetched with Next.js `fetch(url, { next: { revalidate: 900 } })`, so Vercel's Data Cache serves all visitors and sources are refetched at most once per 15-minute window. Parsing uses `rss-parser` on the already-fetched XML text. The front page is a static route; the filter and clock are the only client code.

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

The build prerenders from live feeds, so it needs outbound network access.

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start the development server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm test` | Unit and production-page tests (Node's built-in test runner) |

## Testing

`npm test` runs hermetic tests, including a production-build test that asserts the page is static, public and correctly ordered. Live-network end-to-end tests are opt-in:

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

## Deployment

Deploy to Vercel (`vercel` for a preview, `vercel --prod` for production). No environment variables are required.

## License

[MIT](LICENSE)
