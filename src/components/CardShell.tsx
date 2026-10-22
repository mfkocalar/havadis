"use client";

import type { ReactNode } from "react";
import clsx from "clsx";
import { useReaderState } from "@/components/useReaderState";
import { isArticleVisible } from "@/lib/readerState";
import type { Importance } from "@/lib/types";

/**
 * The reader-state wrapper around one server-rendered card: hidden when the
 * reader's filters exclude it, dimmed once read, outlined once flagged.
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
        "h-full rounded-2xl transition-opacity duration-150",
        isRead && "opacity-55 hover:opacity-100 has-[:focus-visible]:opacity-100",
        isFlagged && "ring-2 ring-amber-400 dark:ring-amber-500/70",
      )}
    >
      {children}
    </div>
  );
}
