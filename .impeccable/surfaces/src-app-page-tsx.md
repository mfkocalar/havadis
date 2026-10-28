---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: ["src/app/layout.tsx"]
---

# Front page (src/app/page.tsx)

Scope: the public front page and its shell (layout masthead, sticky filter bar, triage toolbar, section headings, article items, footer). Visitor mode: Operate. Audience: security practitioners doing a daily morning triage pass. Job: find what is critical or exploited today, flag or mark read, move on. Constraints: static ISR route (900 s), client islands get only ids/enums/counts/timestamps, every existing feature and a11y behaviour stays.

## Direction contract

THESIS: The day's security news as a hazard manifest. The seven urgency-ordered sections are seven numbered hazard classes; triage reads down aligned columns instead of hunting through a card grid. Refuses the category default of a soft-cornered three-column card grid with pill filters.

OWN-WORLD: Placard vinyl ground (warm off-white / deep asphalt in dark), ink-black hard rules, DIN-style condensed caps (Barlow Condensed) for labels and headings, Barlow for reading, JetBrains Mono for IDs and figures. Class diamonds 1-7 in placard hues (red, orange, split black/white, yellow, blue, white, green). CVE IDs on black-bordered safety-orange identification panels. Importance ramp: filled red placard (Critical), outlined ink placard (High), none (Normal). 4px corners max, 2px ink rules, no shadows.

STORY: The reader sees the edition time and class counts, narrows to High+ or a class, reads down rows where importance, signals and age sit in fixed columns, flags or marks read, and leaves knowing nothing critical was missed.

FIRST VIEWPORT: Black top bar (diamond wordmark, tagline, RSS / JSON Feed / All feeds). Desktop: 240px left rail opening with the edition line (Updated, N stories · M sources, enrichment notice), then the seven class diamonds with counts as section filters. Main: triage bar (importance segmented control, Unread/Flagged toggles, showing N of M, mark shown read, reset). Cited deviations: the edition line lives in the rail because the layout header has no edition data and must stay static; the triage controls stay in main so they are reachable on mobile without duplicate controls. Then over the first class heading (large diamond + condensed caps + shown/total) and dense aligned rows: importance placard | headline, reason, source type + source | CVE panels, KEV, EPSS | age | flag/read. Mobile: rail collapses to a sticky horizontally scrolling class strip; rows stack.

FORM: Hazard Placard (UN dangerous-goods placards and orange identification panels), position 7 of the ordered grounded list; seed:4afd8ef25445e798. Raises: fixed columns on a shared baseline (Botanical Folio); strict three-step importance ramp (Star Atlas); visible capacity shown/total (Cassette J-card); no decorative colour (Warm Consumer App). Signature move: numbered class diamonds as section identity in rail, headings and rows.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
