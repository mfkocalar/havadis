/**
 * Deterministic, locale-free UTC formatters for the front page's "Updated"
 * text (Phase 4 D-13). The server render and the hydration pass must produce
 * identical text, so nothing here uses a locale, a time zone database or the
 * clock: the output is a slice of the canonical ISO string. No date-formatting
 * library is used (STACK.md "What NOT to Use").
 *
 * Both functions never throw. An unparseable input yields "unknown time".
 */

/** `HH:MM UTC` for an ISO 8601 timestamp (offset inputs are normalised to UTC). */
export function formatUtcTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "unknown time";
  return `${date.toISOString().slice(11, 16)} UTC`;
}

/** `YYYY-MM-DD HH:MM UTC` for an ISO 8601 timestamp. */
export function formatUtcDateTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "unknown time";
  const canonical = date.toISOString();
  return `${canonical.slice(0, 10)} ${canonical.slice(11, 16)} UTC`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * `Mon D, HH:MM UTC` (e.g. `Oct 22, 09:05 UTC`) for an ISO 8601 timestamp: the
 * readable card form. Same determinism as above: English month abbreviations
 * from a fixed table, never `toLocaleString`, so server and hydration agree.
 */
export function formatUtcShortDateTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "unknown time";
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.toISOString().slice(11, 16)} UTC`;
}
