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
import type { Section } from "@/lib/types";

/**
 * The reader's triage controls, at the top of `main` (not in the sticky bar:
 * that bar is capped at 96px for `scroll-padding-top`, and these choices are
 * persisted, so they are set once rather than reached for mid-scroll).
 *
 * Minimum importance is a three-way segmented control; Unread and Flagged are
 * independent toggles. Every control is a native button with `aria-pressed`.
 * A live summary says how many cards the combined filters show, and the bulk
 * action marks exactly those cards read.
 *
 * Props are opaque ids, closed enums and counts only (T-01-07).
 */

export type TriageArticle = ArticleMeta & { section: Section };

const LEVELS: { value: ImportanceFilter; label: string; dot: string | null }[] = [
  { value: "all", label: "All", dot: null },
  { value: "high", label: "High+", dot: "bg-amber-500" },
  { value: "critical", label: "Critical", dot: "bg-red-600" },
];

const CHIP_CLASSES =
  "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm font-medium whitespace-nowrap md:min-h-9";

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
      className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-3 sm:p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Minimum importance"
          className="inline-flex rounded-full bg-zinc-100 p-1 dark:bg-zinc-800"
        >
          {LEVELS.map(({ value, label, dot }) => {
            const pressed = prefs.minImportance === value;
            const count = articles.filter((a) => meetsImportance(a.importance, value)).length;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={pressed}
                onClick={() => readerActions.setPrefs({ minImportance: value })}
                className={clsx(
                  "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium whitespace-nowrap transition-colors md:min-h-7",
                  CONTROL_FOCUS_CLASSES,
                  pressed
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
                )}
              >
                {dot ? <span aria-hidden="true" className={clsx("size-2 rounded-full", dot)} /> : null}
                {label}
                <span className="tabular-nums text-zinc-500 dark:text-zinc-400">{count}</span>
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
          <span className="tabular-nums opacity-70">{unreadCount}</span>
        </button>

        <button
          type="button"
          aria-pressed={prefs.flaggedOnly}
          onClick={() => readerActions.setPrefs({ flaggedOnly: !prefs.flaggedOnly })}
          className={clsx(CHIP_CLASSES, CONTROL_FOCUS_CLASSES, chipState(prefs.flaggedOnly))}
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 text-amber-500" fill="currentColor">
            <path d="M4.5 17.5V3.5h9.25l-2 3.5 2 3.5H4.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
          Flagged
          <span className="tabular-nums opacity-70">{flaggedCount}</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
        <p role="status" className="text-zinc-600 dark:text-zinc-400">
          Showing <strong className="font-semibold text-zinc-900 dark:text-zinc-100">{shown.length}</strong> of{" "}
          {articles.length} stories
          {shown.length > 0 ? ` · ${shownUnread.length} unread` : null}
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={shownUnread.length === 0}
            onClick={() => readerActions.markRead(shownUnread.map((a) => a.id))}
            className={clsx(
              "rounded font-medium text-zinc-700 underline-offset-4 hover:underline disabled:cursor-default disabled:text-zinc-400 disabled:no-underline dark:text-zinc-300 dark:disabled:text-zinc-600",
              CONTROL_FOCUS_CLASSES,
            )}
          >
            Mark {shownUnread.length > 0 ? `${shownUnread.length} ` : ""}shown as read
          </button>
          {!isDefault ? (
            <button
              type="button"
              onClick={readerActions.resetFilters}
              className={clsx(
                "rounded font-medium text-zinc-700 underline-offset-4 hover:underline dark:text-zinc-300",
                CONTROL_FOCUS_CLASSES,
              )}
            >
              Reset filters
            </button>
          ) : null}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl bg-zinc-50 px-4 py-6 text-center text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
          {prefs.flaggedOnly && flaggedCount === 0
            ? "Nothing flagged yet. Use the flag on any story to keep it here."
            : "No stories match these filters."}
        </p>
      ) : null}
    </div>
  );
}
