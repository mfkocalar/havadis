import clsx from "clsx";
import { ArticleActions } from "@/components/ArticleActions";
import { ArticleTime } from "@/components/ArticleTime";
import { CardShell } from "@/components/CardShell";
import { SourceTierBadge } from "@/components/SourceTierBadge";
import { SourceTypeLabel } from "@/components/SourceTypeLabel";
import { CveChips } from "@/components/CveChips";
import type { ClassifiedArticle, CveEnrichment, Importance } from "@/lib/types";

/**
 * The complete UI-02 article, laid out as one row of the hazard manifest:
 * importance placard, story, exploitation signals, age and actions each keep
 * a fixed column from 1280px up, so a reader compares them straight down a
 * section. Below that the row folds: placard and age on one line, the story,
 * then signals beside the actions.
 *
 * All six UI-02 fields, plus the CVE chips (UI-03, a seventh rendered
 * element built from validated IDs, see `CveChips.tsx`), are rendered as
 * ordinary JSX text nodes — no raw-HTML injection prop is used anywhere in
 * this file. `rss-parser` already delivers an HTML-stripped snippet, and
 * feed fields are untrusted external input (threat T-01-07). This stays a
 * Server Component, so no client JavaScript is needed anywhere in this file.
 *
 * Layout: the story cell reads headline, the importance reason, summary,
 * then the source line (source, tier tag, source-type label: SRC-01, see
 * `SourceTypeLabel.tsx`). The CVE panels follow in their own signal cell, so
 * DOM order stays importance, story, source, signals, time, actions.
 *
 * The timestamp is `ArticleTime`: an absolute UTC time in the prerendered HTML
 * (true however old the cached page is, Phase 4 review WR-04), switched to a
 * live relative age on the client. It is the card's only client island and
 * receives only the normalised ISO string.
 *
 * Per D-08 (02-CONTEXT.md), the title is visually bounded to three lines
 * and the summary to two via Tailwind's `line-clamp-*`. This
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
 * Importance ramp: a filled red placard for Critical, an outlined ink placard
 * for High, nothing for Normal. The word is always printed, so colour is never
 * the only carrier of importance.
 */
const IMPORTANCE_PLACARD: Record<Exclude<Importance, "normal">, { label: string; classes: string }> = {
  critical: {
    label: "Critical",
    classes: "bg-red-600 text-white ring-2 ring-inset ring-red-600",
  },
  high: {
    label: "High",
    classes: "text-stone-950 ring-2 ring-inset ring-stone-950 dark:text-stone-50 dark:ring-stone-200",
  },
};

const REASON_TONE: Record<Exclude<Importance, "normal">, string> = {
  critical: "text-red-700 dark:text-red-400",
  high: "text-stone-800 dark:text-stone-200",
};

/**
 * Grid areas per width. Below 768px: placard + age, story, signals + actions.
 * From 768px a placard column opens on the left. From 1280px every field has
 * its own column.
 */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2.5 [grid-template-areas:'imp_time'_'body_body'_'sig_act'] md:grid-cols-[5.5rem_minmax(0,1fr)_auto] md:[grid-template-areas:'imp_body_time'_'imp_sig_act'] xl:grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,15rem)_3.5rem_auto] xl:[grid-template-areas:'imp_body_sig_time_act']";

export function ArticleCard({
  article,
  byCve,
}: {
  article: ClassifiedArticle;
  byCve?: Readonly<Record<string, CveEnrichment>>;
}) {
  const titleId = `title-${article.id}`;
  const level = article.importance === "normal" ? null : article.importance;
  const badge = level === null ? null : IMPORTANCE_PLACARD[level];

  return (
    <CardShell id={article.id} importance={article.importance}>
      <article
        data-importance={article.importance}
        className={clsx(ROW_GRID, "border-b border-stone-300 py-4 dark:border-stone-800")}
      >
        <div className="[grid-area:imp]">
          {badge ? (
            <span
              className={clsx(
                "inline-flex h-6 items-center justify-center rounded-xs px-2 font-display text-[0.8125rem] font-bold tracking-widest uppercase md:w-full",
                badge.classes,
              )}
            >
              {badge.label}
            </span>
          ) : null}
        </div>

        <div className="min-w-0 [grid-area:body]">
          {/*
           * h3, not h2: page.tsx's per-section headings are the page's h2
           * level (D-16), so the title sits one level down to keep a valid
           * document outline (WCAG 1.3.1). Three-line clamp (D-08): a guard
           * for the longest titles on narrow screens; the full string stays
           * in the DOM and the accessibility tree.
           */}
          <h3 id={titleId} className="line-clamp-3 text-[1.0625rem] leading-snug font-semibold break-words text-pretty text-stone-950 dark:text-stone-50">
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xs decoration-orange-500 decoration-2 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-950 dark:focus-visible:outline-stone-100"
            >
              {article.title}
            </a>
          </h3>

          {level !== null ? (
            <p className={clsx("mt-1 text-sm font-semibold", REASON_TONE[level])}>
              {article.importanceReason}
            </p>
          ) : null}

          {/*
           * Two-line clamp (D-08): the summary is context for triage, not the
           * story, so it is bounded tighter than the title. The paragraph is
           * omitted entirely (not rendered empty) when the publisher supplied
           * no summary at all: an explicit length comparison with an explicit
           * `null` alternative, never a bare truthiness `&&`, and no
           * placeholder copy (D-05: never show the reader machinery).
           */}
          {article.summary.length > 0 ? (
            <p className="mt-1 line-clamp-2 max-w-[75ch] text-sm leading-relaxed text-stone-600 dark:text-stone-400">
              {article.summary}
            </p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span className="text-sm font-semibold text-stone-800 dark:text-stone-200">{article.source}</span>
            <SourceTierBadge tier={article.sourceTier} />
            <SourceTypeLabel type={article.sourceType} />
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap content-start items-center gap-1.5 self-center [grid-area:sig] xl:self-start">
          <CveChips cves={article.cves} byCve={byCve} />
        </div>

        <div className="justify-self-end font-mono text-xs leading-6 text-stone-600 [grid-area:time] dark:text-stone-400">
          <ArticleTime iso={article.publishedAt} />
        </div>

        <div className="justify-self-end [grid-area:act]">
          <ArticleActions id={article.id} titleId={titleId} />
        </div>
      </article>
    </CardShell>
  );
}
