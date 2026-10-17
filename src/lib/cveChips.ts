/**
 * CVE chip cap, ordering and NVD link-integrity model (D-03, D-13, D-14).
 * Plain TypeScript, no React import, so `node --test` can exercise it
 * hermetically without a DOM or React runtime — the visual chip rendering
 * lives in `src/components/CveChips.tsx`, which imports from here.
 *
 * D-03: before the `MAX_VISIBLE_CVE_CHIPS` cut, a card's CVEs are ordered
 * KEV-listed first (newest `added` first), then CVEs with an EPSS score
 * (higher first), then the rest in extraction order, so a KEV-listed CVE is
 * never folded behind "+N" while a plain CVE is visible. Assumption A4
 * (accepted by the user): among KEV-listed CVEs with the same `added` date,
 * the higher EPSS score comes first, then extraction order.
 */

import type { CveEnrichment } from "./types.ts";
import { EPSS_EMPHASIS_THRESHOLD } from "./enrichment/config.ts";

/** D-13: a card shows at most this many visible chips before a "+N" overflow chip. */
export const MAX_VISIBLE_CVE_CHIPS = 3;

/** D-14: every chip links to NVD's CVE detail page, never anywhere else. */
export const NVD_CVE_DETAIL_BASE = "https://nvd.nist.gov/vuln/detail/";

/**
 * Anchored, flagless CVE-ID shape check. Distinct from `extractCves.ts`'s
 * global-flag `CVE_PATTERN` (which scans for matches anywhere in free text):
 * this pattern validates that an entire string is exactly one well-formed CVE
 * ID, uppercase, with nothing before or after. Exported so the enrichment
 * modules (`kev.ts`, `enrich.ts`) key every upstream value with the exact
 * anchored shape that gates NVD links.
 */
export const CVE_ID_SHAPE = /^CVE-\d{4}-\d{4,7}$/;

/**
 * Builds the NVD detail URL for a CVE ID, but only when `id` is itself
 * exactly a well-formed, uppercase CVE ID (defence in depth, D-14): even if
 * a malformed or feed-controlled value somehow reached this function, it can
 * never become an `href` — `null` is returned instead, and the caller
 * (`planCveChips`) drops it. This is what makes T-03-11 provably closed
 * without relying on `extractCves` alone.
 */
export function nvdUrl(id: string): string | null {
  return CVE_ID_SHAPE.test(id) ? NVD_CVE_DETAIL_BASE + id : null;
}

/**
 * One CVE's chip: the NVD link plus the validated enrichment that decides the
 * KEV and EPSS chips after it. `kev` is non-null only for a listed CVE; `epss`
 * is null when the lookup was unavailable (D-09, D-11), `none-yet` only after a
 * consistent FIRST answer without a row (D-07). Only `href` is ever a link.
 */
export type CveChip = {
  id: string;
  href: string;
  kev: { added: string } | null;
  epss:
    | { kind: "score"; label: string; strong: boolean; date: string }
    | { kind: "none-yet" }
    | null;
};

/** The plan for rendering a card's CVE chips: up to `MAX_VISIBLE_CVE_CHIPS` chips, plus an overflow count. */
export type CveChipPlan = {
  visible: CveChip[];
  overflow: number;
};

type Ranked = { chip: CveChip; index: number; score: number | null };

/**
 * D-03 comparator. Every tie ends in the original extraction index, so the
 * order never depends on the engine's sort stability.
 */
function compareRanked(a: Ranked, b: Ranked): number {
  const aKev = a.chip.kev;
  const bKev = b.chip.kev;
  if (aKev !== null && bKev === null) return -1;
  if (aKev === null && bKev !== null) return 1;
  if (aKev !== null && bKev !== null && aKev.added !== bKev.added) {
    // ISO dates compare as text: the later date (newer addition) first.
    return aKev.added < bKev.added ? 1 : -1;
  }
  if (a.score !== null && b.score === null) return -1;
  if (a.score === null && b.score !== null) return 1;
  if (a.score !== null && b.score !== null && a.score !== b.score) {
    return b.score - a.score;
  }
  return a.index - b.index;
}

/**
 * Turns a raw list of CVE IDs into a chip render plan. Any ID whose
 * `nvdUrl` is `null` is dropped entirely, before ordering — it never counts
 * toward `visible` or `overflow`, so a malformed ID can never surface as a
 * bare chip with no link and can never inflate the "+N" count either. The
 * valid chips are then ordered by D-03 and cut to `MAX_VISIBLE_CVE_CHIPS`.
 * `byCve` is optional: without it every chip is plain and extraction order
 * is kept.
 */
export function planCveChips(
  cves: readonly string[],
  byCve: Readonly<Record<string, CveEnrichment>> = {}
): CveChipPlan {
  const ranked: Ranked[] = [];
  cves.forEach((id, index) => {
    const href = nvdUrl(id);
    if (href === null) return;
    const entry = Object.hasOwn(byCve, id) ? byCve[id] : null;
    const kev = entry !== null && entry.kev.state === "listed" ? { added: entry.kev.added } : null;
    let epss: CveChip["epss"] = null;
    let score: number | null = null;
    if (entry !== null && entry.epss.state === "scored") {
      score = entry.epss.score;
      epss = {
        kind: "score",
        label: formatEpss(entry.epss.score),
        strong: entry.epss.score >= EPSS_EMPHASIS_THRESHOLD,
        date: entry.epss.date,
      };
    } else if (entry !== null && entry.epss.state === "no-row") {
      epss = { kind: "none-yet" };
    }
    ranked.push({ chip: { id, href, kev, epss }, index, score });
  });

  ranked.sort(compareRanked);

  return {
    visible: ranked.slice(0, MAX_VISIBLE_CVE_CHIPS).map((r) => r.chip),
    overflow: Math.max(0, ranked.length - MAX_VISIBLE_CVE_CHIPS),
  };
}

/**
 * The EPSS score label (D-05): the exploitation probability to two decimals,
 * never `0.00` (a score below 0.01 reads `<0.01`, branching on the raw score so
 * 0.0099 is `<0.01` and 0.01 is `0.01`), and never a percentile or a percent.
 */
export function formatEpss(score: number): string {
  return score < 0.01 ? "<0.01" : score.toFixed(2);
}
