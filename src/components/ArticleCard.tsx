import { formatRelativeTime } from "@/lib/formatRelativeTime";
import { SourceTierBadge } from "@/components/SourceTierBadge";
import { CveChips } from "@/components/CveChips";
import type { ClassifiedArticle } from "@/lib/types";

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
 * Server Component: the absolute-time hover is the native `title`
 * attribute, so no client JavaScript is needed anywhere in this file.
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
export function ArticleCard({ article }: { article: ClassifiedArticle }) {
  const absoluteTime = new Date(article.publishedAt).toLocaleString();

  return (
    <article className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition-shadow duration-150 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {article.source}
        </span>
        <SourceTierBadge tier={article.sourceTier} />
        <CveChips cves={article.cves} />
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
      <h3 className="mt-3 line-clamp-3 break-words text-xl font-semibold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50">
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
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
       * timestamp instead.
       */}
      {article.summary.length > 0 ? (
        <p className="mt-2 line-clamp-3 text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
          {article.summary}
        </p>
      ) : null}

      <time
        dateTime={article.publishedAt}
        title={absoluteTime}
        className="mt-4 block text-sm text-zinc-400 dark:text-zinc-500"
      >
        {formatRelativeTime(article.publishedAt)}
      </time>
    </article>
  );
}
