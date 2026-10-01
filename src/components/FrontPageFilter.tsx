"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { isSectionVisible, toggleSection } from "@/lib/sectionFilter";
import type { Section } from "@/lib/types";

/**
 * Client-side section filter state (D-09, D-10; 04-RESEARCH.md Pattern 2).
 *
 * `FrontPageFilter` is a context provider that renders NO DOM of its own
 * (Pitfall 1: the body is a `flex flex-col` column and `main` relies on
 * `flex-1`, so a wrapping element would break the layout). The server page
 * passes the sticky bar and every server-rendered section as `children`; per
 * the bundled Next.js 16 "Server and Client Components" guide, Server
 * Components passed as children are rendered on the server and handed over
 * as rendered output, so their markup stays in the initial HTML and nothing
 * here imports article data.
 *
 * `SectionVisibility` sets the `hidden` attribute on a bare div around a
 * section. It never unmounts (D-07 principle): Tailwind's preflight
 * `[hidden]` rule wins over any display utility, so the attribute alone
 * hides it, and all cards remain in the server HTML.
 *
 * State is in memory only (D-10): nothing is written to the URL, storage or
 * a cookie, so the route stays a shared static snapshot.
 */

type SectionFilterContextValue = {
  selected: ReadonlySet<Section>;
  toggle: (section: Section) => void;
};

// Default degrades to "all visible" for a consumer outside the provider.
const SectionFilterContext = createContext<SectionFilterContextValue>({
  selected: new Set<Section>(),
  toggle: () => {},
});

export function FrontPageFilter({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<Section>>(
    () => new Set<Section>(),
  );

  const toggle = useCallback((section: Section) => {
    setSelected((current) => toggleSection(current, section));
  }, []);

  const value = useMemo(() => ({ selected, toggle }), [selected, toggle]);

  return (
    <SectionFilterContext.Provider value={value}>
      {children}
    </SectionFilterContext.Provider>
  );
}

export function useSectionFilter(): SectionFilterContextValue {
  return useContext(SectionFilterContext);
}

export function SectionVisibility({
  section,
  children,
}: {
  section: Section;
  children: ReactNode;
}) {
  const { selected } = useSectionFilter();
  return <div hidden={!isSectionVisible(selected, section)}>{children}</div>;
}
