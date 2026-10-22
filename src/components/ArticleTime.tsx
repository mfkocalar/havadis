"use client";

import { useMinuteClock } from "@/components/useMinuteClock";
import { formatRelativeTime } from "@/lib/formatRelativeTime";
import { formatUtcShortDateTime } from "@/lib/formatUtcTime";

/**
 * A card's publication time.
 *
 * Server HTML and the hydration pass render the deterministic absolute form
 * (`Oct 22, 09:05 UTC`), which stays true however old the cached page is
 * (Phase 4 review WR-04). After hydration it switches to the reader's own
 * relative age ("3h ago"), measured against the live clock the bar's
 * "Updated" text also uses, so the two can never contradict each other. The
 * tooltip carries the full date and time in the reader's time zone.
 *
 * The only prop is the normalised ISO string, never free feed text (T-01-07).
 */
export function ArticleTime({ iso }: { iso: string }) {
  const nowMs = useMinuteClock();
  const absolute = formatUtcShortDateTime(iso);
  const valid = absolute !== "unknown time";

  const text = nowMs === null || !valid ? absolute : formatRelativeTime(iso, nowMs);
  const title = nowMs === null || !valid ? absolute : new Date(iso).toLocaleString();

  return (
    <time dateTime={iso} title={title} className="whitespace-nowrap tabular-nums">
      {text}
    </time>
  );
}
