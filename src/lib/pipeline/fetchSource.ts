import Parser from "rss-parser";
import type { SourceConfig, FrontPageResult } from "../types.ts";
import { fetchWithValidatedRedirect } from "./fetchWithValidatedRedirect.ts";
import { normalize } from "./normalize.ts";

/**
 * Sent on every source fetch. Carries browser-compatible tokens (to clear a
 * source's bot-management layer, per RESEARCH.md Assumption A1) while still
 * naming Havadis as an automated aggregator with a contact URL, so a
 * publisher inspecting logs can see who is fetching and how to reach the
 * operator. Update the contact URL once the site has a live domain.
 */
const USER_AGENT =
  "Mozilla/5.0 (compatible; HavadisBot/0.1; +https://havadis.app/about) automated cybersecurity news aggregator";

const ACCEPT_HEADER =
  "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.1";

/** Matches the Vercel Data Cache's documented 2MB per-entry item size cap. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const parser = new Parser();

/** Reads a Response body up to `maxBytes`, erroring rather than exhausting the function on an unbounded stream. */
async function readBodyWithCap(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) {
    return await res.text();
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          throw new Error(`Response body exceeded ${maxBytes} byte cap`);
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
}

/**
 * Fetches and parses one source. NEVER throws — every failure path (per-hop
 * timeout, rejected redirect, non-2xx status, non-XML content type,
 * oversized body, parse failure) returns the error variant so the caller
 * can always render the page's full layout (CONTEXT.md D-03).
 */
export async function fetchSource(source: SourceConfig): Promise<FrontPageResult> {
  try {
    const res = await fetchWithValidatedRedirect(source.url, {
      next: { revalidate: 900 },
      headers: {
        "User-Agent": USER_AGENT,
        Accept: ACCEPT_HEADER,
      },
    });

    if (!res.ok) {
      return {
        status: "error",
        reason: `${source.id}: non-2xx status ${res.status}`,
      };
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("xml")) {
      return {
        status: "error",
        reason: `${source.id}: unexpected content-type "${contentType}"`,
      };
    }

    let xmlText: string;
    try {
      xmlText = await readBodyWithCap(res, MAX_BODY_BYTES);
    } catch (err) {
      return {
        status: "error",
        reason: `${source.id}: ${err instanceof Error ? err.message : "body read failed"}`,
      };
    }

    let feed: Parser.Output<Record<string, unknown>>;
    try {
      // Always parse text we fetched ourselves via `fetch` + `next.revalidate`
      // — never rss-parser's own parseURL(), which uses Node's raw http
      // client and is invisible to Next.js's Data Cache.
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
      reason: `${source.id}: ${err instanceof Error ? err.message : "unknown fetch error"}`,
    };
  }
}
