---
name: Havadis
description: The day's security news as a hazard manifest.
colors:
  vinyl-ground: "#f2f0e9"
  asphalt-ground: "#151311"
  ink: "#1c1917"
  ink-on-dark: "#f5f5f4"
  rule-ink: "oklch(14.7% 0.004 49.25)"
  rule-ink-dark: "oklch(37.4% 0.01 67.558)"
  inverted-ink-dark: "oklch(97% 0.001 106.424)"
  muted-ink: "oklch(44.4% 0.011 73.639)"
  muted-ink-dark: "oklch(70.9% 0.01 56.259)"
  control-outline: "oklch(55.3% 0.013 58.071)"
  hairline: "oklch(86.9% 0.005 56.366)"
  hairline-dark: "oklch(26.8% 0.007 34.298)"
  hover-wash: "oklch(92.3% 0.003 48.717)"
  masthead-black: "#000000"
  placard-red: "oklch(57.7% 0.245 27.325)"
  critical-reason: "oklch(50.5% 0.213 27.518)"
  critical-reason-dark: "oklch(70.4% 0.191 22.216)"
  identification-orange: "oklch(70.5% 0.213 47.604)"
  hazard-yellow: "oklch(85.2% 0.199 91.936)"
  signal-yellow: "oklch(90.5% 0.182 98.111)"
  class-blue: "oklch(48.8% 0.243 264.376)"
  class-green: "oklch(52.7% 0.154 150.069)"
  placard-white: "#ffffff"
typography:
  display:
    fontFamily: "Barlow Condensed, Arial, Helvetica, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.025em"
  label:
    fontFamily: "Barlow Condensed, Arial, Helvetica, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 700
    letterSpacing: "0.05em"
  placard:
    fontFamily: "Barlow Condensed, Arial, Helvetica, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 700
    letterSpacing: "0.1em"
  tag:
    fontFamily: "Barlow Condensed, Arial, Helvetica, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: "1.25rem"
    letterSpacing: "0.05em"
  title:
    fontFamily: "Barlow, Arial, Helvetica, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.375
  body:
    fontFamily: "Barlow, Arial, Helvetica, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.625
  body-strong:
    fontFamily: "Barlow, Arial, Helvetica, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
  mono-id:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: "1.25rem"
  mono-meta:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 500
rounded:
  xs: "2px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "48px"
  rail: "240px"
  container: "1536px"
components:
  importance-placard-critical:
    backgroundColor: "{colors.placard-red}"
    textColor: "{colors.placard-white}"
    typography: "{typography.placard}"
    rounded: "{rounded.xs}"
    height: "24px"
    width: "88px"
  importance-placard-high:
    textColor: "{colors.rule-ink}"
    typography: "{typography.placard}"
    rounded: "{rounded.xs}"
    height: "24px"
    width: "88px"
  cve-panel:
    backgroundColor: "{colors.identification-orange}"
    textColor: "{colors.rule-ink}"
    typography: "{typography.mono-id}"
    rounded: "{rounded.xs}"
    padding: "0 6px"
  kev-chip:
    backgroundColor: "{colors.rule-ink}"
    textColor: "{colors.placard-white}"
    typography: "{typography.mono-id}"
    rounded: "{rounded.xs}"
    padding: "2px 6px"
  kev-chip-dark:
    backgroundColor: "{colors.inverted-ink-dark}"
    textColor: "{colors.rule-ink}"
  epss-chip:
    backgroundColor: "{colors.placard-white}"
    textColor: "{colors.ink}"
    typography: "{typography.mono-id}"
    rounded: "{rounded.xs}"
    padding: "2px 6px"
  epss-chip-strong:
    backgroundColor: "{colors.signal-yellow}"
    textColor: "{colors.rule-ink}"
    typography: "{typography.mono-id}"
    rounded: "{rounded.xs}"
    padding: "2px 6px"
  tier-tag:
    textColor: "{colors.muted-ink}"
    typography: "{typography.tag}"
    rounded: "{rounded.xs}"
    padding: "0 6px"
  control-pill:
    backgroundColor: "{colors.vinyl-ground}"
    textColor: "{colors.ink}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.xs}"
    padding: "0 12px"
    height: "44px"
  control-pill-pressed:
    backgroundColor: "{colors.rule-ink}"
    textColor: "{colors.ink-on-dark}"
  control-pill-pressed-dark:
    backgroundColor: "{colors.inverted-ink-dark}"
    textColor: "{colors.rule-ink}"
  segmented-option:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "0 14px"
    height: "44px"
  segmented-option-pressed:
    backgroundColor: "{colors.rule-ink}"
    textColor: "{colors.placard-white}"
  row-action:
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.xs}"
    size: "44px"
  row-action-flagged:
    backgroundColor: "{colors.hazard-yellow}"
    textColor: "{colors.rule-ink}"
  row-action-read:
    backgroundColor: "{colors.rule-ink}"
    textColor: "{colors.placard-white}"
  expander-button:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.xs}"
    padding: "0 20px"
    height: "44px"
  masthead:
    backgroundColor: "{colors.rule-ink}"
    textColor: "{colors.ink-on-dark}"
    typography: "{typography.display}"
    padding: "14px 16px"
---

# Design System: Havadis

## Overview

**Creative North Star: "The Hazard Manifest"**

Havadis presents the day's security news the way a dangerous-goods shipment is declared: seven numbered hazard classes in fixed urgency order, each item a row on the manifest, every signal printed in a fixed place. The material is placard vinyl (a warm off-white ground by day, deep asphalt by night), ink-black hard rules, square-shouldered panels and DIN-style condensed capitals. Nothing floats, nothing glows; depth comes from ink weight, not light.

The page is dense on purpose. A practitioner reads straight down aligned columns (importance, story, signals, age, actions) and compares rows top to bottom rather than hunting across a card grid. Colour is a language, not decoration: placard hues mark section class, importance and exploitation, and every coloured mark also carries a printed word or number, so colour is never the only carrier of meaning.

Both themes are first-class and follow the OS setting. Dark mode is the same placard at night: the ground turns to asphalt, ink inverts to near-white, hard rules soften to a dark stone, and the placard hues stay put.

**Key Characteristics:**
- Numbered class diamonds (1-7) as section identity in the rail, the section headings and the filter strip.
- Fixed-column manifest rows sharing one baseline from 1280px up.
- A strict three-step importance ramp: filled red placard, outlined ink placard, nothing.
- Three type voices: condensed caps for labels and headings, Barlow for reading, JetBrains Mono for IDs, figures and times.
- 2px corners, 2px ink rules for structure, 1px hairlines between rows, no shadows.

## Colors

A warm neutral ink system on vinyl or asphalt, with placard hues reserved for what they mean.

### Primary
- **Placard Red** (placard-red): the Critical placard, the class 1 (Vulnerabilities) diamond, and the Critical marker in the importance control. The loudest mark on the page; it appears only where something is critical or most urgent.
- **Critical Reason Red** (critical-reason, critical-reason-dark in dark): the printed reason under a Critical headline, so the judgement is explained in the same voice as the placard.

### Secondary
- **Identification Orange** (identification-orange): the CVE identification panel (like the UN number panel on a tanker), the class 2 (Advisories) diamond, the wordmark diamond, and the hover underline on headlines and masthead links. It is the house identity colour and the colour of an identifier; it never fills a control.

### Tertiary
- **Hazard Yellow** (hazard-yellow): the class 4 (Breaches) diamond and the pressed Flag button.
- **Signal Yellow** (signal-yellow): an EPSS score at or above the emphasis threshold and the enrichment-unavailable notice in the rail. A flagged row takes a faint wash of the yellow family as its background.
- **Class Blue** (class-blue) and **Class Green** (class-green): the class 5 (Threat Intelligence) and class 7 (Industry/Policy) diamonds only.
- **Placard White** (placard-white): the class 6 diamond, the white half of the split class 3 diamond, and ink on red or black fills.

### Neutral
- **Vinyl Ground** (vinyl-ground): the light page ground. **Asphalt Ground** (asphalt-ground): the dark page ground. Both are six-digit hex because the contrast tests read them from globals.css.
- **Ink** (ink) and **Ink On Dark** (ink-on-dark): body text per theme.
- **Rule Ink** (rule-ink): headlines, 2px structural rules, the masthead, pressed controls and the KEV chip. In dark mode, structural rules use **Rule Ink Dark** (rule-ink-dark), and inverted fills use **Inverted Ink Dark** (inverted-ink-dark).
- **Muted Ink** (muted-ink, muted-ink-dark in dark): summaries, ages, counts, the source-type word, the edition line. Always at least 4.5:1 on its ground.
- **Control Outline** (control-outline): the 1px inset outline of an unpressed control, its only visible edge, at least 3:1 in both themes.
- **Hairline** (hairline, hairline-dark in dark): the 1px divider between manifest rows. **Hover Wash** (hover-wash): the hover fill of neutral controls (stone-800 in dark).
- **Masthead Black** (masthead-black): the dark-mode masthead, one step below asphalt, with a hairline under it.

### Named Rules
**The Meaning-Only Hue Rule.** A hue appears only for section class, importance, exploitation signal, reader flag, or the orange identity. Controls, tags, tiers and source types stay in stone ink; a control's state is shown by ink inversion, never by a hue.

**The Printed Word Rule.** Every coloured mark carries its meaning in text too: the placard prints CRITICAL or HIGH, the diamond prints its class number beside the section name, the KEV chip prints its date.

**The Fixed Placard Rule.** Placard hues do not change between themes. Only the ground, the ink and the rules invert.

## Typography

**Display Font:** Barlow Condensed (with Arial, Helvetica, sans-serif), weights 600-800
**Body Font:** Barlow (with Arial, Helvetica, sans-serif), weights 400-700
**Label/Mono Font:** JetBrains Mono

**Character:** A DIN-descended signage pairing: condensed capitals that read like stencilled placard lettering, over a humanist grotesque from the same family for anything meant to be read. Mono is the voice of identifiers and measurements. Body numerals are tabular everywhere.

### Hierarchy
- **Display** (800, 1.75rem, line-height 1, uppercase, 0.025em): the wordmark and section headings (1.5rem below 640px). Always uppercase.
- **Label** (700, 0.9375rem, uppercase, 0.05em): the importance segmented control and the Show all / Show fewer expander.
- **Placard** (700, 0.8125rem, uppercase, 0.1em): the text on importance placards.
- **Tag** (700, 0.75rem, uppercase, 0.05em): the source-tier tag.
- **Title** (600, 1.0625rem, line-height 1.375): row headlines, clamped to three lines.
- **Body** (400, 0.875rem, line-height 1.625): summaries, clamped to two lines, max 75ch. Body-strong (600, 0.875rem) carries the importance reason, the source name and control labels.
- **Mono ID** (700, 0.75rem, line-height 1.25rem): CVE IDs, KEV and EPSS chips. **Mono Meta** (400-500, 0.75rem): ages, counts, the edition line.

### Named Rules
**The Three Voices Rule.** Condensed caps label and announce; Barlow is read; mono identifies and measures. A CVE ID, a count, a time or a score is always mono; a row headline is never caps.

**The Caps Belong To Signage Rule.** Uppercase is reserved for condensed-face labels (headings, placards, tags, controls). Barlow body text is never set in caps.

## Layout

A single manifest column inside a 1536px container (max-w 96rem), with 16 / 24 / 32px side padding at base / 640px / 1024px.

From 1024px the page is a two-column grid: a 240px sticky full-height left rail (edition line, then the seven class filters stacked) divided from main by a 2px ink rule, and main (24px vertical gap, 32px top padding). Below 1024px the rail becomes a sticky strip under the masthead: the class filters scroll horizontally in one row (well under the 96px scroll padding) and the edition line sits beneath them.

Main stacks the triage toolbar (closed by a 2px rule), then sections 48px apart. Each section opens with a heading on a 2px rule: large class diamond, name in display caps, shown/total in mono at the far end.

Manifest rows are a grid with 16px column gap and 16px vertical padding, divided by 1px hairlines:
- Below 768px: placard and age on one line, the story full width, then signals beside the actions.
- From 768px: an 88px placard column opens on the left; story and age on the first line, signals and actions on the second.
- From 1280px: five fixed columns on one baseline: placard 88px | story (fluid) | signals (up to 240px) | age 56px | actions.

Touch targets are 44px below 768px and 32-36px from 768px up. Scroll padding is 6rem below 1024px and 1.5rem above, so focus and filter jumps clear the sticky strip.

### Named Rules
**The Fixed Column Rule.** A field that appears in a row always occupies the same column, empty or not. An empty placard column stays empty; Normal items do not shift their story left.

**The Visible Capacity Rule.** Wherever a set is narrowed, show shown and total together (section heading counts, "Showing N of M", Show all N).

## Elevation & Depth

Flat. There are no shadows anywhere in the system. Depth and grouping come from ink weight: 2px ink rules separate structural regions (masthead edge, rail, toolbar, section heading), 1px hairlines separate rows, and inversion (ink fill, light text) marks what is selected. The one translucency is functional: the sticky strip below 1024px uses the ground at 95% with a light backdrop blur so rows passing beneath do not collide with its labels; the rail from 1024px is fully opaque.

### Named Rules
**The Printed Surface Rule.** Everything sits on the same vinyl. Nothing lifts on hover; a hover is a stone wash or an underline.

## Shapes

Square-shouldered. Every panel, chip, tag, control and button uses a 2px corner, the smallest radius that keeps a printed edge from looking cut. Pills, rounded cards and circular buttons do not exist. Borders are inset rings: 2px for the strongest marks (High placard, CVE panel border, importance control frame), 1px for neutral outlines and tags, dashed 1px for "not available yet" states (no EPSS yet, the empty filter result).

The diamond is the one non-rectangular form: a square turned 45 degrees, with a 2px ink border (stone-400 in dark), used at 24px in filters, 32-36px in section headings, and as small 10-14px markers in the importance control and the wordmark.

### Named Rules
**The Two-Pixel Rule.** Corners are 2px. Structural rules are 2px ink. Nothing rounder, nothing softer.

## Components

### Buttons
Ink-on-vinyl controls that invert when chosen.
- **Shape:** square-shouldered (2px), 44px tall below 768px, 32-36px from 768px.
- **Neutral:** ground fill, ink text, 1px inset control-outline ring; hover adds the stone wash.
- **Pressed:** full ink inversion (rule-ink fill, near-white text; inverted again in dark). Never a hue.
- **Focus:** a 2px ink outline offset 2px (near-white in dark) on every interactive element.
- **Text buttons** ("Mark N shown as read", "Reset filters"): semibold ink with a stone underline that darkens to ink on hover; disabled drops to stone-500 without the underline.
- **Expander:** the neutral control set in label caps, full width on mobile, auto width from 768px.

### Importance Segmented Control
A 2px ink frame holding All / High+ / Critical in label caps, each with its mono count. Each option repeats its row placard as a small diamond marker (none, outlined, filled red). The chosen option inverts to ink.

### Chips (signal row)
- **CVE identification panel:** mono ID on Identification Orange with a 2px ink border, linked to NVD; hover underlines. The "+N" overflow reuses the same panel.
- **KEV chip:** solid ink with the catalogue date, inverted per theme. The strongest signal.
- **EPSS chip:** white with a 1px stone outline; at or above the threshold it turns Signal Yellow with an ink ring; "no EPSS yet" is muted on a dashed outline.
- **Tier tag:** neutral 1px outlined tag in condensed caps. Context, not signal: never coloured.

### Manifest Row
- **Placard:** 24px tall, full column width from 768px. Critical is filled Placard Red; High is a 2px ink outline; Normal shows nothing.
- **Story:** headline (title, orange underline on hover), the importance reason (red for Critical, ink for High), the summary in muted ink, then source name, tier tag and source-type word.
- **Age:** mono meta, right aligned.
- **Actions:** two square 44/36px buttons (Flag, Read) with inline line icons. Flag fills Hazard Yellow when pressed; Read inverts to ink.
- **Reader states:** a read row drains to greyscale with muted ink; a flagged row takes a faint yellow wash. Both transition over 150ms ease-out.

### Navigation
- **Masthead:** a black bar with the orange diamond and HAVADIS in display caps, the tagline (hidden below 640px), and RSS / JSON Feed / All feeds as stone-200 links with an underline that turns orange on hover.
- **Class rail / strip:** one pill per section, led by its 24px class diamond, name, and mono count. In the rail the pills stack, lose their outline and fill the width; a section with zero matches drains its diamond to grey and mutes its ink instead of dimming.
- **Footer:** opens on a 2px ink rule; semibold ink links with stone underlines.

### Class Diamond (signature)
The section's hazard class: its number in the fixed urgency order (1 Vulnerabilities, 2 Advisories, 3 Ransomware, 4 Breaches, 5 Threat Intelligence, 6 Tools/Techniques, 7 Industry/Policy) on a placard-hued diamond (red, orange, split white over black, yellow, blue, white, green). The number is stable across editions. Class 3 is split like a corrosives placard, so its number sits on a small white plate to keep 4.5:1. The diamond is decorative to assistive technology; the section name always sits beside it.

## Do's and Don'ts

### Do:
- **Do** lead every section surface with its numbered class diamond, numbered from the fixed display order, not from which sections are present today.
- **Do** keep the importance ramp at exactly three steps: filled red placard (Critical), 2px ink outline (High), nothing (Normal), with the word always printed.
- **Do** show a control's state by ink inversion (rule-ink fill, near-white text) and give unpressed controls a 1px control-outline ring of at least 3:1.
- **Do** set CVE IDs, KEV dates, EPSS scores, counts and ages in JetBrains Mono.
- **Do** separate regions with 2px ink rules and rows with 1px hairlines.
- **Do** show unavailable enrichment as a muted dashed state or a yellow notice, never as an absence that could read as "safe".
- **Do** keep every text pair at 4.5:1 or better on both grounds; the contrast tests read the palette and grounds directly.

### Don't:
- **Don't** use a hue for a control's own state, a tier, a source type or decoration; the Meaning-Only Hue Rule holds.
- **Don't** round anything past 2px or build pill-shaped filters or soft-cornered cards.
- **Don't** add shadows, glows or hover lifts.
- **Don't** lay the news out as a multi-column card grid; rows stay in one manifest column with fixed fields.
- **Don't** dim a control with opacity to show it is empty; drain its colour and mute its ink so the label keeps 4.5:1.
- **Don't** set Barlow body text in caps or row headlines in the condensed face.
