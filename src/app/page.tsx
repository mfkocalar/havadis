import { getFrontPage } from "@/lib/pipeline/getFrontPage";
import { ArticleCard } from "@/components/ArticleCard";
import { SECTION_EMOJI } from "@/lib/config/sections";

/**
 * The public front page. Awaits `getFrontPage()` once and branches only on
 * its discriminant — none of the error variant's internal diagnostic detail
 * is ever surfaced in the rendered output (threat T-01-10 / T-03-04). Both
 * the error variant and the ok-but-empty variant get the same quiet
 * empty-state treatment (CONTEXT.md D-03): Phase 1 has no per-source health
 * UI, so a timeout and a genuinely quiet feed look the same to a reader.
 *
 * Sections and within-section order arrive fully resolved from
 * `getFrontPage()` (classification + ranking are Phase 3's pipeline
 * concern, not this file's) — this page only maps two nested arrays: the
 * outer `sections` array into an urgency-ordered heading per non-empty
 * section (D-12/D-16), and each group's `articles` into cards in the exact
 * order they arrive. No sort, group, filter, dedupe, count, grid, or
 * show-more control here (D-16) — those either already happened upstream or
 * are explicitly out of scope for this phase (Phase 4: UI-01, UI-04,
 * FILTER-01).
 */
export default async function Home() {
  const result = await getFrontPage();
  const sections = result.status === "ok" ? result.sections : [];

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      {/*
       * D-16 swaps the single visible "Latest" label for per-section
       * headings below. The document still keeps exactly one <h1> for
       * assistive technology (WCAG document-outline expectations) — it is
       * visually hidden via `sr-only` rather than removed, and introduces
       * no new copy.
       */}
      <h1 className="sr-only">Latest</h1>

      {sections.length === 0 ? (
        <p className="text-zinc-500 dark:text-zinc-400">
          No articles in the last 24 hours.
        </p>
      ) : (
        <div className="flex flex-col gap-12">
          {sections.map((group) => (
            <section
              key={group.section}
              data-section={group.section}
              className="flex flex-col gap-4"
            >
              <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                <span aria-hidden="true">{SECTION_EMOJI[group.section]}</span> {group.section}
              </h2>
              <div className="flex flex-col gap-6">
                {group.articles.map((article) => (
                  <ArticleCard key={article.url} article={article} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
