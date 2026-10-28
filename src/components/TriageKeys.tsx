"use client";

import { useEffect } from "react";
import { useReaderState } from "@/components/useReaderState";
import { stepIndex, triageActionForKey, type TriageKeyAction } from "@/lib/triageKeys";

/**
 * Keyboard triage for the front page: j / k move focus to the next or
 * previous visible story's headline link, f and r press that story's own Flag
 * and Read buttons (so a shortcut does exactly what a click does, through the
 * same reader store). Renders no DOM.
 *
 * "Visible" means rendered: rows hidden by a filter, a collapsed section or
 * the six-row cap are skipped, because they have no client rects. When r
 * hides the focused row (Unread only is on), focus moves on to the next
 * visible story so the pass can continue.
 *
 * The listener is off while the reader has turned shortcuts off
 * (`prefs.keyShortcuts`, WCAG 2.2 SC 2.1.4), and never fires in text fields
 * or with a modifier held. It takes no props and reads only the DOM the
 * server already rendered, so the route stays static (T-01-07).
 */

const ROW_SELECTOR = "main article";

function visibleRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(ROW_SELECTOR)].filter(
    (row) => row.getClientRects().length > 0,
  );
}

function focusRow(row: HTMLElement | undefined) {
  const link = row?.querySelector<HTMLElement>("h3 a");
  if (!link) return;
  link.focus({ preventScroll: true });
  // `scroll-padding-top` (globals.css) keeps the row clear of the sticky strip.
  link.scrollIntoView({ block: "nearest" });
}

function handle(action: TriageKeyAction) {
  const rows = visibleRows();
  const active = document.activeElement;
  const current = active ? rows.findIndex((row) => row.contains(active)) : -1;

  if (action === "next" || action === "prev") {
    const index = stepIndex(current, rows.length, action);
    if (index >= 0) focusRow(rows[index]);
    return;
  }

  // f and r act on the focused story only; with none focused they do nothing.
  if (current < 0) return;
  const row = rows[current];
  row.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)?.click();

  // A filter may hide the row the reader just marked; keep the pass going.
  requestAnimationFrame(() => {
    if (row.getClientRects().length > 0) return;
    const after = visibleRows();
    focusRow(after.find((r) => r.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_PRECEDING) ?? after.at(-1));
  });
}

export function TriageKeys() {
  const enabled = useReaderState().prefs.keyShortcuts;

  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      const action = triageActionForKey(event, event.target as HTMLElement | null);
      if (action === null) return;
      event.preventDefault();
      handle(action);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);

  return null;
}
