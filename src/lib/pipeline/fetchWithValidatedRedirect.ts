/**
 * A fetch wrapper that validates every redirect target before following it.
 *
 * Native `fetch()` cannot inspect a redirect's target before deciding
 * whether to follow it — `redirect: "follow"` (the default) commits to
 * following before application code ever sees the response. To satisfy
 * INGEST-03 ("validates any redirect target ... before being followed"),
 * every request here is issued with `redirect: "manual"` from the first
 * line of code, the `Location` header is read and validated, and only a
 * validated target is fetched next — in a loop bounded by a max-hop count.
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
        signal: controller.signal,
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
