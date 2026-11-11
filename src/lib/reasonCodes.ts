/**
 * The one fixed reason vocabulary shared by egress, fetch, storage and logs (D-14).
 * Only these codes are ever stored in `source_fetches.reason_code` or written to a log line,
 * so raw upstream text never reaches either. Phase 17 reuses the list.
 */
export const EGRESS_CODES = [
  "egress_denied_scheme",
  "egress_denied_private",
  "egress_denied_redirect",
  "egress_denied_credentials",
] as const;

export type EgressCode = (typeof EGRESS_CODES)[number];

export const FETCH_ERROR_CODES = [
  ...EGRESS_CODES,
  "timeout",
  "http_error",
  "content_type",
  "body_too_large",
  "parse_error",
  "network_error",
  "redirect_error",
] as const;

export type FetchErrorCode = (typeof FETCH_ERROR_CODES)[number];

export function isFetchErrorCode(v: unknown): v is FetchErrorCode {
  return typeof v === "string" && (FETCH_ERROR_CODES as readonly string[]).includes(v);
}
