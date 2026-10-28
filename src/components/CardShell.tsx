"use client";

import type { ReactNode } from "react";
import clsx from "clsx";
import { useReaderState } from "@/components/useReaderState";
import { READ_ROW_CLASSES } from "@/lib/filterControlStyles";
import { isArticleVisible } from "@/lib/readerState";
import type { Importance } from "@/lib/types";

/**
 * The reader-state wrapper around one server-rendered row: hidden when the
 * reader's filters exclude it, greyed to muted ink once read, tinted hazard yellow once
 * flagged (the flag button itself also fills, so colour is never the only cue).
 *
 * Like `SectionVisibility`, it only toggles the `hidden` attribute, so every
 * card stays in the prerendered HTML. Props are the opaque id and a closed
 * enum; the card itself arrives as server-rendered children (T-01-07).
 */
export function CardShell({
  id,
  importance,
  children,
}: {
  id: string;
  importance: Importance;
  children: ReactNode;
}) {
  const { prefs, read, flags } = useReaderState();
  const isRead = id in read;
  const isFlagged = id in flags;

  return (
    <div
      hidden={!isArticleVisible({ id, importance }, prefs, read, flags)}
      data-read={isRead ? "" : undefined}
      data-flagged={isFlagged ? "" : undefined}
      className={clsx(
        "transition-[filter,background-color] duration-150 ease-out",
        isRead && READ_ROW_CLASSES,
        isFlagged && "bg-yellow-200/50 dark:bg-yellow-300/10",
      )}
    >
      {children}
    </div>
  );
}
