/**
 * Formats an ISO 8601 timestamp as a relative-time label for the front
 * page's 24-hour lookback window, which collapses relative time to
 * exactly three cases: "just now" (under a minute), "Nm ago" (under an
 * hour), and "Nh ago" (up to 23h ago). No date-formatting library is used
 * — see STACK.md's "What NOT to Use" and RESEARCH.md's "Don't Hand-Roll"
 * table; a ~15-line pure function covers this completely.
 *
 * A source's own clock can run slightly ahead of the server's, so a
 * negative difference (a timestamp that appears to be in the future) is
 * clamped to "just now" rather than surfacing a value like "-3m ago".
 */
export function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  if (diffMs <= 0) return "just now";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
