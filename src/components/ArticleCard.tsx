import { formatRelativeTime } from "@/lib/formatRelativeTime";
import { SourceTierBadge } from "@/components/SourceTierBadge";
import type { Article } from "@/lib/types";

/**
 * The complete UI-02 article card, built to the "Modern editorial"
 * direction (CONTEXT.md D-02): a card surface with a subtle shadow and
 * soft radius, sans-serif typographic hierarchy, generous whitespace, and
 * a hover treatment — closer to a modern tech-news site than a broadsheet
 * pastiche or a dark terminal look.
 *
 * All six UI-02 fields are rendered as ordinary JSX text nodes — no
 * raw-HTML injection prop is used anywhere in this file. `rss-parser`
 * already delivers an HTML-stripped snippet, and feed fields are
 * untrusted external input (threat T-01-07). This stays a Server
 * Component: the absolute-time hover is the native `title` attribute, so
 * no client JavaScript is needed anywhere in this file.
 */
export function ArticleCard({ article }: { article: Article }) {
  const absoluteTime = new Date(article.publishedAt).toLocaleString();

  return (
    <article className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition-shadow duration-150 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {article.source}
        </span>
        <SourceTierBadge tier={article.sourceTier} />
      </div>

      <h2 className="mt-3 text-xl font-semibold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50">
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
        >
          {article.title}
        </a>
      </h2>

      <p className="mt-2 text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
        {article.summary}
      </p>

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
