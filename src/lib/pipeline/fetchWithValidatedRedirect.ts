/**
 * A fetch wrapper that validates every redirect target before following it,
 * and composes a caller-supplied `AbortSignal` into every hop's own signal
 * so a wider, caller-owned time budget can outlive this function's per-hop
 * timer.
 *
 * Native `fetch()` cannot inspect a redirect's target before deciding
 * whether to follow it — `redirect: "follow"` (the default) commits to
 * following before application code ever sees the response. To satisfy
 * INGEST-03 ("validates any redirect target ... before being followed"),
 * every request here is issued with `redirect: "manual"` from the first
 * line of code, the `Location` header is read and validated, and only a
 * validated target is fetched next — in a loop bounded by a max-hop count.
 *
 * Timeout scope: this function's own per-hop timer (`TIMEOUT_MS` below)
 * covers only the header-arrival phase of each hop — it is cleared the
 * instant `fetch()` resolves, which under Node/undici is the instant
 * response headers arrive, not when the body is read. On its own it does
 * not bound the body-read phase that follows in the caller. When the caller
 * supplies its own signal via `init.signal`, that signal is composed with
 * this hop's signal via `AbortSignal.any`, and it is the caller's signal —
 * not this function's per-hop timer — that carries a wider budget (in this
 * codebase, `fetchSource`'s single continuous per-source budget) past this
 * function's boundary and into the body read. With no caller signal
 * supplied, behavior is unchanged from before: only the bare per-hop timer
 * applies.
 *
 * Every value below is function-local. There is no module-scope mutable
 * state, so concurrent callers cannot interfere with one another.
 */

const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 5;

export async function fetchWithValidatedRedirect(
  startUrl: string,
  init: RequestInit & { next?: { revalidate?: number } } = {}
): Promise<Response> {
  let currentUrl = new URL(startUrl);
  const originalHost = currentUrl.host;
  // Read the caller's signal off `init` before it gets spread (and then
  // overridden) below. Composing it into every hop's own signal — rather
  // than discarding it, which the old `...init, signal: controller.signal`
  // shape did — is what lets a caller's own budget (fetchSource's
  // continuous per-source timeout) survive past this function's per-hop
  // timer, which only covers the header phase (see the `signal:` line
  // below).
  const callerSignal = init.signal ?? undefined;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(currentUrl.toString(), {
        ...init,
        // Never let fetch auto-follow — every hop is validated before the
        // next request is issued. There is no safe way to retrofit this
        // guarantee after starting from the default "follow" mode.
        redirect: "manual",
        // This hop's own timer covers only the header phase: it is cleared
        // in the `finally` below the instant `fetch()` resolves, which
        // under Node/undici is the instant response headers arrive, not
        // when the body is read. Composing in the caller's signal (when
        // supplied) keeps a wider, caller-owned budget live past that
        // point, so it can still tear down a stalled body read on the
        // Response this function returns. With no caller signal, fall back
        // to the bare per-hop signal — identical to the prior behavior.
        signal: callerSignal
          ? AbortSignal.any([callerSignal, controller.signal])
          : controller.signal,
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          throw new Error(`Redirect (${res.status}) with no Location header`);
        }
        // Resolve against the current URL so a relative Location works.
        const target = new URL(location, currentUrl);
        if (target.protocol !== "https:") {
          throw new Error(
            `Rejected redirect: non-HTTPS target ${target.protocol}`
          );
        }
        // Exact string equality on `host` (carries the port too) is
        // deliberate: a suffix, substring, or pattern-based comparison
        // would wrongly accept sub.krebsonsecurity.com or
        // krebsonsecurity.com.example.net as "matching".
        if (target.host !== originalHost) {
          throw new Error(
            `Rejected redirect: host mismatch (${target.host} !== ${originalHost})`
          );
        }
        currentUrl = target;
        continue;
      }

      return res; // 2xx (or a non-redirect error status) — caller handles res.ok
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`Too many redirects (> ${MAX_REDIRECTS}) fetching ${startUrl}`);
}
