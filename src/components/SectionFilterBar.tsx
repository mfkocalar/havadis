"use client";

import { useRef } from "react";
import { flushSync } from "react-dom";
import clsx from "clsx";
import { useSectionFilter } from "@/components/FrontPageFilter";
import { LastUpdated } from "@/components/LastUpdated";
import { SectionMark } from "@/components/SectionMark";
import { useReaderState } from "@/components/useReaderState";
import { countVisible, hasArticleFilters } from "@/lib/readerState";
import {
  articleCountLabel,
  filterStatusMessage,
  type FilterPill,
} from "@/lib/sectionFilter";
import {
  CONTROL_FOCUS_CLASSES,
  MUTED_CONTROL_TEXT_CLASSES,
  NEUTRAL_CONTROL_CLASSES,
  PILL_BASE_CLASSES,
  PILL_PRESSED_CLASSES,
  PILL_UNPRESSED_CLASSES,
  PRESSED_COUNT_TEXT_CLASSES,
  ZERO_COUNT_CONTROL_CLASSES,
} from "@/lib/filterControlStyles";

/**
 * The sticky section filter (D-08, D-11, D-14): a strip under the masthead
 * below 1024px, a full-height side rail from 1024px up.
 *
 * One toggle per non-empty section, in the order the server passes them
 * (urgency order, D-12), each led by its numbered hazard-class diamond. Each pill is a native `button` with `aria-pressed`
 * (Accessibility Contract). The accessible name is the section name plus one
 * visually hidden ", N articles" suffix; the visible class diamond and count are
 * `aria-hidden` so the name is not read twice (Pitfall 8). The class diamond
 * is decorative. A visually hidden
 * `role="status"` region announces the result after each toggle.
 *
 * The snapshot's `Updated` text follows the pill group in DOM order (D-12):
 * on its own row under the strip below 1024px, at the top of the rail from
 * 1024px up.
 *
 * Props are limited to section names, counts, the server-generated
 * snapshot timestamp and one server-built notice string from a fixed
 * vocabulary (or null): feed text, article data and enrichment objects never
 * reach this client component (T-01-07, T-04-02, T-07-23). The notice is not
 * announced through the `role="status"` region, which is for filter changes.
 */
export function SectionFilterBar({
  pills,
  generatedAt,
  storyCount,
  sourceCount,
  enrichmentNotice,
}: {
  pills: readonly FilterPill[];
  generatedAt: string;
  storyCount: number;
  sourceCount: number;
  enrichmentNotice: string | null;
}) {
  const { selected, toggle } = useSectionFilter();
  const { prefs, read, flags } = useReaderState();
  const filtering = hasArticleFilters(prefs);
  const barRef = useRef<HTMLDivElement>(null);

  function handleToggle(section: FilterPill["section"]) {
    // Commit the visibility change synchronously so the first visible section
    // is already un-hidden when we measure and scroll (Pitfall 11).
    flushSync(() => toggle(section));

    // Only scroll when the bar is stuck to the top edge; instant, no smooth
    // behaviour. Relies on `scroll-padding-top` in globals.css to land the
    // section heading just below the sticky bar.
    const bar = barRef.current;
    if (bar && bar.getBoundingClientRect().top <= 0) {
      document
        .querySelector("div:not([hidden]) > section[data-section]")
        ?.scrollIntoView({ block: "start" });
    }
  }

  return (
    <div
      ref={barRef}
      data-filter-bar=""
      className="sticky top-0 z-10 border-b-2 border-stone-950 bg-background/95 backdrop-blur-sm lg:h-dvh lg:self-start lg:overflow-y-auto lg:border-r-2 lg:border-b-0 lg:bg-background dark:border-stone-700"
    >
      <div className="flex flex-col px-4 py-2 sm:px-6 lg:gap-5 lg:px-4 lg:py-6">
        {/*
         * The pills scroll in one row below `lg` and stack into the rail from
         * `lg`, so the strip stays one row (well under the 96px
         * `scroll-padding-top`) wherever it sits across the top.
         *
         * `relative` makes this scroller the containing block of the pills'
         * `sr-only` (position: absolute) spans. Without it their containing
         * block is the sticky bar, outside this scroller's clip, so they sit
         * far to the right and widen the page: mobile browsers then widen the
         * layout viewport (sideways scroll or zoom-out, found by 04-03
         * viewport verification, RESEARCH Pitfall 6).
         */}
        <div
          role="group"
          aria-label="Filter by section"
          className="relative -mx-4 flex flex-nowrap gap-2 overflow-x-auto px-4 py-1 max-lg:scrollbar-none sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0"
        >
          <p aria-hidden="true" className="hidden px-2 pb-2 font-display text-xs font-bold tracking-[0.16em] text-stone-600 uppercase lg:block dark:text-stone-400">
            Sections
          </p>
          {pills.map(({ section, count: total, articles }) => {
            const pressed = selected.has(section);
            const count = filtering ? countVisible(articles, prefs, read, flags) : total;
            return (
              <button
                key={section}
                type="button"
                aria-pressed={pressed}
                data-filter-pill={section}
                data-count={total}
                onClick={() => handleToggle(section)}
                className={clsx(
                  PILL_BASE_CLASSES,
                  CONTROL_FOCUS_CLASSES,
                  "pl-1.5 lg:min-h-10 lg:w-full lg:text-[0.9375rem] lg:ring-0",
                  pressed
                    ? PILL_PRESSED_CLASSES
                    : [
                        PILL_UNPRESSED_CLASSES,
                        count === 0 ? ZERO_COUNT_CONTROL_CLASSES : NEUTRAL_CONTROL_CLASSES,
                      ],
                )}
              >
                <SectionMark section={section} />
                <span>{section}</span>
                <span
                  aria-hidden="true"
                  className={clsx(
                    "font-mono text-xs tabular-nums lg:ml-auto",
                    pressed
                      ? PRESSED_COUNT_TEXT_CLASSES
                      : MUTED_CONTROL_TEXT_CLASSES,
                  )}
                >
                  {count}
                </span>
                <span className="sr-only">{articleCountLabel(count)}</span>
              </button>
            );
          })}
        </div>
        <div className="flex min-w-0 items-center gap-x-2 pb-1 lg:order-first lg:flex-col lg:items-start lg:gap-1.5 lg:border-b-2 lg:border-stone-950 lg:px-2 lg:pb-5 dark:lg:border-stone-700">
          <LastUpdated generatedAt={generatedAt} />
          <span className={clsx("font-mono text-xs whitespace-nowrap", MUTED_CONTROL_TEXT_CLASSES)}>
            <span aria-hidden="true" className="lg:hidden">· </span>
            {storyCount} stories · {sourceCount} sources
          </span>
          {enrichmentNotice !== null && (
            <>
              <span aria-hidden="true" className="lg:hidden">
                ·
              </span>
              <span
                data-enrichment-notice=""
                title={enrichmentNotice}
                className="min-w-0 truncate rounded-xs bg-yellow-300 px-1.5 font-mono text-xs leading-5 text-stone-950 lg:whitespace-normal"
              >
                {enrichmentNotice}
              </span>
            </>
          )}
        </div>
        <p role="status" className="sr-only">
          {filterStatusMessage(selected.size, pills.length)}
        </p>
      </div>
    </div>
  );
}
