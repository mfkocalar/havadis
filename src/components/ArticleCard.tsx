import clsx from "clsx";
import { ArticleActions } from "@/components/ArticleActions";
import { ArticleTime } from "@/components/ArticleTime";
import { CardShell } from "@/components/CardShell";
import { SourceTierBadge } from "@/components/SourceTierBadge";
import { SourceTypeLabel } from "@/components/SourceTypeLabel";
import { CveChips } from "@/components/CveChips";
import type { ClassifiedArticle, Importance } from "@/lib/types";

/**
 * The complete UI-02 article card, built to the "Modern editorial"
 * direction (CONTEXT.md D-02): a card surface with a subtle shadow and
 * soft radius, sans-serif typographic hierarchy, generous whitespace, and
 * a hover treatment — closer to a modern tech-news site than a broadsheet
 * pastiche or a dark terminal look.
 *
 * All six UI-02 fields, plus the CVE chips (UI-03, a seventh rendered
 * element built from validated IDs, see `CveChips.tsx`), are rendered as
 * ordinary JSX text nodes — no raw-HTML injection prop is used anywhere in
 * this file. `rss-parser` already delivers an HTML-stripped snippet, and
 * feed fields are untrusted external input (threat T-01-07). This stays a
 * Server Component, so no client JavaScript is needed anywhere in this file.
 *
 * Layout: the source and the publication time share the top line (who and
 * when, read first), then the headline and summary, then a footer pinned to
 * the card's bottom edge for the tier badge, source-type label (SRC-01, see
 * `SourceTypeLabel.tsx`) and CVE chips, so cards in one
 * grid row align their footers whatever the summary length.
 *
 * The timestamp is `ArticleTime`: an absolute UTC time in the prerendered HTML
 * (true however old the cached page is, Phase 4 review WR-04), switched to a
 * live relative age on the client. It is the card's only client island and
 * receives only the normalised ISO string.
 *
 * Per D-08 (02-CONTEXT.md), both the title and the summary are now
 * visually bounded to three lines via Tailwind's `line-clamp-3`. This
 * deliberately supersedes `01-02-PLAN.md:157`'s "no ellipsis, no line
 * clamp" mandate and the `01-02-PLAN.md:184` verify gate that asserted no
 * clamp existed — that mandate was correct for Phase 1's single source
 * (a tight 476-character median) and wrong at 13 sources (a measured
 * 0-to-26,744-character spread, UAT G-02-5). The bound is presentational
 * only: no text is rewritten here, the full string still reaches the DOM
 * and the accessibility tree, and this file still renders every field as
 * an ordinary JSX text node with no raw-HTML injection prop anywhere in
 * it. Do not reinstate the old no-clamp gate as a "fix" — read D-08 first.
 */
/**
 * Importance accent: a thick leading edge in the level's hue, so a scan down a
 * grid picks out urgent cards before any text is read. Red is the CVE chips'
 * hue (Phase 2 D-02 reserved red and orange for exactly these urgency cues);
 * the solid Critical badge keeps it distinct from the outlined CVE chips.
 */
const IMPORTANCE_ACCENT: Record<Importance, string> = {
  critical: "border-l-4 border-l-red-600 dark:border-l-red-500",
  high: "border-l-4 border-l-amber-500 dark:border-l-amber-400",
  normal: "",
};

const IMPORTANCE_BADGE: Record<Exclude<Importance, "normal">, { label: string; classes: string }> = {
  critical: {
    label: "Critical",
    classes: "bg-red-600 text-white dark:bg-red-500",
  },
  high: {
    label: "High",
    classes: "bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-300 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-400/40",
  },
};

export function ArticleCard({ article }: { article: ClassifiedArticle }) {
  const titleId = `title-${article.id}`;
  const badge = article.importance === "normal" ? null : IMPORTANCE_BADGE[article.importance];

  return (
    <CardShell id={article.id} importance={article.importance}>
      <article
        data-importance={article.importance}
        className={clsx(
          "flex h-full flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition-[box-shadow,border-color] duration-150 hover:shadow-md sm:p-6 dark:border-zinc-800 dark:bg-zinc-900",
          IMPORTANCE_ACCENT[article.importance],
        )}
      >
        {badge ? (
          <p className="mb-2.5 flex items-center gap-2 text-xs font-semibold">
            <span className={clsx("rounded px-1.5 py-0.5 tracking-wide uppercase", badge.classes)}>
              {badge.label}
            </span>
            <span className="text-zinc-700 dark:text-zinc-300">{article.importanceReason}</span>
          </p>
        ) : null}
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="min-w-0 truncate font-semibold text-zinc-800 dark:text-zinc-200">
            {article.source}
          </span>
          <span className="shrink-0 text-zinc-500 dark:text-zinc-400">
            <ArticleTime iso={article.publishedAt} />
          </span>
        </div>

        {/*
         * Three-line clamp (D-08): at the card's widest desktop measure a
         * title never actually reaches three lines (measured max across all
         * 13 sources is 124 characters against ~85 chars/line at text-xl),
         * so in practice this is a mobile-viewport guard — exactly where the
         * longest titles (SANS ISC ~104-char median, CSO Online 124-char
         * max) currently run to four or five lines and blow out the card.
         * The full title string stays in the DOM and the accessibility
         * tree; only its rendered height is bounded, which is why UI-02's
         * verbatim guarantee still holds.
         */}
        {/*
         * h3, not h2: page.tsx's per-section headings are now the page's h2
         * level (D-16), so the card title moves down one level to keep a
         * valid document outline (WCAG 1.3.1).
         */}
        <h3 id={titleId} className="mt-2 line-clamp-3 break-words text-lg font-semibold leading-snug tracking-tight text-pretty text-zinc-900 sm:text-xl dark:text-zinc-50">
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-sm decoration-2 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-50"
          >
            {article.title}
          </a>
        </h3>

        {/*
         * Three-line clamp (D-08), sized against SUMMARY_MAX_CHARS: the
         * data-layer cap sits above the card's three-line capacity at its
         * widest measure, so this clamp — not the cap — is what the reader
         * perceives on every viewport, and the cap never produces a visible
         * mid-sentence cut of its own. Tailwind CSS 4 ships `line-clamp-*`
         * in core; no plugin package is installed or needed for it.
         *
         * The paragraph is omitted entirely (not rendered empty) when the
         * publisher supplied no summary at all (CrowdStrike, measured at 0
         * chars) — an explicit length comparison with an explicit `null`
         * alternative, never a bare truthiness `&&`, so an empty string can
         * never be emitted as a child. No placeholder copy, em dash, or
         * fallback string is substituted (D-05's principle: never show the
         * reader machinery) — the card runs straight from headline to
         * footer instead.
         */}
        {article.summary.length > 0 ? (
          <p className="mt-2 line-clamp-3 text-[0.9375rem] leading-relaxed text-zinc-600 dark:text-zinc-400">
            {article.summary}
          </p>
        ) : null}

        <div className="mt-auto flex items-end gap-3 pt-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <SourceTierBadge tier={article.sourceTier} />
            <SourceTypeLabel type={article.sourceType} />
            <CveChips cves={article.cves} />
          </div>
          <ArticleActions id={article.id} titleId={titleId} />
        </div>
      </article>
    </CardShell>
  );
}
