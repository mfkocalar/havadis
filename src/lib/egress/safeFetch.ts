import type dns from "node:dns";

// RED-phase signature stubs: the behavior lands in the GREEN commit.
export type SafeFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type SafeFetchOptions = {
  allowHosts?: readonly string[];
  lookup?: typeof dns.lookup;
  env?: Record<string, string | undefined>;
  transport?: (url: URL, init: Record<string, unknown>) => Promise<Response>;
  maxRedirects?: number;
  hopTimeoutMs?: number;
};

export function createSafeFetch(_opts: SafeFetchOptions = {}): SafeFetch {
  return async () => {
    throw new Error("not implemented");
  };
}

export const safeFetch: SafeFetch = async () => {
  throw new Error("not implemented");
};
