import { Fragment } from "react";
import { planCveChips } from "@/lib/cveChips";
import type { CveEnrichment } from "@/lib/types";

/**
 * Red, monospace CVE-ID chips rendered next to the tier badge in an
 * `ArticleCard`'s meta row (UI-03, D-13/D-14/D-15). A Server Component: no
 * client-boundary directive, no hooks — plain server-rendered `<a>` links,
 * exactly like `SourceTierBadge` (verified against
 * `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
 * — Server Components are the default and need no interactivity here).
 *
 * Renders plain JSX text children only (T-01-07): no raw-HTML injection
 * prop anywhere in this file. Every `href` is built exclusively from
 * `planCveChips`/`nvdUrl`'s regex-matched, anchored-validated ID — never
 * from feed-supplied URL text (D-14, T-03-11).
 *
 * The KEV chip text comes only from the validated slim KEV map (its
 * `YYYY-MM-DD` date, as a single JSX text node), and it is never a link: a
 * non-link span right after its CVE anchor, so it adds no outbound-link
 * surface (D-19). A CVE that is not listed, or whose KEV state is unavailable,
 * renders nothing extra (D-09).
 *
 * The EPSS chip is likewise a non-link span after the KEV chip: `EPSS 0.91`
 * for a scored CVE, a muted `no EPSS yet` only when FIRST answered consistently
 * without a row, and nothing when the lookup was unavailable (D-07, D-11).
 */

/**
 * Base pill geometry copied verbatim from `SourceTierBadge`'s className
 * string (D-15), plus the reserved red tone (Phase 2 D-02) and a monospace
 * ID. The "+N" overflow chip reuses these exact classes (RESEARCH.md Open
 * Question 3) so it reads as part of the same chip family, not a distinct
 * control.
 */
const CHIP_CLASSES =
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap bg-red-50 text-red-700 ring-1 ring-inset ring-red-200 font-mono";

/**
 * KEV chip: the pill geometry of `CHIP_CLASSES` with a solid red tone (white
 * on red-700 measures 6.42:1, RESEARCH Pattern 4). Plan 07-03 moves it into
 * `cveChipStyles.ts` under a contrast test.
 */
const KEV_CHIP_CLASSES =
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap bg-red-700 text-white tabular-nums";

/** EPSS score chip: the pill geometry of `CHIP_CLASSES` in a neutral zinc tone. Plan 07-03 moves it into `cveChipStyles.ts`. */
const EPSS_CHIP_CLASSES =
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap bg-zinc-100 text-zinc-700 ring-1 ring-inset ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700 tabular-nums";

/** "no EPSS yet" chip: the same geometry in a muted tone. Plan 07-03 moves it into `cveChipStyles.ts`. */
const EPSS_NONE_YET_CHIP_CLASSES =
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap bg-zinc-50 text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-700";

export function CveChips({
  cves,
  byCve,
}: {
  cves: string[];
  byCve?: Readonly<Record<string, CveEnrichment>>;
}) {
  const plan = planCveChips(cves, byCve);

  if (plan.visible.length === 0) {
    return null;
  }

  return (
    <>
      {plan.visible.map((chip) => (
        <Fragment key={chip.id}>
          <a
            href={chip.href}
            target="_blank"
            rel="noopener noreferrer"
            className={CHIP_CLASSES}
          >
            {chip.id}
          </a>
          {chip.kev !== null ? (
            <span
              data-kev-chip=""
              title={`Listed in the CISA Known Exploited Vulnerabilities catalog, added ${chip.kev.added}`}
              className={KEV_CHIP_CLASSES}
            >
              <span className="sr-only">Known exploited, </span>
              {`KEV · ${chip.kev.added}`}
            </span>
          ) : null}
          {chip.epss !== null && chip.epss.kind === "score" ? (
            <span
              data-epss-chip="score"
              title={`FIRST EPSS exploitation probability, scored ${chip.epss.date}`}
              className={EPSS_CHIP_CLASSES}
            >
              {`EPSS ${chip.epss.label}`}
            </span>
          ) : null}
          {chip.epss !== null && chip.epss.kind === "none-yet" ? (
            <span
              data-epss-chip="none-yet"
              title="FIRST has published no EPSS score for this CVE yet"
              className={EPSS_NONE_YET_CHIP_CLASSES}
            >
              no EPSS yet
            </span>
          ) : null}
        </Fragment>
      ))}
      {plan.overflow > 0 ? <span className={CHIP_CLASSES}>+{plan.overflow}</span> : null}
    </>
  );
}
