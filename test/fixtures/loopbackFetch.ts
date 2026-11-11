import { createSafeFetch } from "../../src/lib/egress/safeFetch.ts";
import type { SafeFetch } from "../../src/lib/egress/safeFetch.ts";

/**
 * A safeFetch for tests that talk to a real 127.0.0.1 fixture server: loopback is allow-listed and
 * the environment is empty so the developer's proxy settings are never inherited. Factory only
 * (Pitfall 16): nothing runs at import time.
 */
export function makeLoopbackFetch(): SafeFetch {
  return createSafeFetch({ allowHosts: ["127.0.0.1"], env: {} });
}
