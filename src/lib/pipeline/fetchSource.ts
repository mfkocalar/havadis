import Parser from "rss-parser";
import type { SourceConfig, FrontPageResult } from "../types.ts";
import { BodyCapError, readBodyWithCap } from "./boundedFetch.ts";
import { normalize } from "./normalize.ts";
import { USER_AGENT } from "../config/crawler.ts";
import { isEgressDenied, RedirectError } from "../egress/errors.ts";
import { safeFetch } from "../egress/safeFetch.ts";
import type { SafeFetch } from "../egress/safeFetch.ts";
import type { FetchErrorCode } from "../reasonCodes.ts";
import type { FeedFetchResult, FeedValidators } from "./feedResult.ts";

// The User-Agent sent on every source fetch (the crawler's public identity and
// contact URL) lives in config/crawler.ts so the host and contact channel are
// a one-line edit in one module.

const ACCEPT_HEADER =
  "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.1";

/**
 * The default cap on a feed body: 2 MB. A source may raise its own cap with
 * `maxBodyBytes`.
 */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * The per-source time budget (INGEST-03's "~8s per-source timeout"),
 * spanning connect, header arrival, every redirect hop, and the full body
 * read as one continuous window. Armed once at `fetchFeed` entry and
 * composed into safeFetch's per-hop signal (safeFetch's own per-hop timer
 * covers only the header phase, so it alone would not bound the body read).
 */
const SOURCE_TIMEOUT_MS = 8_000;

/** The largest Retry-After honoured: the same six-hour ceiling as the worker's back-off (T-14-17). */
const RETRY_AFTER_MAX_MS = 6 * 3_600_000;

const parser = new Parser();

/**
 * Reads a Retry-After header as integer delta-seconds or an HTTP-date (relative to `now`), clamped
 * to [0, six hours]. Anything else, including a negative or fractional number, is null.
 */
function parseRetryAfter(value: string | null, now: number): number | null {
  if (value === null) return null;
  const text = value.trim();
  let ms: number;
  if (/^\d+$/.test(text)) {
    ms = Number(text) * 1000;
  } else {
    // An HTTP-date starts with a weekday name; this keeps V8's lenient legacy parser from reading
    // "-5" or "1.5" as a date.
    if (!/^[A-Za-z]{3}/.test(text)) return null;
    const date = Date.parse(text);
    if (!Number.isFinite(date)) return null;
    ms = date - now;
  }
  if (!Number.isFinite(ms)) return null;
  return Math.min(Math.max(ms, 0), RETRY_AFTER_MAX_MS);
}

/**
 * Fetches and parses one source with a conditional GET. NEVER throws, and never returns upstream
 * text: every failure path (the continuous per-source timeout described above `SOURCE_TIMEOUT_MS`,
 * rejected redirect, egress denial, non-2xx status, a content-type that could not possibly be a
 * feed, oversized body, parse failure) returns the error variant carrying one fixed
 * `FetchErrorCode`, so the caller can always render the page's full layout (CONTEXT.md D-03) and
 * no response text reaches a log or a stored row (T-14-18).
 *
 * `opts.validators` are the stored ETag and Last-Modified of this source's last parsed response;
 * each non-null one is sent back verbatim as If-None-Match or If-Modified-Since. A 304 is
 * `not-modified` only when a validator was sent. `opts.now` reads the clock for Retry-After dates.
 */
export async function fetchFeed(
  source: SourceConfig,
  opts: { fetcher?: SafeFetch; validators?: FeedValidators; now?: () => number } = {}
): Promise<FeedFetchResult> {
  // Every feed request goes through the egress module unless a test injects its own fetcher.
  const fetcher: SafeFetch = opts.fetcher ?? safeFetch;
  const sent = opts.validators ?? { etag: null, lastModified: null };
  const validatorSent = sent.etag !== null || sent.lastModified !== null;
  const error = (
    code: FetchErrorCode,
    httpStatus: number | null = null,
    retryAfterMs: number | null = null
  ): FeedFetchResult => ({ status: "error", code, httpStatus, retryAfterMs });

  // One controller for the whole source fetch — connect, headers, every
  // redirect hop, and the full body read all share this single signal, so
  // there is no window between fetch() resolving and the body being
  // drained in which nothing is armed.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("per-source timeout")), SOURCE_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: ACCEPT_HEADER };
    if (sent.etag !== null) headers["If-None-Match"] = sent.etag;
    if (sent.lastModified !== null) headers["If-Modified-Since"] = sent.lastModified;
    const res = await fetcher(source.url, { headers, signal: controller.signal });

    if (res.status === 304) {
      await res.body?.cancel().catch(() => {});
      return validatorSent ? { status: "not-modified", httpStatus: 304 } : error("http_error", 304);
    }

    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      const retryAfterMs =
        res.status === 429 || res.status === 503
          ? parseRetryAfter(res.headers.get("retry-after"), (opts.now ?? Date.now)())
          : null;
      return error("http_error", res.status, retryAfterMs);
    }

    // Some publishers mislabel a genuinely valid RSS/Atom response as
    // text/html (observed live on Krebs on Security's bare /feed path,
    // pre-redirect). With a single source that global exception was
    // low-risk; across 13 origins, an HTML WAF challenge, cookie wall, or
    // error page from any non-opted-in source would otherwise burn the full
    // body-download and XML-parse cost before failing, inside a shared 8s
    // budget. So "html" is only accepted for a source that opted in via
    // `allowHtmlContentType` on live-probe evidence — the XML parse step
    // below remains the real authority on whether the body is a usable
    // feed for that source; this check only fast-fails content-types that
    // could never be one (images, JSON, binary payloads) for everyone else.
    const contentType = res.headers.get("content-type") ?? "";
    const lowerContentType = contentType.toLowerCase();
    const htmlOptIn = source.allowHtmlContentType === true;
    if (!lowerContentType.includes("xml") && !(htmlOptIn && lowerContentType.includes("html"))) {
      await res.body?.cancel().catch(() => {});
      return error("content_type", res.status);
    }

    let xmlText: string;
    try {
      xmlText = await readBodyWithCap(res, source.maxBodyBytes ?? MAX_BODY_BYTES, controller.signal);
    } catch (err) {
      // The budget's abort wins over whatever generic abort text the platform produced.
      if (controller.signal.aborted) return error("timeout", res.status);
      return error(err instanceof BodyCapError ? "body_too_large" : "network_error", res.status);
    }

    let feed: Parser.Output<Record<string, unknown>>;
    try {
      // Always parse text we fetched ourselves through safeFetch with parseString —
      // never rss-parser's own parseURL(), which uses Node's raw http client and
      // would bypass the egress module.
      feed = await parser.parseString(xmlText);
    } catch {
      return error("parse_error", res.status);
    }

    const articles = (feed.items ?? [])
      .map((item) => normalize(item, source))
      .filter((article) => article !== null);

    return {
      status: "ok",
      articles,
      validators: {
        etag: res.headers.get("etag") || null,
        lastModified: res.headers.get("last-modified") || null,
      },
      httpStatus: res.status,
    };
  } catch (err) {
    if (controller.signal.aborted) return error("timeout");
    if (isEgressDenied(err)) return error(err.code);
    if (err instanceof RedirectError) return error("redirect_error");
    return error("network_error");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The unconditional fetch the front page and the page-pipeline tests use: `fetchFeed` without
 * validators, reported in the pinned `FrontPageResult` shape with the reason `<source id>: <code>`.
 * NEVER throws.
 */
export async function fetchSource(
  source: SourceConfig,
  deps: { fetcher?: SafeFetch } = {}
): Promise<FrontPageResult> {
  const result = await fetchFeed(source, { fetcher: deps.fetcher });
  if (result.status === "ok") return { status: "ok", articles: result.articles };
  // A 304 cannot occur without validators; fetchFeed reports it as http_error in that case.
  return { status: "error", reason: `${source.id}: ${result.status === "error" ? result.code : "http_error"}` };
}
