import dns from "node:dns";
import type net from "node:net";
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";
import { loadConfig } from "../config/env.ts";
import { EgressDenied, RedirectError, isEgressDenied } from "./errors.ts";
import { checkUrl, ipDenied } from "./policy.ts";

/**
 * The only module in the product that calls the network (SAFE-01, D-13, D-14).
 *
 * Every start URL and every redirect hop passes `checkUrl`. In direct mode (and for hosts in
 * NO_PROXY) the connection is made through a guarded `connect.lookup`: the resolver is asked for
 * every address (`all: true`), the call is refused if any answer is denied, and the checked list
 * itself is handed to the socket, so there is no second resolution to rebind. In proxy mode
 * nothing resolves locally; the operator's proxy must refuse internal ranges (documented limit).
 * One undici `EnvHttpProxyAgent` makes both decisions, so `NO_PROXY` has a single matcher.
 *
 * The dispatcher is built inside the factory, never at module load, and each call keeps its state
 * in locals: concurrent callers cannot interfere. The proxy environment is read once, when an
 * instance is built; restart to change it.
 */

export type SafeFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type SafeFetchOptions = {
  /** Exact hostnames or literal IPs (lowercase, no brackets) that may be reached even when private. */
  allowHosts?: readonly string[];
  /** Resolver used by the connect guard; tests inject one. */
  lookup?: typeof dns.lookup;
  /** Proxy environment for this instance. Absent: undici reads process.env once at construction. */
  env?: Record<string, string | undefined>;
  /** Replaces undici's fetch (tests that must not open sockets). Receives redirect "manual" and the dispatcher. */
  transport?: (url: URL, init: Record<string, unknown>) => Promise<Response>;
  maxRedirects?: number;
  hopTimeoutMs?: number;
};

const FOLLOWED_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_HOP_TIMEOUT_MS = 8_000;

/** undici wraps a lookup failure in `TypeError: fetch failed`; hand callers the denial itself. */
function unwrapDenial(error: unknown): unknown {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && typeof current === "object"; depth++) {
    if (isEgressDenied(current)) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return error;
}

export function createSafeFetch(opts: SafeFetchOptions = {}): SafeFetch {
  const allow: ReadonlySet<string> = new Set((opts.allowHosts ?? []).map((h) => h.toLowerCase()));
  const realLookup = opts.lookup ?? dns.lookup;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const hopTimeoutMs = opts.hopTimeoutMs ?? DEFAULT_HOP_TIMEOUT_MS;

  const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
    realLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, "", 0);
      const list = addresses as dns.LookupAddress[];
      if (!allow.has(hostname) && list.some((a) => ipDenied(a.address))) {
        return callback(new EgressDenied("egress_denied_private"), "", 0);
      }
      // net.connect uses exactly these checked addresses.
      if (options.all) return callback(null, list);
      return callback(null, list[0].address, list[0].family);
    });
  };

  // With an injected env the proxy variables come from it ("" for missing values, so a test never
  // inherits the developer's proxy). Without one, undici applies its own precedence to process.env
  // at construction; only NO_PROXY is pinned here because undici would otherwise re-read it on
  // every request.
  const e = opts.env;
  const proxyOptions = e
    ? {
        httpProxy: e.http_proxy ?? e.HTTP_PROXY ?? "",
        httpsProxy: e.https_proxy ?? e.HTTPS_PROXY ?? "",
        noProxy: e.no_proxy ?? e.NO_PROXY ?? "",
      }
    : { noProxy: process.env.no_proxy ?? process.env.NO_PROXY ?? "" };
  const dispatcher = new EnvHttpProxyAgent({ ...proxyOptions, connect: { lookup: guardedLookup } });

  const transport =
    opts.transport ??
    ((url: URL, init: Record<string, unknown>) => undiciFetch(url, init as never) as unknown as Promise<Response>);

  return async function fetchGuarded(startUrl: string, init: RequestInit = {}): Promise<Response> {
    let url = new URL(startUrl);
    const originalHost = url.host;
    const callerSignal = init.signal ?? undefined;

    for (let hop = 0; hop <= maxRedirects; hop++) {
      checkUrl(url, allow);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), hopTimeoutMs);
      try {
        let res: Response;
        try {
          res = await transport(url, {
            ...init,
            // Never auto-follow: every hop is checked before the next request is issued.
            redirect: "manual",
            dispatcher,
            // The per-hop timer covers the header phase; a caller signal outlives it into the body read.
            signal: callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal,
          });
        } catch (error) {
          throw unwrapDenial(error);
        }

        if (!FOLLOWED_STATUSES.has(res.status)) return res; // 2xx, 304, any other 3xx or an error status
        const location = res.headers.get("location");
        await res.body?.cancel().catch(() => undefined);
        if (!location) throw new RedirectError();
        const next = new URL(location, url);
        // Exact `host` equality (it carries the port): a suffix, prefix or other-port target is refused.
        if (next.host !== originalHost) throw new EgressDenied("egress_denied_redirect");
        url = next;
      } finally {
        clearTimeout(timer);
      }
    }
    throw new RedirectError();
  };
}

let defaultFetch: SafeFetch | undefined;

/**
 * The default instance for the engine: allow-list from the validated HAVADIS_EGRESS_ALLOW_HOSTS,
 * proxy settings from the process environment, built on first use. Entry points validate the
 * configuration first, so the plain Error below is a last line of defence, not a user-facing path.
 */
export const safeFetch: SafeFetch = async (url, init) => {
  if (!defaultFetch) {
    const loaded = loadConfig(process.env);
    if (!loaded.ok) throw new Error(`Invalid configuration: ${loaded.variable}`);
    defaultFetch = createSafeFetch({ allowHosts: loaded.config.egressAllowHosts });
  }
  return defaultFetch(url, init);
};
