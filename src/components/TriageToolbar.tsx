"use client";

import clsx from "clsx";
import { useSectionFilter } from "@/components/FrontPageFilter";
import { readerActions, useReaderState } from "@/components/useReaderState";
import {
  CONTROL_FOCUS_CLASSES,
  NEUTRAL_CONTROL_CLASSES,
  PILL_PRESSED_CLASSES,
  PILL_UNPRESSED_CLASSES,
} from "@/lib/filterControlStyles";
import {
  DEFAULT_PREFS,
  isArticleVisible,
  meetsImportance,
  type ArticleMeta,
  type ImportanceFilter,
} from "@/lib/readerState";
import { isSectionVisible } from "@/lib/sectionFilter";
import { TRIAGE_KEYS } from "@/lib/triageKeys";
import type { Section } from "@/lib/types";

/**
 * The reader's triage controls, at the top of `main` (not in the sticky bar:
 * that bar is capped at 96px for `scroll-padding-top`, and these choices are
 * persisted, so they are set once rather than reached for mid-scroll).
 *
 * Minimum importance is a three-way segmented control; Unread and Flagged are
 * independent toggles. Every control is a native button with `aria-pressed`.
 * A live summary says how many cards the combined filters show, and the bulk
 * action marks exactly those cards read. A last line lists the j / k / f / r
 * shortcuts (`TriageKeys.tsx`) with a toggle to turn them off (WCAG 2.2 SC
 * 2.1.4); the setting survives Reset filters.
 *
 * Props are opaque ids, closed enums and counts only (T-01-07).
 */

export type TriageArticle = ArticleMeta & { section: Section };

/** Each level's marker repeats the row placard: filled red, outlined ink, none. */
const LEVELS: { value: ImportanceFilter; label: string; mark: string | null }[] = [
  { value: "all", label: "All", mark: null },
  { value: "high", label: "High+", mark: "ring-2 ring-inset ring-current" },
  { value: "critical", label: "Critical", mark: "bg-red-600 ring-1 ring-white/70" },
];

const CHIP_CLASSES =
  "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xs px-3.5 text-sm font-semibold whitespace-nowrap md:min-h-9";

const TEXT_BUTTON_CLASSES =
  "rounded-xs font-semibold text-stone-800 underline decoration-stone-400 underline-offset-4 hover:decoration-stone-950 dark:text-stone-200 dark:decoration-stone-600 dark:hover:decoration-stone-100";

function chipState(pressed: boolean) {
  return pressed ? PILL_PRESSED_CLASSES : [PILL_UNPRESSED_CLASSES, NEUTRAL_CONTROL_CLASSES];
}

export function TriageToolbar({ articles }: { articles: readonly TriageArticle[] }) {
  const { prefs, read, flags } = useReaderState();
  const { selected } = useSectionFilter();

  const shown = articles.filter(
    (a) => isSectionVisible(selected, a.section) && isArticleVisible(a, prefs, read, flags),
  );
  const shownUnread = shown.filter((a) => !(a.id in read));
  const unreadCount = articles.filter((a) => !(a.id in read)).length;
  const flaggedCount = articles.filter((a) => a.id in flags).length;
  const isDefault =
    prefs.minImportance === DEFAULT_PREFS.minImportance &&
    !prefs.unreadOnly &&
    !prefs.flaggedOnly &&
    selected.size === 0;

  return (
    <div
      data-triage-toolbar=""
      className="flex flex-col gap-3 border-b-2 border-stone-950 pb-4 dark:border-stone-700"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Minimum importance"
          className="inline-flex rounded-xs ring-2 ring-inset ring-stone-950 dark:ring-stone-300"
        >
          {LEVELS.map(({ value, label, mark }) => {
            const pressed = prefs.minImportance === value;
            const count = articles.filter((a) => meetsImportance(a.importance, value)).length;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={pressed}
                onClick={() => readerActions.setPrefs({ minImportance: value })}
                className={clsx(
                  "inline-flex min-h-11 items-center gap-2 px-3.5 font-display text-[0.9375rem] font-bold tracking-wider whitespace-nowrap uppercase transition-colors md:min-h-9",
                  CONTROL_FOCUS_CLASSES,
                  pressed
                    ? "bg-stone-950 text-white dark:bg-stone-100 dark:text-stone-950"
                    : "text-stone-700 hover:bg-stone-200 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-50",
                )}
              >
                {mark ? <span aria-hidden="true" className={clsx("size-2.5 rotate-45", mark)} /> : null}
                {label}
                <span className="font-mono text-xs font-medium tracking-normal">{count}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          aria-pressed={prefs.unreadOnly}
          onClick={() => readerActions.setPrefs({ unreadOnly: !prefs.unreadOnly })}
          className={clsx(CHIP_CLASSES, CONTROL_FOCUS_CLASSES, chipState(prefs.unreadOnly))}
        >
          Unread only
          <span className="font-mono text-xs">{unreadCount}</span>
        </button>

        <button
          type="button"
          aria-pressed={prefs.flaggedOnly}
          onClick={() => readerActions.setPrefs({ flaggedOnly: !prefs.flaggedOnly })}
          className={clsx(CHIP_CLASSES, CONTROL_FOCUS_CLASSES, chipState(prefs.flaggedOnly))}
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="currentColor">
            <path d="M4.5 17.5V3.5h9.25l-2 3.5 2 3.5H4.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
          Flagged
          <span className="font-mono text-xs">{flaggedCount}</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
        <p role="status" className="text-stone-700 dark:text-stone-300">
          Showing <strong className="font-display text-lg font-bold text-stone-950 dark:text-stone-50">{shown.length}</strong> of{" "}
          {articles.length} stories
          {shown.length > 0 ? ` · ${shownUnread.length} unread` : null}
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={shownUnread.length === 0}
            onClick={() => readerActions.markRead(shownUnread.map((a) => a.id))}
            className={clsx(
              TEXT_BUTTON_CLASSES,
              "disabled:cursor-default disabled:text-stone-500 disabled:no-underline dark:disabled:text-stone-500",
              CONTROL_FOCUS_CLASSES,
            )}
          >
            Mark {shownUnread.length > 0 ? `${shownUnread.length} ` : ""}shown as read
          </button>
          {!isDefault ? (
            <button
              type="button"
              onClick={readerActions.resetFilters}
              className={clsx(TEXT_BUTTON_CLASSES, CONTROL_FOCUS_CLASSES)}
            >
              Reset filters
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-stone-700 dark:text-stone-300">
        <span className="font-display font-bold tracking-wider uppercase">Keys</span>
        <ul
          aria-label="Keyboard shortcuts"
          className={clsx("flex flex-wrap items-center gap-x-3 gap-y-1", !prefs.keyShortcuts && "line-through")}
        >
          {TRIAGE_KEYS.map(({ key, label }) => (
            <li key={key} className="flex items-center gap-1.5">
              <kbd className="inline-grid min-w-5 place-items-center rounded-xs px-1 font-mono text-xs leading-5 font-bold text-stone-950 ring-1 ring-stone-500 ring-inset dark:text-stone-50">
                {key}
              </kbd>
              {label}
            </li>
          ))}
        </ul>
        <button
          type="button"
          aria-pressed={prefs.keyShortcuts}
          onClick={() => readerActions.setPrefs({ keyShortcuts: !prefs.keyShortcuts })}
          className={clsx(TEXT_BUTTON_CLASSES, CONTROL_FOCUS_CLASSES)}
        >
          {prefs.keyShortcuts ? "Turn shortcuts off" : "Turn shortcuts on"}
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xs px-4 py-6 text-center text-stone-700 outline-1 -outline-offset-1 outline-dashed outline-stone-400 dark:text-stone-300 dark:outline-stone-600">
          {prefs.flaggedOnly && flaggedCount === 0
            ? "Nothing flagged yet. Use the flag on any story to keep it here."
            : "No stories match these filters."}
        </p>
      ) : null}
    </div>
  );
}
