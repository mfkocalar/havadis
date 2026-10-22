"use client";

import clsx from "clsx";
import { readerActions, useReaderState } from "@/components/useReaderState";
import { CONTROL_FOCUS_CLASSES } from "@/lib/filterControlStyles";

/**
 * A card's Flag and Read toggles. Both are native buttons with `aria-pressed`;
 * the shared visible label is completed by `aria-describedby` pointing at the
 * card's own headline, so each button announces which story it acts on
 * without the feed title ever being passed into this client component.
 */

const BUTTON_CLASSES =
  "inline-flex size-11 items-center md:size-9 justify-center rounded-full ring-1 ring-inset transition-colors";

export function ArticleActions({ id, titleId }: { id: string; titleId: string }) {
  const { read, flags } = useReaderState();
  const isRead = id in read;
  const isFlagged = id in flags;

  return (
    <div className="ml-auto flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        aria-pressed={isFlagged}
        aria-describedby={titleId}
        title={isFlagged ? "Remove flag" : "Flag for follow-up"}
        onClick={() => readerActions.toggleFlag(id)}
        className={clsx(
          BUTTON_CLASSES,
          CONTROL_FOCUS_CLASSES,
          isFlagged
            ? "bg-amber-400 text-amber-950 ring-amber-400 hover:bg-amber-300"
            : "text-zinc-500 ring-zinc-300 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
        )}
      >
        <span className="sr-only">Flag</span>
        <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill={isFlagged ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
          <path d="M4.5 17.5V3.5m0 0h9.25l-2 3.5 2 3.5H4.5" />
        </svg>
      </button>
      <button
        type="button"
        aria-pressed={isRead}
        aria-describedby={titleId}
        title={isRead ? "Mark as unread" : "Mark as read"}
        onClick={() => readerActions.toggleRead(id)}
        className={clsx(
          BUTTON_CLASSES,
          CONTROL_FOCUS_CLASSES,
          isRead
            ? "bg-emerald-600 text-white ring-emerald-600 hover:bg-emerald-500"
            : "text-zinc-500 ring-zinc-300 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
        )}
      >
        <span className="sr-only">Read</span>
        <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.5 10.5l3.5 3.5 7.5-8" />
        </svg>
      </button>
    </div>
  );
}
