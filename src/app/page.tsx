import { getFrontPageData } from "@/lib/snapshot";
import { ArticleCard } from "@/components/ArticleCard";
import { FrontPageFilter, SectionCount, SectionVisibility } from "@/components/FrontPageFilter";
import { SectionExpander } from "@/components/SectionExpander";
import { SectionFilterBar } from "@/components/SectionFilterBar";
import { TriageToolbar, type TriageArticle } from "@/components/TriageToolbar";
import { SECTION_EMOJI } from "@/lib/config/sections";
import { enrichmentNotice } from "@/lib/enrichment/enrich";
import { planSectionCap } from "@/lib/planSectionCap";
import { articleCountLabel, type FilterPill } from "@/lib/sectionFilter";

/**
 * D-02: 1 column below 768px, 2 from 768px, 3 from 1024px. Sparse sections
 * leave the remaining cells empty (D-04). Used verbatim by both the primary
 * grid and the overflow grid of a capped section (04-02).
 */
const CARD_GRID_CLASSES = "grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3";

/**
 * The public front page. Awaits `getFrontPageData()` once (the shared cached
 * edition from `src/lib/snapshot.ts`, plus KEV and EPSS enrichment merged at
 * render; enrichment never removes an article). The error variant no longer
 * reaches this page: `getSnapshot` throws when no edition exists, so ISR keeps
 * serving the last good HTML and a cold build during a total feed outage fails
 * (failure policy, `snapshot.ts` header item 7; Phase 6 WR-03). The empty-state
 * branch below stays as a typed guard for an edition with no sections: it
 * mounts no filter provider and no bar, and none of any failure's internal
 * diagnostic detail is ever surfaced in the rendered output (threat T-01-10 /
 * T-03-04). The notice beside "Updated" and the CVE chips come from the
 * render-time enrichment merge; the notice is a fixed-vocabulary string about
 * data availability only.
 *
 * Sections and within-section order arrive fully resolved from that
 * edition (classification, ranking, dedupe stay upstream pipeline
 * concerns, not this file's). Otherwise this page lays the front page out:
 * a sticky bar of count-bearing section pills (D-08, D-11), then one
 * urgency-ordered section per non-empty group (D-12/D-16), each with its
 * full article count beside the heading (D-14). Filtering (D-09) is purely
 * client-side: every section stays in the server-rendered HTML and the
 * `SectionVisibility` wrapper only toggles the `hidden` attribute. Sections
 * of 9 or more articles show their 6 highest-ranked cards, then the rest in a
 * server-rendered overflow grid inside `SectionExpander` (D-05, D-06, D-07):
 * the overflow cards are in the initial HTML and only a `hidden` attribute
 * toggles them. Only section names, emoji, counts and the snapshot timestamp
 * cross into client components (T-01-07); the cards are server-rendered and
 * passed through as children.
 *
 * The route MUST stay statically prerendered with the snapshot's 900-second
 * revalidation window: no request-time APIs (cookies, headers, search
 * params) and no route segment config exports here, or in any client
 * component this page mounts.
 */
export default async function Home() {
  const { result, enrichment } = await getFrontPageData();

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
  // Client components get only these opaque ids and closed enums, never feed
  // text (T-01-07).
  const metasBySection = new Map(
    result.sections.map((group) => [
      group.section,
      group.articles.map((a) => ({ id: a.id, importance: a.importance })),
    ]),
  );
  const pills: FilterPill[] = result.sections.map((group) => ({
    section: group.section,
    emoji: SECTION_EMOJI[group.section],
    count: group.articles.length,
    articles: metasBySection.get(group.section)!,
  }));
  const triageArticles: TriageArticle[] = result.sections.flatMap((group) =>
    metasBySection.get(group.section)!.map((meta) => ({ ...meta, section: group.section })),
  );

  return (
    <FrontPageFilter sections={result.sections.map((group) => group.section)}>
      <SectionFilterBar
        pills={pills}
        generatedAt={result.generatedAt}
        enrichmentNotice={enrichmentNotice(enrichment.health)}
      />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
        {/*
         * D-16 swaps the single visible "Latest" label for per-section
         * headings below. The document still keeps exactly one <h1> for
         * assistive technology (WCAG document-outline expectations) -- it is
         * visually hidden via `sr-only` rather than removed.
         */}
        <h1 className="sr-only">Latest</h1>

        <TriageToolbar articles={triageArticles} />

        <div className="flex flex-col gap-14">
          {result.sections.map((group, index) => {
            const total = group.articles.length;
            const { visibleCount, hiddenCount } = planSectionCap(total);
            const headingId = `section-heading-${index}`;
            return (
              <SectionVisibility
                key={group.section}
                section={group.section}
                articles={metasBySection.get(group.section)!}
              >
                <section
                  data-section={group.section}
                  data-count={total}
                  aria-labelledby={headingId}
                  className="flex flex-col gap-5"
                >
                  <h2
                    id={headingId}
                    className="flex items-center gap-2.5 border-b border-zinc-200 pb-3 text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl dark:border-zinc-800 dark:text-zinc-50"
                  >
                    <span aria-hidden="true">{SECTION_EMOJI[group.section]}</span> {group.section}
                    <span
                      aria-hidden="true"
                      data-heading-count={total}
                      className="rounded-full bg-zinc-200/70 px-2.5 py-0.5 text-sm font-semibold tabular-nums text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                    >
                      <SectionCount total={total} articles={metasBySection.get(group.section)!} />
                    </span>
                    <span className="sr-only">{articleCountLabel(total)}</span>
                  </h2>
                  <div data-card-stack="" className="flex flex-col gap-6">
                    <div className={CARD_GRID_CLASSES}>
                      {group.articles.slice(0, visibleCount).map((article) => (
                        <ArticleCard key={article.url} article={article} byCve={enrichment.byCve} />
                      ))}
                    </div>
                    {hiddenCount > 0 && (
                      <SectionExpander section={group.section} total={total}>
                        <div className={CARD_GRID_CLASSES}>
                          {group.articles.slice(visibleCount).map((article) => (
                            <ArticleCard key={article.url} article={article} byCve={enrichment.byCve} />
                          ))}
                        </div>
                      </SectionExpander>
                    )}
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
