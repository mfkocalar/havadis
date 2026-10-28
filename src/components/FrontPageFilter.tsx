"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { readerActions, useReaderState } from "@/components/useReaderState";
import { countVisible, hasArticleFilters, type ArticleMeta } from "@/lib/readerState";
import { isSectionVisible, toggleSection } from "@/lib/sectionFilter";
import type { Section } from "@/lib/types";

/**
 * Client-side front-page filtering (D-09, 04-RESEARCH.md Pattern 2).
 *
 * The filter state lives in the persisted reader store (`useReaderState`), so
 * section pills, importance, unread-only and flagged-only choices survive a
 * reload. This supersedes D-10's in-memory-only rule at the reader's request;
 * the route is still a shared static snapshot, because nothing is written to
 * the URL or a cookie and the server never sees the state.
 *
 * `FrontPageFilter` renders NO DOM of its own (Pitfall 1: the body is a
 * `flex flex-col` column and `main` relies on `flex-1`, so a wrapping element
 * would break the layout). It only provides the list of sections on today's
 * page (closed enum values, T-01-07).
 *
 * `SectionVisibility` sets the `hidden` attribute on a bare div around a
 * section. It never unmounts (D-07 principle): all cards stay in the server
 * HTML. A section is also hidden when the article filters leave none of its
 * cards visible, so filtering never shows an empty heading.
 */

const PresentSectionsContext = createContext<readonly Section[]>([]);

export function FrontPageFilter({
  sections,
  children,
}: {
  sections: readonly Section[];
  children: ReactNode;
}) {
  return (
    <PresentSectionsContext.Provider value={sections}>{children}</PresentSectionsContext.Provider>
  );
}

/**
 * The stored selection is intersected with the sections on today's page: a
 * saved pick of a section that is empty today must not hide everything else.
 */
export function useSectionFilter(): {
  selected: ReadonlySet<Section>;
  toggle: (section: Section) => void;
} {
  const { prefs } = useReaderState();
  const present = useContext(PresentSectionsContext);
  const selected = useMemo(
    () => new Set(prefs.sections.filter((s) => present.includes(s))),
    [prefs.sections, present],
  );
  const toggle = useCallback(
    (section: Section) => readerActions.setPrefs({ sections: [...toggleSection(selected, section)] }),
    [selected],
  );
  return { selected, toggle };
}

export function SectionVisibility({
  section,
  articles,
  children,
}: {
  section: Section;
  articles: readonly ArticleMeta[];
  children: ReactNode;
}) {
  const { prefs, read, flags } = useReaderState();
  const { selected } = useSectionFilter();
  const filtering = hasArticleFilters(prefs);
  const empty = filtering && countVisible(articles, prefs, read, flags) === 0;
  return <div hidden={!isSectionVisible(selected, section) || empty}>{children}</div>;
}

/** A section heading's count: the total, or how many the article filters leave. */
export function SectionCount({ total, articles }: { total: number; articles: readonly ArticleMeta[] }) {
  const { prefs, read, flags } = useReaderState();
  return hasArticleFilters(prefs) ? (
    <>
      {countVisible(articles, prefs, read, flags)}
      <span className="text-stone-600 dark:text-stone-400"> of {total}</span>
    </>
  ) : (
    <>{total}</>
  );
}
