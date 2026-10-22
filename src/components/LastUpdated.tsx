"use client";

import clsx from "clsx";
import { useMinuteClock } from "@/components/useMinuteClock";
import { formatRelativeTime } from "@/lib/formatRelativeTime";
import { formatUtcDateTime, formatUtcTime } from "@/lib/formatUtcTime";
import { MUTED_CONTROL_TEXT_CLASSES } from "@/lib/filterControlStyles";

/**
 * The snapshot freshness text at the sticky bar's trailing edge (D-12, D-13).
 *
 * Server HTML and the hydration pass render the deterministic
 * `Updated HH:MM UTC` form, computed from `generatedAt` with no clock and no
 * locale, so a cached page is never misleading and hydration never
 * mismatches. After hydration the text switches to the card vocabulary
 * ("Updated just now", "Updated 4m ago", "Updated 72h ago") and re-evaluates
 * every 60 seconds, so a tab left open keeps ticking.
 *
 * The clock is the page-wide `useMinuteClock` store (shared with every card's
 * `ArticleTime`); its hydration contract keeps the first client render equal
 * to the server HTML.
 *
 * The age is the page snapshot's age. The fetch Data Cache may hold feed
 * bytes up to one 900 s window older than `generatedAt` (04-RESEARCH.md
 * Assumption A2). The 60 s tick means the label can lag by up to a minute.
 * An idle cached page reports its true age ("72h ago"), never a misleading
 * "just now" (Pitfall 4).
 *
 * The only prop is a server-generated ISO string, never feed text (T-01-07).
 */

export function LastUpdated({ generatedAt }: { generatedAt: string }) {
  const nowMs = useMinuteClock();

  const text =
    nowMs === null
      ? `Updated ${formatUtcTime(generatedAt)}`
      : `Updated ${formatRelativeTime(generatedAt, nowMs)}`;
  const title =
    nowMs === null ? formatUtcDateTime(generatedAt) : new Date(generatedAt).toLocaleString();

  return (
    <time
      data-last-updated=""
      dateTime={generatedAt}
      title={title}
      className={clsx("text-sm font-medium whitespace-nowrap", MUTED_CONTROL_TEXT_CLASSES)}
    >
      {text}
    </time>
  );
}
