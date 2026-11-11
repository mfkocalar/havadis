import { USER_AGENT } from "../config/crawler.ts";
import { isEgressDenied, RedirectError } from "../egress/errors.ts";
import { safeFetch, type SafeFetch } from "../egress/safeFetch.ts";
import type { FetchErrorCode } from "../reasonCodes.ts";

/** Raised by `readBodyWithCap` when the body runs past the cap; the message is unchanged. */
export class BodyCapError extends Error {
  constructor(maxBytes: number) {
    super(`Response body exceeded ${maxBytes} byte cap`);
    this.name = "BodyCapError";
  }
}

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
      throw new BodyCapError(maxBytes);
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
          const err = new BodyCapError(maxBytes);
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

/**
 * The outcome of `boundedFetchJson`: parsed JSON with the HTTP status it came
 * with (2xx, or a status the caller listed in `acceptStatuses`), or a short
 * reason (never body text) plus the fixed `FetchErrorCode` that names the
 * failure class.
 */
export type BoundedJsonResult =
  | { ok: true; json: unknown; status: number }
  | { ok: false; reason: string; code: FetchErrorCode };

/**
 * Fetches one URL and parses its body as JSON under a hard byte cap and one
 * continuous time budget. NEVER throws: every failure path (non-2xx status,
 * oversized body, timeout, rejected redirect, invalid JSON) resolves to
 * `{ ok: false, reason, code }`. A reason names the failure, never upstream
 * body text, so callers can put it in an error message safely.
 *
 * Same single-signal structure as `fetchSource`: one controller armed with
 * `opts.timeoutMs` before the request, passed to the fetcher (which composes
 * it into every redirect hop), and still live during the body read. The
 * request is a plain worker request through `safeFetch`, which applies the
 * egress policy, proxy handling and resolve-and-pin to every hop.
 *
 * `opts.acceptStatuses` lists non-2xx statuses whose body the caller wants to
 * read (SSVC needs the 404 body of the CVE Program API to tell a nonexistent
 * ID from a path drift). A listed status goes on to the same capped, time-boxed
 * body read and JSON parse and resolves `{ ok: true, status }`; every other
 * non-2xx status is still cancelled and reported as `status N`.
 *
 * No content-type gate: some mirrors serve JSON as text/plain, so parsing plus
 * the caller's schema validation is the authority.
 */
export async function boundedFetchJson(
  url: string,
  opts: { maxBytes: number; timeoutMs: number; acceptStatuses?: readonly number[] },
  deps: { fetcher?: SafeFetch } = {}
): Promise<BoundedJsonResult> {
  const controller = new AbortController();
  const timeoutReason = `timeout after ${opts.timeoutMs} ms`;
  const timer = setTimeout(() => controller.abort(new Error(timeoutReason)), opts.timeoutMs);
  try {
    const fetcher = deps.fetcher ?? safeFetch;
    const res = await fetcher(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });

    if (!res.ok && !(opts.acceptStatuses ?? []).includes(res.status)) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: `status ${res.status}`, code: "http_error" };
    }

    let text: string;
    try {
      text = await readBodyWithCap(res, opts.maxBytes, controller.signal);
    } catch (err) {
      if (controller.signal.aborted) return { ok: false, reason: timeoutReason, code: "timeout" };
      return {
        ok: false,
        reason: err instanceof Error ? err.message : "body read failed",
        code: err instanceof BodyCapError ? "body_too_large" : "network_error",
      };
    }

    try {
      return { ok: true, json: JSON.parse(text) as unknown, status: res.status };
    } catch {
      return { ok: false, reason: "invalid JSON", code: "parse_error" };
    }
  } catch (err) {
    if (controller.signal.aborted) return { ok: false, reason: timeoutReason, code: "timeout" };
    const reason = err instanceof Error ? err.message : "fetch failed";
    if (isEgressDenied(err)) return { ok: false, reason, code: err.code };
    if (err instanceof RedirectError) return { ok: false, reason, code: "redirect_error" };
    return { ok: false, reason, code: "network_error" };
  } finally {
    clearTimeout(timer);
  }
}
