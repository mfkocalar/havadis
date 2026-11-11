import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLogger } from "./log/logger.ts";
import { openDb, type DbHandle } from "./db/openDb.ts";
import { dbFile } from "./db/paths.ts";
import { generateKey } from "./secrets/key.ts";
import { assertWebStartup } from "./webStartup.ts";

/** D-06, D-11, T-14-32: the web process refuses to start without a valid key and a current schema. */

type Harness = {
  exits: number[];
  lines: Record<string, unknown>[];
  stderr: string[];
  deps: Parameters<typeof assertWebStartup>[0];
};

function harness(env: Record<string, string | undefined>, open: () => DbHandle): Harness {
  const exits: number[] = [];
  const lines: Record<string, unknown>[] = [];
  const stderr: string[] = [];
  const logger = createLogger({ level: "debug", write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>) });
  return {
    exits,
    lines,
    stderr,
    deps: {
      env: env as NodeJS.ProcessEnv,
      exit: ((code: number) => {
        exits.push(code);
      }) as unknown as (code: number) => never,
      log: logger,
      stderr: (text: string) => void stderr.push(text),
      open,
    },
  };
}

/** An in-memory database whose schema_migrations table holds the given versions (null: no table at all). */
function memoryDb(versions: number[] | null): DbHandle {
  const handle = openDb(":memory:", "cli");
  if (versions !== null) {
    handle.raw.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL DEFAULT '')");
    for (const v of versions) handle.raw.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(v);
  }
  return handle;
}

function neverOpened(): DbHandle {
  throw new Error("the database must not be opened when an earlier check already refused");
}

const KEY = generateKey();

function refusal(h: Harness): Record<string, unknown> {
  const refused = h.lines.filter((l) => l.event === "startup_refused");
  assert.equal(refused.length, 1, "exactly one startup_refused line");
  return refused[0]!;
}

test("a valid key and a current database do not exit and log no refusal", async () => {
  const h = harness({ HAVADIS_SECRET_KEY: KEY }, () => memoryDb([1]));
  await assertWebStartup(h.deps);
  assert.deepEqual(h.exits, []);
  assert.equal(h.lines.filter((l) => l.event === "startup_refused").length, 0);
  assert.deepEqual(h.stderr, []);
});

test("a missing key exits 1 once, logs key_missing with no key value, and never opens the database", async () => {
  const h = harness({}, neverOpened);
  await assertWebStartup(h.deps);
  assert.deepEqual(h.exits, [1]);
  const line = refusal(h);
  assert.equal(line.component, "web");
  assert.equal(line.reason_code, "key_missing");
  assert.ok(h.stderr.join("").includes("HAVADIS_SECRET_KEY"), "the stderr message names the variable");
});

test("a malformed key logs key_malformed and neither the log nor stderr carries the value", async () => {
  const bad = "this-is-not-a-key-but-looks-secret-1234567890";
  const h = harness({ HAVADIS_SECRET_KEY: bad }, neverOpened);
  await assertWebStartup(h.deps);
  assert.deepEqual(h.exits, [1]);
  assert.equal(refusal(h).reason_code, "key_malformed");
  assert.ok(!JSON.stringify(h.lines).includes(bad));
  assert.ok(!h.stderr.join("").includes(bad));
});

test("an invalid config logs config_invalid with the variable name and exits 1 before the key is read", async () => {
  const h = harness({ HAVADIS_SECRET_KEY: KEY, HAVADIS_FETCH_CONCURRENCY: "banana" }, neverOpened);
  await assertWebStartup(h.deps);
  assert.deepEqual(h.exits, [1]);
  const line = refusal(h);
  assert.equal(line.reason_code, "config_invalid");
  assert.equal(line.variable, "HAVADIS_FETCH_CONCURRENCY");
  assert.ok(!JSON.stringify(h.lines).includes("banana"));
  assert.ok(h.stderr.join("").includes("HAVADIS_FETCH_CONCURRENCY"));
});

test("a database file that does not exist logs db_missing and tells the operator to run migrate", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "havadis-startup-"));
  try {
    const h = harness({ HAVADIS_SECRET_KEY: KEY }, () => openDb(dbFile(dir), "web", { readonly: true }));
    await assertWebStartup(h.deps);
    assert.deepEqual(h.exits, [1]);
    assert.equal(refusal(h).reason_code, "db_missing");
    assert.equal(h.stderr.join("").trim(), "database not found; run migrate first");
    assert.ok(!JSON.stringify(h.lines).includes(dir), "no filesystem path in the log line");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a database newer than this image logs schema_ahead", async () => {
  const h = harness({ HAVADIS_SECRET_KEY: KEY }, () => memoryDb([1, 2]));
  await assertWebStartup(h.deps);
  assert.deepEqual(h.exits, [1]);
  assert.equal(refusal(h).reason_code, "schema_ahead");
  assert.equal(
    h.stderr.join("").trim(),
    "database schema is newer than this image; use an image at least as new as the database",
  );
});

test("a database with pending migrations logs schema_pending, with or without a migrations table", async () => {
  for (const versions of [null, []]) {
    const h = harness({ HAVADIS_SECRET_KEY: KEY }, () => memoryDb(versions));
    await assertWebStartup(h.deps);
    assert.deepEqual(h.exits, [1]);
    assert.equal(refusal(h).reason_code, "schema_pending");
    assert.equal(h.stderr.join("").trim(), "run migrate first (docker compose runs the migrate service before web)");
  }
});

test("a file that is not a database logs db_unreadable, never a filesystem path or driver text", async () => {
  const h = harness({ HAVADIS_SECRET_KEY: KEY }, () => {
    throw Object.assign(new Error("file is not a database at /secret/path/havadis.db"), { code: "SQLITE_NOTADB" });
  });
  await assertWebStartup(h.deps);
  assert.deepEqual(h.exits, [1]);
  assert.equal(refusal(h).reason_code, "db_unreadable");
  assert.ok(!JSON.stringify(h.lines).includes("/secret/path"));
  assert.ok(!h.stderr.join("").includes("/secret/path"));
});

test("only the first failure is reported", async () => {
  const h = harness({ HAVADIS_FETCH_CONCURRENCY: "0" }, neverOpened);
  await assertWebStartup(h.deps);
  assert.equal(h.exits.length, 1);
  assert.equal(h.lines.filter((l) => l.event === "startup_refused").length, 1);
});
