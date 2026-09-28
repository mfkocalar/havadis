import { planCveChips } from "@/lib/cveChips";

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

export function CveChips({ cves }: { cves: string[] }) {
  const plan = planCveChips(cves);

  if (plan.visible.length === 0) {
    return null;
  }

  return (
    <>
      {plan.visible.map((chip) => (
        <a
          key={chip.id}
          href={chip.href}
          target="_blank"
          rel="noopener noreferrer"
          className={CHIP_CLASSES}
        >
          {chip.id}
        </a>
      ))}
      {plan.overflow > 0 ? <span className={CHIP_CLASSES}>+{plan.overflow}</span> : null}
    </>
  );
}
