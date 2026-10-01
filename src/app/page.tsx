import { getFrontPage } from "@/lib/pipeline/getFrontPage";
import { ArticleCard } from "@/components/ArticleCard";
import { FrontPageFilter, SectionVisibility } from "@/components/FrontPageFilter";
import { SectionFilterBar } from "@/components/SectionFilterBar";
import { SECTION_EMOJI } from "@/lib/config/sections";
import { articleCountLabel, type FilterPill } from "@/lib/sectionFilter";

/**
 * D-02: 1 column below 768px, 2 from 768px, 3 from 1024px. Sparse sections
 * leave the remaining cells empty (D-04). Plan 04-02 reuses this verbatim.
 */
const CARD_GRID_CLASSES = "grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3";

/**
 * The public front page. Awaits `getFrontPage()` once and branches only on
 * its discriminant -- none of the error variant's internal diagnostic detail
 * is ever surfaced in the rendered output (threat T-01-10 / T-03-04). Both
 * the error variant and the ok-but-empty variant get the same quiet
 * empty-state treatment (CONTEXT.md D-03): there is no per-source health UI,
 * so a timeout and a genuinely quiet feed look the same to a reader. That
 * branch mounts no filter provider and no bar.
 *
 * Sections and within-section order arrive fully resolved from
 * `getFrontPage()` (classification, ranking, dedupe stay upstream pipeline
 * concerns, not this file's). Otherwise this page lays the front page out:
 * a sticky bar of count-bearing section pills (D-08, D-11), then one
 * urgency-ordered section per non-empty group (D-12/D-16), each with its
 * full article count beside the heading (D-14). Filtering (D-09) is purely
 * client-side: every section stays in the server-rendered HTML and the
 * `SectionVisibility` wrapper only toggles the `hidden` attribute. Only
 * section names, emoji and counts cross into client components (T-01-07);
 * the cards are server-rendered and passed through as children.
 *
 * The route MUST stay statically prerendered with the 900-second revalidation
 * window of the fetch cache: no request-time APIs (cookies, headers, search
 * params) and no route segment config exports here, or in any client
 * component this page mounts.
 */
export default async function Home() {
  const result = await getFrontPage();

  if (result.status !== "ok" || result.sections.length === 0) {
    return (
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="sr-only">Latest</h1>
        <p className="text-zinc-500 dark:text-zinc-400">
          No articles in the last 24 hours.
        </p>
      </main>
    );
  }

  // One count per section, reused for the pill, the heading and the markup
  // hooks (Pitfall 9).
  const pills: FilterPill[] = result.sections.map((group) => ({
    section: group.section,
    emoji: SECTION_EMOJI[group.section],
    count: group.articles.length,
  }));

  return (
    <FrontPageFilter>
      <SectionFilterBar pills={pills} />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
        {/*
         * D-16 swaps the single visible "Latest" label for per-section
         * headings below. The document still keeps exactly one <h1> for
         * assistive technology (WCAG document-outline expectations) -- it is
         * visually hidden via `sr-only` rather than removed.
         */}
        <h1 className="sr-only">Latest</h1>

        <div className="flex flex-col gap-12">
          {result.sections.map((group, index) => {
            const total = group.articles.length;
            const headingId = `section-heading-${index}`;
            return (
              <SectionVisibility key={group.section} section={group.section}>
                <section
                  data-section={group.section}
                  data-count={total}
                  aria-labelledby={headingId}
                  className="flex flex-col gap-4"
                >
                  <h2
                    id={headingId}
                    className="text-sm font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400"
                  >
                    <span aria-hidden="true">{SECTION_EMOJI[group.section]}</span> {group.section}
                    <span
                      aria-hidden="true"
                      data-heading-count={total}
                      className="ml-2 font-medium tabular-nums"
                    >
                      {total}
                    </span>
                    <span className="sr-only">{articleCountLabel(total)}</span>
                  </h2>
                  <div className="flex flex-col gap-6">
                    <div className={CARD_GRID_CLASSES}>
                      {group.articles.map((article) => (
                        <ArticleCard key={article.url} article={article} />
                      ))}
                    </div>
                  </div>
                </section>
              </SectionVisibility>
            );
          })}
        </div>
      </main>
    </FrontPageFilter>
  );
}
