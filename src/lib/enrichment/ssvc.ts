import { CVE_ID_SHAPE } from "../cveChips.ts";
import { boundedFetchJson } from "../pipeline/boundedFetch.ts";
import type { fetchWithValidatedRedirect } from "../pipeline/fetchWithValidatedRedirect.ts";
import type { CacheableSsvcState, EpssState, KevState, SsvcState } from "../types.ts";
import {
  CISA_ADP_ORG_ID,
  SSVC_CONCURRENCY,
  SSVC_MAX_BYTES,
  SSVC_RECORD_URL_BASE,
  SSVC_TIMEOUT_MS,
} from "./config.ts";

/**
 * CISA SSVC lookups from the CVE Program record (ENR-06, ENR-07). Plain
 * TypeScript, no React import, never reads the clock.
 *
 * The dangerous part of this file is the meaning of absence. Only a record that
 * passes every rule in `parseSsvcRecord` becomes `assessed`; a record with no
 * CISA-ADP container is `not-assessed`; every other shape is `unavailable`.
 * No code path yields exploitation `none` except the literal validated value
 * `none`.
 */

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Own-property read, so an inherited or polluted key can never answer. */
const own = (o: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(o, key) ? o[key] : undefined;

const SSVC_VERSION = /^2\.\d+\.\d+$/;

/**
 * The URL of one CVE Program record: base, a slash and the ID, byte-identical
 * across regenerations. Phase 10 CVE-03 builds the same URL from this helper.
 */
export function cveRecordUrl(id: string, base: string = SSVC_RECORD_URL_BASE): string {
  return `${base}/${id}`;
}

/**
 * The entire trust boundary for upstream text. `cveMetadata.cveId` and the SSVC
 * `content.id` must equal the requested `id`; exactly one CISA-ADP container
 * (by org id), exactly one `ssvc` metric of version major 2, and exactly the
 * three options Exploitation, Automatable and Technical Impact, each once with
 * an allowed value. No `adp` array, or no CISA container in it, is
 * `not-assessed`. Every other shape is `unavailable`. The result is a fresh
 * object literal of copied scalars; upstream objects are never spread or
 * indexed by an upstream key. The timestamp is neither parsed nor compared.
 */
export function parseSsvcRecord(json: unknown, id: string): SsvcState {
  const unavailable = (): SsvcState => ({ state: "unavailable" });
  if (!isObj(json)) return unavailable();
  const meta = own(json, "cveMetadata");
  if (!isObj(meta) || own(meta, "cveId") !== id) return unavailable();
  const containers = own(json, "containers");
  if (!isObj(containers)) return unavailable();
  const adp = own(containers, "adp");
  if (adp === undefined) return { state: "not-assessed" };
  if (!Array.isArray(adp)) return unavailable();

  const cisa = adp.filter((c: unknown) => {
    if (!isObj(c)) return false;
    const pm = own(c, "providerMetadata");
    return isObj(pm) && own(pm, "orgId") === CISA_ADP_ORG_ID;
  });
  if (cisa.length === 0) return { state: "not-assessed" };
  if (cisa.length !== 1) return unavailable();
  const container = cisa[0] as Record<string, unknown>;
  const metrics = own(container, "metrics");
  if (!Array.isArray(metrics)) return unavailable();

  const ssvcContents: unknown[] = [];
  for (const m of metrics) {
    if (!isObj(m)) continue;
    const other = own(m, "other");
    if (isObj(other) && own(other, "type") === "ssvc") ssvcContents.push(own(other, "content"));
  }
  if (ssvcContents.length !== 1) return unavailable();
  const content = ssvcContents[0];
  if (!isObj(content)) return unavailable();
  if (own(content, "id") !== id) return unavailable();
  const version = own(content, "version");
  if (typeof version !== "string" || !SSVC_VERSION.test(version)) return unavailable();
  const options = own(content, "options");
  if (!Array.isArray(options)) return unavailable();

  // Null-prototype accumulator: an upstream "__proto__" key becomes a plain
  // own property here and can never reach Object.prototype.
  const seen: Record<string, string> = Object.create(null);
  for (const o of options) {
    if (!isObj(o)) return unavailable();
    const keys = Object.keys(o);
    if (keys.length !== 1) return unavailable();
    const key = keys[0];
    const value = o[key];
    if (typeof value !== "string") return unavailable();
    if (Object.hasOwn(seen, key)) return unavailable();
    seen[key] = value;
  }
  if (Object.keys(seen).length !== 3) return unavailable();
  const exploitation = Object.hasOwn(seen, "Exploitation") ? seen["Exploitation"] : undefined;
  const automatable = Object.hasOwn(seen, "Automatable") ? seen["Automatable"] : undefined;
  const impact = Object.hasOwn(seen, "Technical Impact") ? seen["Technical Impact"] : undefined;
  if (!(exploitation === "none" || exploitation === "poc" || exploitation === "active")) {
    return unavailable();
  }
  if (!(automatable === "yes" || automatable === "no")) return unavailable();
  if (!(impact === "partial" || impact === "total")) return unavailable();
  return {
    state: "assessed",
    exploitation,
    automatable,
    technicalImpact: impact,
  };
}

/**
 * True only for a state that may live in the shared cache: `not-assessed`, or an
 * `assessed` object whose three fields hold allowed values. Applied to every
 * value read back from the cache, since cached values pass a JSON round trip.
 */
export function isCacheableSsvc(v: unknown): v is CacheableSsvcState {
  if (!isObj(v)) return false;
  const state = own(v, "state");
  if (state === "not-assessed") return true;
  if (state !== "assessed") return false;
  const e = own(v, "exploitation");
  const a = own(v, "automatable");
  const t = own(v, "technicalImpact");
  return (
    (e === "none" || e === "poc" || e === "active") &&
    (a === "yes" || a === "no") &&
    (t === "partial" || t === "total")
  );
}

/**
 * True for the CVE Program API's answer for a nonexistent ID: a non-array
 * object whose own `error` field is exactly `CVE_RECORD_DNE`. Any other 404
 * body (a proxy page, a path or API-version drift) is not this.
 */
export function isDneBody(json: unknown): boolean {
  return isObj(json) && own(json, "error") === "CVE_RECORD_DNE";
}

/** Injectable pieces of `produceSsvc`, for hermetic tests. */
export type SsvcFetchDeps = {
  url?: string;
  fetcher?: typeof fetchWithValidatedRedirect;
  timeoutMs?: number;
  maxBytes?: number;
};

/**
 * The producer behind the per-CVE cache: resolves only a positively parsed
 * `assessed` or `not-assessed` state and THROWS everything else, so a failure
 * is never stored (D-12). Messages are fixed text, never upstream text.
 *
 * The fetch passes no `revalidate`: inside the cached callback Next already
 * forces it uncached and keeps its abort signal, and a `revalidate` would add a
 * second cache entry. A 404 is read too (`acceptStatuses`): the exact
 * `CVE_RECORD_DNE` body is `not-assessed`, any other 404 throws. The ID is checked against `CVE_ID_SHAPE` before any
 * request, so it can never alter the URL path (SSRF).
 */
export async function produceSsvc(
  id: string,
  deps: SsvcFetchDeps = {}
): Promise<CacheableSsvcState> {
  if (typeof id !== "string" || !CVE_ID_SHAPE.test(id)) throw new Error("ssvc: invalid id");
  const res = await boundedFetchJson(
    cveRecordUrl(id, deps.url ?? SSVC_RECORD_URL_BASE),
    {
      maxBytes: deps.maxBytes ?? SSVC_MAX_BYTES,
      timeoutMs: deps.timeoutMs ?? SSVC_TIMEOUT_MS,
      acceptStatuses: [404],
    },
    { fetcher: deps.fetcher }
  );
  if (!res.ok) throw new Error("ssvc: lookup failed");
  if (res.status === 404) {
    // Only the exact CVE_RECORD_DNE body is a positively observed "no such
    // record" (not-assessed); any other 404 is drift and must not read as that.
    if (isDneBody(res.json)) return { state: "not-assessed" };
    throw new Error("ssvc: unexpected 404");
  }
  const parsed = parseSsvcRecord(res.json, id);
  if (parsed.state !== "assessed" && parsed.state !== "not-assessed") {
    throw new Error("ssvc: unusable record");
  }
  return parsed;
}

/** What `selectSsvcIds` decided for one edition's CVEs. */
export type SsvcSelection = { lookups: string[]; skipped: string[]; overflow: string[] };

/**
 * Chooses which CVEs get an SSVC lookup (D-05, D-06, D-08). Unique IDs matching
 * `CVE_ID_SHAPE`, in input order. When `kevKnown`, KEV-listed IDs are `skipped`
 * and never looked up; when KEV is unavailable nobody is skipped. The remaining
 * candidates are split at `cap`: the first `cap` are `lookups`, the rest
 * `overflow` (unavailable). Nothing here consults a cache, so the same edition
 * always gets the same coverage. `epss` and `cardCves` are accepted for the
 * D-07 priority order, which a later plan adds; input order is kept for now.
 */
export function selectSsvcIds(
  ids: readonly string[],
  pre: Readonly<Record<string, { kev: KevState; epss: EpssState }>>,
  opts: { kevKnown: boolean; cap: number; cardCves?: ReadonlyArray<readonly string[]> }
): SsvcSelection {
  const seen = new Set<string>();
  const skipped: string[] = [];
  const candidates: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !CVE_ID_SHAPE.test(id) || seen.has(id)) continue;
    seen.add(id);
    const entry = Object.hasOwn(pre, id) ? pre[id] : undefined;
    if (opts.kevKnown && entry !== undefined && entry.kev.state === "listed") {
      skipped.push(id);
    } else {
      candidates.push(id);
    }
  }
  return {
    lookups: candidates.slice(0, opts.cap),
    skipped,
    overflow: candidates.slice(opts.cap),
  };
}

/** Injectable pieces of `fetchSsvc`. Without `lookup` no request is ever made. */
export type SsvcDeps = {
  lookup?: (id: string) => Promise<CacheableSsvcState>;
  concurrency?: number;
  maxLookups?: number;
};

/**
 * Resolves SSVC for `ids` through `deps.lookup`, never throwing. Without a
 * lookup every ID is `unavailable` and nothing is requested, so no test can
 * reach a live host by omission (D-10). With one, an index-counter worker pool
 * of at most `min(concurrency, ids)` workers calls it once per ID; a throw or a
 * value failing `isCacheableSsvc` is `unavailable` for that ID only. The
 * result is a fresh object keyed only by the given IDs that match
 * `CVE_ID_SHAPE`.
 */
export async function fetchSsvc(
  ids: readonly string[],
  deps: SsvcDeps = {}
): Promise<Record<string, SsvcState>> {
  const out: Record<string, SsvcState> = {};
  const valid: string[] = [];
  try {
    const seen = new Set<string>();
    for (const id of ids) {
      if (typeof id === "string" && CVE_ID_SHAPE.test(id) && !seen.has(id)) {
        seen.add(id);
        valid.push(id);
      }
    }
    const lookup = deps.lookup;
    if (lookup === undefined) {
      for (const id of valid) out[id] = { state: "unavailable" };
      return out;
    }
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = next++;
        if (i >= valid.length) return;
        const id = valid[i];
        try {
          const value: unknown = await lookup(id);
          out[id] = isCacheableSsvc(value)
            ? value.state === "assessed"
              ? {
                  state: "assessed",
                  exploitation: value.exploitation,
                  automatable: value.automatable,
                  technicalImpact: value.technicalImpact,
                }
              : { state: "not-assessed" }
            : { state: "unavailable" };
        } catch {
          out[id] = { state: "unavailable" };
        }
      }
    };
    const width = Math.max(1, Math.min(deps.concurrency ?? SSVC_CONCURRENCY, valid.length));
    await Promise.all(Array.from({ length: width }, worker));
    return out;
  } catch {
    const all: Record<string, SsvcState> = {};
    for (const id of valid) all[id] = { state: "unavailable" };
    return all;
  }
}
