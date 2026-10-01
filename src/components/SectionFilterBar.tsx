"use client";

import { useRef } from "react";
import { flushSync } from "react-dom";
import clsx from "clsx";
import { useSectionFilter } from "@/components/FrontPageFilter";
import { LastUpdated } from "@/components/LastUpdated";
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
} from "@/lib/filterControlStyles";

/**
 * The sticky filter bar directly under the masthead (D-08, D-11, D-14).
 *
 * One toggle pill per non-empty section, in the order the server passes them
 * (urgency order, D-12). Each pill is a native `button` with `aria-pressed`
 * (Accessibility Contract). The accessible name is the section name plus one
 * visually hidden ", N articles" suffix; the visible emoji and count are
 * `aria-hidden` so the name is not read twice (Pitfall 8). A visually hidden
 * `role="status"` region announces the result after each toggle.
 *
 * The snapshot's `Updated` text sits after the pill group (D-12): on its own
 * row below 768px, at the trailing edge and centred on the first pill row from
 * 768px up.
 *
 * Props are limited to section names, emoji, counts and the server-generated
 * snapshot timestamp: feed text and article data never reach this client
 * component (T-01-07, T-04-02).
 */
export function SectionFilterBar({
  pills,
  generatedAt,
}: {
  pills: readonly FilterPill[];
  generatedAt: string;
}) {
  const { selected, toggle } = useSectionFilter();
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
      className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col px-4 py-2 sm:px-6 md:flex-row md:items-start md:justify-between md:gap-4">
        <div
          role="group"
          aria-label="Filter by section"
          className="-mx-4 flex flex-nowrap gap-2 overflow-x-auto px-4 py-1 max-md:scrollbar-none sm:-mx-6 sm:px-6 md:mx-0 md:flex-1 md:flex-wrap md:overflow-visible md:px-0"
        >
          {pills.map(({ section, emoji, count }) => {
            const pressed = selected.has(section);
            return (
              <button
                key={section}
                type="button"
                aria-pressed={pressed}
                data-filter-pill={section}
                data-count={count}
                onClick={() => handleToggle(section)}
                className={clsx(
                  PILL_BASE_CLASSES,
                  CONTROL_FOCUS_CLASSES,
                  pressed
                    ? PILL_PRESSED_CLASSES
                    : [PILL_UNPRESSED_CLASSES, NEUTRAL_CONTROL_CLASSES],
                )}
              >
                <span aria-hidden="true">{emoji}</span>
                <span>{section}</span>
                <span
                  aria-hidden="true"
                  className={clsx(
                    "tabular-nums",
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
        <div className="flex shrink-0 items-center pb-1 md:mt-1 md:min-h-8 md:pb-0">
          <LastUpdated generatedAt={generatedAt} />
        </div>
        <p role="status" className="sr-only">
          {filterStatusMessage(selected.size, pills.length)}
        </p>
      </div>
    </div>
  );
}
