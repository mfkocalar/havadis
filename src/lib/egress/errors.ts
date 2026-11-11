import type { EgressCode } from "../reasonCodes.ts";

/**
 * Raised when the egress policy refuses a URL, a redirect hop or a resolved address.
 * The message is the code and nothing else: no IP, no URL, no body (D-14).
 */
export class EgressDenied extends Error {
  readonly code: EgressCode;

  constructor(code: EgressCode) {
    super(code);
    this.name = "EgressDenied";
    this.code = code;
  }
}

/** A redirect without a Location header, or more hops than the configured maximum. */
export class RedirectError extends Error {
  readonly code = "redirect_error";

  constructor() {
    super("redirect_error");
    this.name = "RedirectError";
  }
}

export function isEgressDenied(e: unknown): e is EgressDenied {
  return e instanceof EgressDenied;
}
