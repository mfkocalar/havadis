"use client";

import clsx from "clsx";
import { formatUtcDateTime, formatUtcTime } from "@/lib/formatUtcTime";
import { MUTED_CONTROL_TEXT_CLASSES } from "@/lib/filterControlStyles";

/**
 * The snapshot freshness text at the sticky bar's trailing edge (D-12, D-13).
 *
 * This task renders the deterministic `Updated HH:MM UTC` form only: it is
 * computed from `generatedAt` with no clock and no locale, so cached HTML is
 * never misleading. The only prop is a server-generated ISO string, never
 * feed text (T-01-07).
 */
export function LastUpdated({ generatedAt }: { generatedAt: string }) {
  return (
    <time
      data-last-updated=""
      dateTime={generatedAt}
      title={formatUtcDateTime(generatedAt)}
      className={clsx("text-sm font-medium whitespace-nowrap", MUTED_CONTROL_TEXT_CLASSES)}
    >
      {`Updated ${formatUtcTime(generatedAt)}`}
    </time>
  );
}
