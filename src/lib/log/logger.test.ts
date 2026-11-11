import { test } from "node:test";
import assert from "node:assert/strict";
import { LOG_EVENTS, createLogger, redact } from "./logger.ts";
import type { LogFields } from "./logger.ts";
import { Secret } from "../secrets/secret.ts";

const NOW = Date.parse("2026-11-11T10:00:00.000Z");

function capture(level: "debug" | "info" | "warn" | "error" = "info") {
  const lines: string[] = [];
  const logger = createLogger({ level, write: (line) => lines.push(line), now: () => NOW });
  return { lines, logger };
}

test("one call writes one JSON object with ts, level, event and the fields", () => {
  const { lines, logger } = capture();
  logger.log("info", "cycle_started", { sources: 51, dry: false, note: "ok", none: null });
  assert.equal(lines.length, 1);
  assert.ok(!lines[0]!.includes("\n"));
  assert.deepEqual(JSON.parse(lines[0]!), {
    ts: "2026-11-11T10:00:00.000Z",
    level: "info",
    event: "cycle_started",
    sources: 51,
    dry: false,
    note: "ok",
    none: null,
  });
  assert.deepEqual(Object.keys(JSON.parse(lines[0]!)).slice(0, 3), ["ts", "level", "event"]);
});

test("levels below the configured level write nothing; at or above they do", () => {
  const info = capture("info");
  info.logger.log("debug", "heartbeat_failed");
  assert.equal(info.lines.length, 0);
  info.logger.log("info", "worker_started");
  info.logger.log("warn", "source_failed");
  info.logger.log("error", "cycle_failed");
  assert.equal(info.lines.length, 3);
  const error = capture("error");
  error.logger.log("warn", "source_failed");
  assert.equal(error.lines.length, 0);
  const debug = capture("debug");
  debug.logger.log("debug", "lease_busy");
  assert.equal(debug.lines.length, 1);
});

test("fields cannot override ts, level or event", () => {
  const { lines, logger } = capture();
  logger.log("info", "worker_started", { ts: "x", level: "y", event: "z", extra: 1 });
  const parsed = JSON.parse(lines[0]!);
  assert.equal(parsed.ts, "2026-11-11T10:00:00.000Z");
  assert.equal(parsed.level, "info");
  assert.equal(parsed.event, "worker_started");
  assert.equal(parsed.extra, 1);
});

test("the default writer appends a newline and uses the real clock", () => {
  const writes: string[] = [];
  const original = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    createLogger({ level: "info" }).log("info", "worker_started");
  } finally {
    process.stdout.write = original;
  }
  assert.equal(writes.length, 1);
  assert.ok(writes[0]!.endsWith("\n"));
  const parsed = JSON.parse(writes[0]!);
  assert.equal(parsed.event, "worker_started");
  assert.ok(Math.abs(Date.parse(parsed.ts) - Date.now()) < 5_000);
});

test("redact: a Secret value becomes [REDACTED]", () => {
  assert.deepEqual(redact({ anything: new Secret("s3cret") }), { anything: "[REDACTED]" });
});

test("redact: sensitive key names are redacted whatever the value", () => {
  const keys = [
    "secret", "client_secret", "token", "access_token", "password", "passphrase", "Authorization",
    "cookie", "set_cookie", "api_key", "key", "webhook", "slack_webhook_url", "proxy", "https_proxy",
  ];
  for (const key of keys) {
    assert.deepEqual(redact({ [key]: "visible" }), { [key]: "[REDACTED]" }, key);
    assert.deepEqual(redact({ [key]: 42 }), { [key]: "[REDACTED]" }, key);
  }
  assert.deepEqual(redact({ source_id: "heise", reason_code: "timeout", count: 3 }), {
    source_id: "heise",
    reason_code: "timeout",
    count: 3,
  });
});

test("redact: the userinfo part of any URL inside a string value is redacted", () => {
  const out = redact({
    a: "http://user:pa55@proxy.internal:3128/path",
    b: "see https://tok@example.com/x and ftp://u:p@ss@host/y done",
    c: "https://example.com/no-userinfo",
  });
  assert.equal(out.a, "http://[REDACTED]@proxy.internal:3128/path");
  assert.equal(out.b, "see https://[REDACTED]@example.com/x and ftp://[REDACTED]@host/y done");
  assert.equal(out.c, "https://example.com/no-userinfo");
});

test("redact: non-primitive values become [REDACTED] so upstream error text cannot enter a line", () => {
  const out = redact({
    obj: { message: "boom" },
    arr: ["a"],
    err: new Error("upstream said: secret feed text"),
    undef: undefined,
    fn: () => 1,
  } as unknown as LogFields);
  assert.deepEqual(out, { obj: "[REDACTED]", arr: "[REDACTED]", err: "[REDACTED]", undef: "[REDACTED]", fn: "[REDACTED]" });
});

test("a newline inside a string value stays escaped inside the single JSON line", () => {
  const { lines, logger } = capture();
  logger.log("warn", "source_failed", { note: "line1\nline2\r\nline3" });
  assert.equal(lines.length, 1);
  assert.ok(!/[\r\n]/.test(lines[0]!));
  assert.equal(JSON.parse(lines[0]!).note, "line1\nline2\r\nline3");
});

test("the Phase 14 event vocabulary is fixed and complete", () => {
  assert.deepEqual([...LOG_EVENTS], [
    "startup_refused", "worker_started", "worker_stopping", "worker_stopped", "lease_claimed", "lease_busy",
    "cycle_started", "cycle_finished", "cycle_failed", "source_failed", "egress_denied", "source_backoff",
    "enrich_finished", "enrich_provider_failed", "heartbeat_failed", "migrate_applied", "migrate_noop",
    "migrate_refused", "backup_written", "backup_failed", "restore_refused", "restore_done", "web_db_busy",
  ]);
});

test("canary: a secret passed through every field path never appears in any event's output", () => {
  const canary = "CANARY-leak-me-9d41c7";
  const { lines, logger } = capture("debug");
  const fields = {
    wrapped: new Secret(canary),
    api_token: canary,
    password: canary,
    https_proxy: `http://svc:${canary}@proxy.internal:3128`,
    target: `https://admin:${canary}@feeds.internal/rss`,
    err: new Error(`failed to fetch with ${canary}`),
    nested: { deep: canary },
    list: [canary],
    cause: new Error("outer", { cause: new Error(canary) }),
  } as unknown as LogFields;
  for (const event of LOG_EVENTS) {
    for (const level of ["debug", "info", "warn", "error"] as const) logger.log(level, event, fields);
  }
  assert.equal(lines.length, LOG_EVENTS.length * 4);
  for (const line of lines) {
    assert.ok(!line.includes(canary), line);
    assert.ok(!line.includes(Buffer.from(canary).toString("base64")), line);
  }
});
