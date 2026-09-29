---
status: testing
phase: 03-deduplication-classification-ranking
source: [03-VERIFICATION.md]
started: 2026-09-29T00:00:00Z
updated: 2026-09-29T00:00:00Z
---

## Current Test

number: 1
name: Section order, ranking "feel," and classification plausibility on the live page
expected: |
  Run `npm run build && npm run start`, open http://localhost:3000 on desktop, then at roughly 375px wide.
  Section headings appear with their emoji in the order Vulnerabilities, Advisories, Ransomware, Breaches,
  Threat Intelligence, Tools/Techniques, Industry/Policy, with any empty section simply absent; no visible
  "Latest" label, no counts/grid/filter/show-more; within a section the order reads sensibly (a few-hours-old
  Government item can sit above a minutes-old general-tech item, day-old items sink); no obviously
  security-relevant headline is stranded in Industry/Policy and no clearly non-security headline sits in a
  security section; tier badges look exactly as before.
awaiting: user response

## Tests

### 1. Section order, ranking "feel," and classification plausibility on the live page
expected: Section headings in correct urgency order with correct emoji; no visible "Latest"/counts/grid/filter/show-more; within-section order reads sensibly (recency + source-tier weighting); no obviously-misclassified headline; tier badges unchanged.
result: [pending]

### 2. The page reads as de-duplicated
expected: Run the same running page. No identical or near-identical headline (same words, differing only in case/punctuation) appears twice anywhere on the page; no card shows an "also reported by", source-count, or similar note; no title shows raw entity text such as &amp;, &trade;, or &#8217; (a CrowdStrike item's trademark sign, if present, should render as (TM)). Differently-worded coverage of the same event from two outlets may still appear as two cards — that is the accepted v1 limitation (D-01), not a defect.
result: [pending]

### 3. CVE chip visual weight, wrapping, and click-through
expected: On the same running page (desktop and ~375px, light and dark system theme), find a card with a CVE ID and click one chip. Red pill chips with monospace uppercase IDs sit in the meta row right after the tier badge, same height/shape as the badge; at 375px they wrap onto the next line without overflowing the card; a card with more than three IDs shows three chips plus "+N"; clicking a chip opens https://nvd.nist.gov/vuln/detail/<ID> in a new tab; cards without CVE IDs show no chip and no gap; the chip reads as the highest-signal element in the meta row without overpowering the headline.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
