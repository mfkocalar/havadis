import { fetchWithValidatedRedirect } from "./fetchWithValidatedRedirect.ts";
import { USER_AGENT } from "../config/crawler.ts";

/**
 * Reads a Response body up to `maxBytes`, erroring rather than exhausting
 * the function on an unbounded stream. `signal` carries the same
 * per-source budget the caller armed before this response existed: the
 * load-bearing mechanism is that the runtime tears down the response body
 * stream when `signal` aborts, so a pending `reader.read()` rejects on its
 * own. The `signal.aborted` check at the top of the loop is a narrow safety
 * net only — it covers the case where a chunk lands in the same tick the
 * abort fires — not the fix itself.
 *
 * Both the streaming path (below) and the no-stream path (when the
 * response exposes no readable stream) enforce `maxBytes` and observe
 * `signal` — neither path can return an uncapped or unabortable body.
 */
export async function readBodyWithCap(
  res: Response,
  maxBytes: number,
  signal: AbortSignal
): Promise<string> {
  if (!res.body) {
    if (signal.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
    }
    const text = await res.text();
    if (Buffer.byteLength(text, "utf-8") > maxBytes) {
      throw new Error(`Response body exceeded ${maxBytes} byte cap`);
    }
    return text;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      if (signal.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          const err = new Error(`Response body exceeded ${maxBytes} byte cap`);
          await reader.cancel(err).catch(() => {});
          throw err;
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
}

/** The outcome of `boundedFetchJson`: parsed JSON, or a short reason (never body text). */
export type BoundedJsonResult = { ok: true; json: unknown } | { ok: false; reason: string };

/**
 * Fetches one URL and parses its body as JSON under a hard byte cap and one
 * continuous time budget. NEVER throws: every failure path (non-2xx status,
 * oversized body, timeout, rejected redirect, invalid JSON) resolves to
 * `{ ok: false, reason }`. A reason names the failure, never upstream body
 * text, so callers can put it in an error message safely.
 *
 * Same single-signal structure as `fetchSource`: one controller armed with
 * `opts.timeoutMs` before the request, passed to the fetcher (which composes
 * it into every redirect hop), and still live during the body read. `next`
 * carries `revalidate` only when the caller passes one; there is no cache
 * request option at all, because inside a cached callback Next already forces
 * every fetch uncached and an explicit option could add request headers.
 *
 * No content-type gate: some mirrors serve JSON as text/plain, so parsing plus
 * the caller's schema validation is the authority.
 */
export async function boundedFetchJson(
  url: string,
  opts: { maxBytes: number; timeoutMs: number; revalidate?: number },
  deps: { fetcher?: typeof fetchWithValidatedRedirect } = {}
): Promise<BoundedJsonResult> {
  const controller = new AbortController();
  const timeoutReason = `timeout after ${opts.timeoutMs} ms`;
  const timer = setTimeout(() => controller.abort(new Error(timeoutReason)), opts.timeoutMs);
  try {
    const fetcher = deps.fetcher ?? fetchWithValidatedRedirect;
    const res = await fetcher(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
      ...(opts.revalidate === undefined ? {} : { next: { revalidate: opts.revalidate } }),
    });

    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: `status ${res.status}` };
    }

    let text: string;
    try {
      text = await readBodyWithCap(res, opts.maxBytes, controller.signal);
    } catch (err) {
      return {
        ok: false,
        reason: controller.signal.aborted
          ? timeoutReason
          : err instanceof Error
            ? err.message
            : "body read failed",
      };
    }

    try {
      return { ok: true, json: JSON.parse(text) as unknown };
    } catch {
      return { ok: false, reason: "invalid JSON" };
    }
  } catch (err) {
    return {
      ok: false,
      reason: controller.signal.aborted
        ? timeoutReason
        : err instanceof Error
          ? err.message
          : "fetch failed",
    };
  } finally {
    clearTimeout(timer);
  }
}
