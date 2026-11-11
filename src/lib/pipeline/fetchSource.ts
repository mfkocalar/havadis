import Parser from "rss-parser";
import type { SourceConfig, FrontPageResult } from "../types.ts";
import { readBodyWithCap } from "./boundedFetch.ts";
import { normalize } from "./normalize.ts";
import { USER_AGENT } from "../config/crawler.ts";
import { safeFetch } from "../egress/safeFetch.ts";
import type { SafeFetch } from "../egress/safeFetch.ts";

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
 * read as one continuous window. Armed once at `fetchSource` entry and
 * composed into safeFetch's per-hop signal (safeFetch's own per-hop timer
 * covers only the header phase, so it alone would not bound the body read).
 */
const SOURCE_TIMEOUT_MS = 8_000;

const parser = new Parser();

/**
 * Fetches and parses one source. NEVER throws — every failure path (the
 * continuous per-source timeout described above `SOURCE_TIMEOUT_MS`,
 * rejected redirect, non-2xx status, a content-type that could not possibly
 * be a feed, oversized body, parse failure) returns the error variant so the
 * caller can always render the page's full layout (CONTEXT.md D-03).
 */
export async function fetchSource(
  source: SourceConfig,
  deps: { fetcher?: SafeFetch } = {}
): Promise<FrontPageResult> {
  // Every feed request goes through the egress module unless a test injects its own fetcher.
  const fetcher: SafeFetch = deps.fetcher ?? safeFetch;
  // One controller for the whole source fetch — connect, headers, every
  // redirect hop, and the full body read all share this single signal, so
  // there is no window between fetch() resolving and the body being
  // drained in which nothing is armed.
  const controller = new AbortController();
  const timeoutError = new Error(
    `${source.id}: per-source timeout exceeded (budget covers connect, headers and body)`
  );
  const timer = setTimeout(() => controller.abort(timeoutError), SOURCE_TIMEOUT_MS);
  try {
    const res = await fetcher(source.url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: ACCEPT_HEADER,
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return {
        status: "error",
        reason: `${source.id}: non-2xx status ${res.status}`,
      };
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
      return {
        status: "error",
        reason: `${source.id}: unexpected content-type "${contentType}"`,
      };
    }

    let xmlText: string;
    try {
      xmlText = await readBodyWithCap(res, source.maxBodyBytes ?? MAX_BODY_BYTES, controller.signal);
    } catch (err) {
      return {
        status: "error",
        // Prefer the budget's own distinctive timeout message over
        // whatever generic abort text the platform produced, so the reason
        // the caller sees always names the timeout when that is the cause.
        reason: controller.signal.aborted
          ? timeoutError.message
          : `${source.id}: ${err instanceof Error ? err.message : "body read failed"}`,
      };
    }

    let feed: Parser.Output<Record<string, unknown>>;
    try {
      // Always parse text we fetched ourselves through safeFetch with parseString —
      // never rss-parser's own parseURL(), which uses Node's raw http client and
      // would bypass the egress module.
      feed = await parser.parseString(xmlText);
    } catch (err) {
      return {
        status: "error",
        reason: `${source.id}: XML parse failed (${err instanceof Error ? err.message : "unknown error"})`,
      };
    }

    const articles = (feed.items ?? [])
      .map((item) => normalize(item, source))
      .filter((article) => article !== null);

    return { status: "ok", articles };
  } catch (err) {
    return {
      status: "error",
      reason: controller.signal.aborted
        ? timeoutError.message
        : `${source.id}: ${err instanceof Error ? err.message : "unknown fetch error"}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
