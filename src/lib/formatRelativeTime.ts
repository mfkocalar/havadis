/**
 * Formats an ISO 8601 timestamp as a relative-time label for the front
 * page's 24-hour lookback window, which collapses relative time to
 * exactly three cases: "just now" (under a minute), "Nm ago" (under an
 * hour), and "Nh ago" (23h and beyond, unbounded). No date-formatting library
 * is used — see STACK.md's "What NOT to Use" and RESEARCH.md's "Don't
 * Hand-Roll" table; a ~15-line pure function covers this completely.
 *
 * `now` is optional. Without it the function reads the current time itself
 * (the one-argument form ArticleCard uses). With it, nothing reads the clock
 * and the result is deterministic: the "Updated" text passes its external
 * store's minute snapshot here (Phase 4 D-13). An "Nh ago" above 23 is the
 * intended honest output for a long-idle cached page (e.g. "72h ago"), not a
 * bug to clamp.
 *
 * A source's own clock can run slightly ahead of the server's, so a
 * negative difference (a timestamp that appears to be in the future) is
 * clamped to "just now" rather than surfacing a value like "-3m ago".
 */
export function formatRelativeTime(isoDate: string, now: number = Date.now()): string {
  const diffMs = now - new Date(isoDate).getTime();
  if (diffMs <= 0) return "just now";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
