import type { FetchErrorCode } from "../reasonCodes.ts";
import type { Article } from "../types.ts";

/**
 * The per-source fetch result the ingest cycle consumes (interface-first contract that Plan 09's
 * fetchFeed implements). It sits next to, not inside, `FrontPageResult` because that shape is
 * pinned by tests and has no room for a 304 or a fixed reason code.
 *
 * Types only: nothing here runs, so any module may import it without reaching the network.
 */

/** The conditional-GET validators of the last parsed response; stored only after a successful parse. */
export type FeedValidators = { etag: string | null; lastModified: string | null };

export type FeedFetchResult =
  | { status: "ok"; articles: Article[]; validators: FeedValidators; httpStatus: number }
  | { status: "not-modified"; httpStatus: 304 }
  | { status: "error"; code: FetchErrorCode; httpStatus: number | null; retryAfterMs: number | null };
