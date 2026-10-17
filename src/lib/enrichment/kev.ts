import { CVE_ID_SHAPE } from "../cveChips.ts";
import { boundedFetchJson } from "../pipeline/boundedFetch.ts";
import type { fetchWithValidatedRedirect } from "../pipeline/fetchWithValidatedRedirect.ts";
import type { KevEntry, KevMap } from "../types.ts";
import {
  KEV_EARLIEST_DATE_ADDED,
  KEV_MAX_RAW_BYTES,
  KEV_MAX_SKIPPED_RATIO,
  KEV_MAX_SLIM_BYTES,
  KEV_MIN_ENTRIES,
  KEV_TIMEOUT_MS,
  KEV_URL,
} from "./config.ts";

/**
 * Cache key of the shared KEV slim map. The `-v1` suffix is the map's schema
 * version, documented like `EDITION_CACHE_KEY`: a shape change bumps the
 * suffix and adds a pinned shape in `kev.test.ts` (the 06-02 rule), because
 * the key otherwise depends only on the callback's source text and Vercel's
 * Data Cache survives deployments. The map deliberately keeps only `added`,
 * `due` and `ransomware` (about 102 KB); Phase 10 may add vendor, product and
 * name with a key bump (RESEARCH Open Question 5). Lives here, not in
 * `snapshot.ts`, so hermetic tests can import it.
 */
export const KEV_CACHE_KEY = "havadis-kev-v1";

const CATALOG_VERSION_SHAPE = /^[0-9A-Za-z.-]{1,32}$/;
const DATE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a `YYYY-MM-DD` string naming a real calendar date (it round-trips through Date.UTC). */
function isRealDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE_SHAPE.exec(value);
  if (!m) return false;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(t).toISOString().slice(0, 10) === value;
}

function reject(reason: string): never {
  throw new Error(`kev rejected: ${reason}`);
}

/**
 * Validates and slims the raw CISA KEV feed (ENR-01, D-19). Hand-written, no
 * dependency. Throws an Error starting "kev rejected: " when the feed is not
 * an object with a `vulnerabilities` array, when `count` is present and
 * disagrees with the array length, when skipped entries exceed
 * `KEV_MAX_SKIPPED_RATIO` of the array (schema drift), when valid entries fall
 * below `minEntries` (this also rejects zero valid entries), or when the slim
 * JSON exceeds `maxSlimBytes`.
 *
 * An entry is valid only when `cveID` matches the anchored CVE shape,
 * `dateAdded` is a real calendar date between `KEV_EARLIEST_DATE_ADDED` and
 * the UTC date of `now` plus one day, `dueDate` is a real date or the empty
 * string, and it is an object. `ransomware` is `knownRansomwareCampaignUse ===
 * "Known"`. A duplicate `cveID` keeps its first valid entry. The result is
 * built as fresh literals under validated ID keys only; no parsed upstream
 * object is spread, assigned or retained, so a hostile `__proto__` key can
 * never be copied.
 *
 * Never reads the clock; `now` is the caller's.
 */
export function parseKev(
  json: unknown,
  now: number,
  limits: { minEntries?: number; maxSlimBytes?: number } = {}
): KevMap {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return reject("feed is not an object");
  }
  const feed = json as Record<string, unknown>;
  const list = feed.vulnerabilities;
  if (!Array.isArray(list)) return reject("no vulnerabilities array");
  if ("count" in feed && feed.count !== list.length) {
    return reject("count does not match the vulnerabilities array");
  }

  const latestDate = new Date(now + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const entries: Record<string, KevEntry> = {};
  let valid = 0;
  let skipped = 0;
  for (const raw of list as unknown[]) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      skipped++;
      continue;
    }
    const e = raw as Record<string, unknown>;
    const id = e.cveID;
    const added = e.dateAdded;
    const due = e.dueDate;
    if (
      typeof id !== "string" ||
      !CVE_ID_SHAPE.test(id) ||
      !isRealDate(added) ||
      added < KEV_EARLIEST_DATE_ADDED ||
      added > latestDate ||
      !(due === "" || isRealDate(due))
    ) {
      skipped++;
      continue;
    }
    if (Object.hasOwn(entries, id)) continue; // a later duplicate counts as neither valid nor skipped
    entries[id] = { added, due, ransomware: e.knownRansomwareCampaignUse === "Known" };
    valid++;
  }

  if (skipped > list.length * KEV_MAX_SKIPPED_RATIO) {
    return reject(`${skipped} of ${list.length} entries invalid (schema drift)`);
  }
  const minEntries = limits.minEntries ?? KEV_MIN_ENTRIES;
  if (valid === 0 || valid < minEntries) {
    return reject(`only ${valid} valid entries (minimum ${minEntries})`);
  }

  const catalogVersion =
    typeof feed.catalogVersion === "string" && CATALOG_VERSION_SHAPE.test(feed.catalogVersion)
      ? feed.catalogVersion
      : "unknown";
  const map: KevMap = {
    version: 1,
    fetchedAt: new Date(now).toISOString(),
    catalogVersion,
    entries,
  };

  const maxSlimBytes = limits.maxSlimBytes ?? KEV_MAX_SLIM_BYTES;
  const slimBytes = Buffer.byteLength(JSON.stringify(map), "utf-8");
  if (slimBytes > maxSlimBytes) {
    return reject(`slim map is ${slimBytes} bytes (cap ${maxSlimBytes})`);
  }
  return map;
}

/**
 * Fetches and validates the KEV feed for the shared cache (ENR-01). Policy:
 * EVERY rejection throws, so `cachedSnapshot` keeps the previous map (stale
 * beats empty, ENR-03) instead of overwriting it with a returned value. It
 * never logs, never puts upstream text in a message (reasons name the
 * failure only) and never reads the clock.
 *
 * It passes no `revalidate`: it runs inside a cached callback, where Next
 * forces every fetch uncached, so the 1.78 MB raw body never reaches the Data
 * Cache (RESEARCH Pitfall 3); only the slim map does.
 */
export async function produceKev(
  now: number,
  deps: {
    url?: string;
    fetcher?: typeof fetchWithValidatedRedirect;
    maxRawBytes?: number;
    timeoutMs?: number;
    minEntries?: number;
    maxSlimBytes?: number;
  } = {}
): Promise<KevMap> {
  const result = await boundedFetchJson(
    deps.url ?? KEV_URL,
    {
      maxBytes: deps.maxRawBytes ?? KEV_MAX_RAW_BYTES,
      timeoutMs: deps.timeoutMs ?? KEV_TIMEOUT_MS,
    },
    { fetcher: deps.fetcher }
  );
  if (!result.ok) return reject(result.reason);
  return parseKev(result.json, now, deps);
}
