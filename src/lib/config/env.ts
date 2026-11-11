import { isIP } from "node:net";
import type { LogLevel } from "../log/logger.ts";

/**
 * Validated HAVADIS_* configuration (D-05). Env vars only, no config file.
 * The data and backup directory variables belong to src/lib/db/paths.ts, and the
 * secret key is loaded only through src/lib/secrets/key.ts. Nothing here reads
 * process.env or the clock: callers pass the environment in.
 */

export type HavadisConfig = {
  baseUrl: string;
  ingestIntervalMs: number;
  enrichIntervalMs: number;
  ssvcMaxLookups: number;
  ssvcBudgetMs: number;
  fetchConcurrency: number;
  egressAllowHosts: readonly string[];
  logLevel: LogLevel;
};

export type ConfigLoad =
  | { ok: true; config: HavadisConfig }
  | { ok: false; variable: string; message: string };

/** How often the worker looks for due work, in milliseconds. */
export const WORKER_TICK_MS = 15_000;

/** How often the worker writes its heartbeat row, in milliseconds. */
export const WORKER_HEARTBEAT_MS = 15_000;

/** The first claim after boot waits a random 0 to this many milliseconds so restarts do not align; the first ingestion still starts promptly. */
export const WORKER_START_JITTER_MS = 5_000;

/** Each interval is stretched by a random share up to this ratio (0.1 is 10%) so replicas drift apart. */
export const INTERVAL_JITTER_RATIO = 0.1;

/** A cycle lease expires after this many milliseconds without renewal (10 minutes). */
export const LEASE_TTL_MS = 600_000;

/** After a failed enrichment attempt the same item waits this many milliseconds before a retry (1 hour). */
export const ENRICH_RETRY_COOLDOWN_MS = 3_600_000;

/** The worker heartbeat is stale beyond this many heartbeat intervals. */
export const HEALTH_STALE_FACTOR = 3;

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

const ALLOW_HOSTS_VARIABLE = "HAVADIS_EGRESS_ALLOW_HOSTS";

/** A set variable that is not an empty string; the empty string means unset. */
function read(env: Record<string, string | undefined>, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === "" ? undefined : value;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; variable: string; message: string };

/** Whole decimal digits only: no sign, exponent, hex, padding or fraction. Messages never echo the value. */
function integer(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
  min: number,
  max: number,
): Parsed<number> {
  const raw = read(env, name);
  if (raw === undefined) return { ok: true, value: fallback };
  const n = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    return { ok: false, variable: name, message: `${name} must be a whole decimal number from ${min} to ${max}.` };
  }
  return { ok: true, value: n };
}

function baseUrl(env: Record<string, string | undefined>): Parsed<string> {
  const name = "HAVADIS_BASE_URL";
  const fallback = "http://localhost:4000";
  const raw = read(env, name);
  if (raw === undefined) return { ok: true, value: fallback };
  const refuse = (): Parsed<string> => ({
    ok: false,
    variable: name,
    message: `${name} must be an http or https URL without credentials, query or fragment, for example https://havadis.example.`,
  });
  if (raw !== raw.trim() || /[?#]/.test(raw) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/]*@/.test(raw)) return refuse();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return refuse();
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username !== "" || url.password !== "") {
    return refuse();
  }
  return { ok: true, value: url.origin + url.pathname.replace(/\/+$/, "") };
}

function logLevel(env: Record<string, string | undefined>): Parsed<LogLevel> {
  const name = "HAVADIS_LOG_LEVEL";
  const raw = read(env, name);
  if (raw === undefined) return { ok: true, value: "info" };
  const level = LOG_LEVELS.find((candidate) => candidate === raw);
  if (level === undefined) {
    return { ok: false, variable: name, message: `${name} must be one of: ${LOG_LEVELS.join(", ")}.` };
  }
  return { ok: true, value: level };
}

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A lowercase DNS name: labels of 1-63 [a-z0-9-] not starting or ending with "-", at most 253 characters in all. */
function isDnsName(name: string): boolean {
  if (name.length === 0 || name.length > 253) return false;
  const labels = name.split(".");
  if (!labels.every((label) => DNS_LABEL.test(label))) return false;
  // A last label that is all digits or 0x-hex makes URL parsers read the host as an IPv4 number ("127.1", "0x7f.1").
  return !/^(\d+|0x[0-9a-f]*)$/.test(labels[labels.length - 1]!);
}

/** The normalised form of one allow-list entry, or null when it is not an exact hostname or literal IP. */
function normaliseHost(entry: string): string | null {
  if (/[/*@%\s]/.test(entry) || entry.includes("://")) return null;
  const bracketed = /^\[([^\]]*)\]$/.exec(entry);
  if (bracketed !== null) return isIP(bracketed[1]!) === 6 ? bracketed[1]!.toLowerCase() : null;
  if (entry.startsWith("[") || entry.endsWith("]")) return null;
  if (isIP(entry) === 6) return entry.toLowerCase();
  if (entry.includes(":")) return null;
  if (isIP(entry) === 4) return entry;
  const name = entry.toLowerCase();
  return isDnsName(name) ? name : null;
}

/**
 * Parses HAVADIS_EGRESS_ALLOW_HOSTS (D-08): a comma-separated list of exact
 * hostnames or literal IPs. No CIDR, wildcard, scheme, port, path, userinfo or
 * short-form IPv4. Unset, empty or whitespace-and-commas is an empty list.
 */
export function parseAllowHosts(
  raw: string | undefined,
): { ok: true; hosts: string[] } | { ok: false; message: string } {
  const hosts: string[] = [];
  const entries = (raw ?? "").split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");
  for (const [index, entry] of entries.entries()) {
    const host = normaliseHost(entry);
    if (host === null) {
      return {
        ok: false,
        message: `${ALLOW_HOSTS_VARIABLE} entry ${index + 1} is not an exact hostname or literal IP address (no CIDR ranges, wildcards, schemes, ports, paths, credentials or short-form IPv4).`,
      };
    }
    if (!hosts.includes(host)) hosts.push(host);
  }
  return { ok: true, hosts };
}

/** Validates the HAVADIS_* tunables and applies the documented defaults. Never throws. */
export function loadConfig(env: Record<string, string | undefined>): ConfigLoad {
  const url = baseUrl(env);
  if (!url.ok) return url;
  const ingest = integer(env, "HAVADIS_INGEST_INTERVAL_MINUTES", 15, 5, 1440);
  if (!ingest.ok) return ingest;
  // The per-CVE and KEV refresh TTL (RESEARCH A10).
  const enrich = integer(env, "HAVADIS_ENRICH_INTERVAL_HOURS", 6, 1, 168);
  if (!enrich.ok) return enrich;
  const lookups = integer(env, "HAVADIS_SSVC_MAX_LOOKUPS", 300, 0, 5000);
  if (!lookups.ok) return lookups;
  const budget = integer(env, "HAVADIS_SSVC_BUDGET_MS", 60_000, 1000, 600_000);
  if (!budget.ok) return budget;
  const concurrency = integer(env, "HAVADIS_FETCH_CONCURRENCY", 8, 1, 32);
  if (!concurrency.ok) return concurrency;
  const allow = parseAllowHosts(read(env, ALLOW_HOSTS_VARIABLE));
  if (!allow.ok) return { ok: false, variable: ALLOW_HOSTS_VARIABLE, message: allow.message };
  const level = logLevel(env);
  if (!level.ok) return level;
  return {
    ok: true,
    config: {
      baseUrl: url.value,
      ingestIntervalMs: ingest.value * 60_000,
      enrichIntervalMs: enrich.value * 3_600_000,
      ssvcMaxLookups: lookups.value,
      ssvcBudgetMs: budget.value,
      fetchConcurrency: concurrency.value,
      egressAllowHosts: allow.hosts,
      logLevel: level.value,
    },
  };
}
