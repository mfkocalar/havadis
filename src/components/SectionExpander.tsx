"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import clsx from "clsx";
import {
  CONTROL_FOCUS_CLASSES,
  NEUTRAL_CONTROL_CLASSES,
} from "@/lib/filterControlStyles";
import type { Section } from "@/lib/types";

/**
 * A section's overflow region plus its "Show all N" / "Show fewer" button
 * (D-05, D-06, D-07).
 *
 * The overflow cards are server-rendered by the page and arrive as
 * `children`, so every card is in the initial HTML. Collapsed cards are
 * toggled only by the plain `hidden` attribute: never conditionally rendered,
 * never fetched later.
 *
 * Browser find-in-page therefore does not search collapsed cards until the
 * section is expanded. That is an accepted v1 limitation (04-RESEARCH.md Open
 * Question 1); React 19.2 cannot emit the find-in-page hidden value anyway.
 *
 * The region stays mounted when its section is filtered out (the parent
 * `SectionVisibility` only hides it), so `open` survives pill toggles, and
 * filtering down to one section never auto-expands it.
 *
 * The button follows the region in DOM and tab order on purpose (Pitfall 13).
 * Collapsing commits synchronously and then scrolls the button into view so
 * the page never jumps away from the section (Pitfall 11). No animation and
 * no smooth scrolling (UI-SPEC Expander).
 *
 * Props are a closed section name, a count and server-rendered children; no
 * feed text is serialised into this client component (T-01-07).
 */
export function SectionExpander({
  section,
  total,
  children,
}: {
  section: Section;
  total: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  function handleClick() {
    const next = !open;
    flushSync(() => setOpen(next));
    if (!next) {
      buttonRef.current?.scrollIntoView({ block: "nearest" });
    }
  }

  return (
    <>
      <div id={regionId} hidden={!open} data-overflow={section}>
        {children}
      </div>
      <button
        ref={buttonRef}
        type="button"
        data-expander={section}
        aria-expanded={open}
        aria-controls={regionId}
        onClick={handleClick}
        className={clsx(
          "inline-flex min-h-11 w-full items-center justify-center rounded-full px-4 text-sm font-medium md:w-auto md:self-center",
          NEUTRAL_CONTROL_CLASSES,
          CONTROL_FOCUS_CLASSES,
        )}
      >
        {open ? "Show fewer" : `Show all ${total}`}
      </button>
    </>
  );
}
