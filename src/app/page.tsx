import { getFrontPage } from "@/lib/pipeline/getFrontPage";
import { ArticleCard } from "@/components/ArticleCard";

/**
 * The public front page. Awaits `getFrontPage()` once and branches only on
 * its discriminant — none of the error variant's internal diagnostic detail
 * is ever surfaced in the rendered output (threat T-01-10). Both the error
 * variant and the ok-but-empty variant get the same quiet empty-state
 * treatment (CONTEXT.md D-03): Phase 1 has no per-source health UI, so a
 * timeout and a genuinely quiet feed look the same to a reader.
 *
 * Articles are mapped in the exact order `getFrontPage()` returns them —
 * no sort, group, filter, or dedupe here. Ordering/ranking is Phase 3's
 * concern; two articles sharing a published timestamp both render as
 * separate cards.
 */
export default async function Home() {
  const result = await getFrontPage();
  const articles = result.status === "ok" ? result.articles : [];

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
        Latest
      </h1>

      {articles.length === 0 ? (
        <p className="text-zinc-500 dark:text-zinc-400">
          No articles in the last 24 hours.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {articles.map((article) => (
            <ArticleCard key={article.url} article={article} />
          ))}
        </div>
      )}
    </main>
  );
}
