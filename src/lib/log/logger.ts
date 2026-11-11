import { REDACTED, Secret } from "../secrets/secret.ts";

/**
 * The full Phase 14 event vocabulary, fixed here so no later plan edits this
 * file. Free text never names an event: upstream error text, feed text,
 * resolved IPs and proxy URLs stay out of log lines (D-14).
 */
export const LOG_EVENTS = [
  "startup_refused",
  "worker_started",
  "worker_stopping",
  "worker_stopped",
  "lease_claimed",
  "lease_busy",
  "cycle_started",
  "cycle_finished",
  "cycle_failed",
  "source_failed",
  "egress_denied",
  "source_backoff",
  "enrich_finished",
  "enrich_provider_failed",
  "heartbeat_failed",
  "migrate_applied",
  "migrate_noop",
  "migrate_refused",
  "backup_written",
  "backup_failed",
  "restore_refused",
  "restore_done",
  "web_db_busy",
] as const;

export type LogEvent = (typeof LOG_EVENTS)[number];
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, string | number | boolean | null | Secret>;

/** Level order: a call is written when its level is at or above the configured one. */
const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Field names whose value is never written, whatever it holds. */
const SENSITIVE_KEY = /secret|token|password|passphrase|authorization|cookie|key|webhook|proxy/i;

/** `scheme://userinfo@`: everything up to the last "@" before the first "/", "?", "#" or whitespace. */
const URL_USERINFO = /([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s/?#]*@/g;

/** Keys the logger owns; a field with the same name is dropped rather than allowed to forge them. */
const RESERVED = new Set(["ts", "level", "event"]);

/**
 * Reduces fields to primitives that are safe to write: Secret instances and
 * sensitive keys become "[REDACTED]", URL userinfo inside strings is replaced,
 * and any non-primitive value (object, array, Error) becomes "[REDACTED]" so no
 * upstream error message can reach a log line (D-14).
 */
export function redact(fields: LogFields): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [name, value] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(name) || value instanceof Secret) {
      out[name] = REDACTED;
    } else if (typeof value === "string") {
      out[name] = value.replace(URL_USERINFO, `$1${REDACTED}@`);
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      out[name] = value;
    } else {
      out[name] = REDACTED;
    }
  }
  return out;
}

/** One JSON object per line on stdout (or the injected writer); `write` receives the line without its newline. */
export function createLogger(opts: {
  level: LogLevel;
  write?: (line: string) => void;
  now?: () => number;
}): { log(level: LogLevel, event: LogEvent, fields?: LogFields): void } {
  const write = opts.write ?? ((line: string) => void process.stdout.write(`${line}\n`));
  const now = opts.now ?? Date.now;
  return {
    log(level, event, fields = {}) {
      if (LEVEL_RANK[level] < LEVEL_RANK[opts.level]) return;
      const line: Record<string, string | number | boolean | null> = {
        ts: new Date(now()).toISOString(),
        level,
        event,
      };
      for (const [name, value] of Object.entries(redact(fields))) {
        if (!RESERVED.has(name)) line[name] = value;
      }
      write(JSON.stringify(line));
    },
  };
}
