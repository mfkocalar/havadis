# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Security practitioners (analysts, vulnerability managers, CERT/SOC staff, security leads). Their main job on Havadis is a daily morning triage pass: find out what is critical or actively exploited today, decide what needs action, flag or mark items read, and move on. Deeper reading happens on the source sites, not here.

## Product Purpose

Havadis is a public, source-independent daily security newspaper. It aggregates 29 curated cybersecurity feeds, deduplicates them, sorts them into urgency-ordered sections, and scores each item's importance so a practitioner can triage the day's security news in one fast page. No accounts, no database. Success is a reader who finishes their triage pass quickly and is confident they did not miss something critical.

## Positioning

Source-independent aggregation with deterministic, explained triage: every item carries its importance (Critical / High / Normal) with the reason, CVE chips linked to NVD, and exploitation signals (CISA KEV date, FIRST EPSS probability). The page never claims a CVE is safe or unexploited; unavailable data is shown as unavailable.

## Operating Context

- Read once a day, typically in the morning, on desktop and on phones (verified 360px to 1440px).
- Readers also consume the outbound RSS 2.0 and JSON feeds (whole page, by importance, by section) in their own readers or agents.
- Edition is rebuilt every 900 seconds; the sticky bar shows when it was built.

## Capabilities and Constraints

- Seven urgency-ordered sections: Vulnerabilities, Advisories, Ransomware, Breaches, Threat Intelligence, Tools/Techniques, Industry/Policy.
- Source-type label per card (News, Research, Vendor, CERT, Government); per-type lookback (72h CERT/government/vendor, 24h news/research).
- Client-side section filter with per-section counts; reader triage (All / High+ / Critical, unread only, flagged only; flag, mark read, mark all shown read) stored in localStorage only.
- Sections of 9+ articles show 6 then an expander.
- Front page must stay a statically prerendered route with a 900-second ISR window: no request-time APIs. Client components receive only opaque ids, closed enums, counts and timestamps, never feed text.
- Stack: Next.js 16 App Router, React 19, Tailwind CSS 4. Hosted on Netlify.

## Brand Commitments

- Name: Havadis.
- Both light and dark themes are first-class, following the OS setting.

## Evidence on Hand

Live feed data from the 29 sources, CISA KEV catalogue and FIRST EPSS. No testimonials, user counts or press; do not invent them.

## Product Principles

1. Triage speed first: the critical and exploited items must be findable in seconds.
2. Explain every judgement: importance always shows its reason.
3. Never overstate safety: missing enrichment reads as unavailable, never as "not exploited".
4. Private by default: reader state never leaves the browser.
5. Fast and static: the page works without client-side data fetching.

## Accessibility & Inclusion

WCAG 2.2 AA: one h1, labelled sections, focus not obscured by the sticky bar, colour never the only carrier of importance.
