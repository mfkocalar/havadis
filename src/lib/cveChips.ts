/**
 * CVE chip cap and NVD link-integrity model (D-13, D-14). Plain TypeScript,
 * no React import, so `node --test` can exercise it hermetically without a
 * DOM or React runtime — the visual chip rendering lives in
 * `src/components/CveChips.tsx`, which imports from here.
 */

/** D-13: a card shows at most this many visible chips before a "+N" overflow chip. */
export const MAX_VISIBLE_CVE_CHIPS = 3;

/** D-14: every chip links to NVD's CVE detail page, never anywhere else. */
export const NVD_CVE_DETAIL_BASE = "https://nvd.nist.gov/vuln/detail/";

/**
 * Anchored, flagless CVE-ID shape check, module-private. Distinct from
 * `extractCves.ts`'s global-flag `CVE_PATTERN` (which scans for matches
 * anywhere in free text): this pattern validates that an entire string is
 * exactly one well-formed CVE ID, uppercase, with nothing before or after.
 */
const CVE_ID_SHAPE = /^CVE-\d{4}-\d{4,7}$/;

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

/** The plan for rendering a card's CVE chips: up to `MAX_VISIBLE_CVE_CHIPS` links, plus an overflow count. */
export type CveChipPlan = {
  visible: Array<{ id: string; href: string }>;
  overflow: number;
};

/**
 * Turns a raw list of CVE IDs into a chip render plan. Any ID whose
 * `nvdUrl` is `null` is dropped entirely — it never counts toward `visible`
 * or `overflow`, so a malformed ID can never surface as a bare chip with no
 * link and can never inflate the "+N" count either.
 */
export function planCveChips(cves: readonly string[]): CveChipPlan {
  const valid = cves
    .map((id) => ({ id, href: nvdUrl(id) }))
    .filter((entry): entry is { id: string; href: string } => entry.href !== null);

  return {
    visible: valid.slice(0, MAX_VISIBLE_CVE_CHIPS),
    overflow: Math.max(0, valid.length - MAX_VISIBLE_CVE_CHIPS),
  };
}
