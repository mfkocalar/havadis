import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SOURCES } from "../config/sources.ts";
import { isBusyError, openDb } from "./openDb.ts";
import { loadMigrations, runMigrations } from "./migrator.ts";
import { LATEST_SCHEMA_VERSION, schemaStatus } from "./schemaVersion.ts";
import { seedBuiltins } from "./seed.ts";

const NOW = Date.parse("2026-11-11T08:00:00.000Z");

function tempDbFile(): { file: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "havadis-db-"));
  return { file: path.join(dir, "havadis.db"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("tracer: a fresh file migrates to v1, seeds 51 enabled sources and is read back as current by a readonly web handle", async () => {
  const { file, cleanup } = tempDbFile();
  try {
    const writer = openDb(file, "worker");
    const result = await runMigrations(writer, { migrations: loadMigrations(), backup: async () => null, now: () => NOW });
    assert.deepEqual(result, { applied: [1], backupPath: null });

    const seeded = await seedBuiltins(writer.db, SOURCES, NOW);
    assert.equal(SOURCES.length, 51);
    assert.deepEqual(seeded, { inserted: 51, updated: 0 });
    await writer.close();

    const web = openDb(file, "web", { readonly: true });
    try {
      const row = web.raw.prepare("SELECT count(*) AS n FROM sources WHERE enabled = 1").get() as { n: number };
      assert.equal(row.n, 51);
      assert.equal(schemaStatus(web.raw), "current");
      assert.throws(
        () => web.raw.prepare("INSERT INTO meta(key, value) VALUES ('x', 'y')").run(),
        (err: unknown) => (err as { code?: string }).code === "SQLITE_READONLY",
      );
    } finally {
      await web.close();
    }
  } finally {
    cleanup();
  }
});

test("re-seed: updates every curated column, never an operator's enabled choice", async () => {
  const { file, cleanup } = tempDbFile();
  try {
    const handle = openDb(file, "worker");
    await runMigrations(handle, { migrations: loadMigrations(), backup: async () => null, now: () => NOW });
    await seedBuiltins(handle.db, SOURCES, NOW);

    const target = SOURCES[0]!;
    handle.raw.prepare("UPDATE sources SET enabled = 0 WHERE id = ?").run(target.id);

    const renamed = SOURCES.map((s) => (s.id === target.id ? { ...s, name: `${s.name} (renamed)` } : s));
    const again = await seedBuiltins(handle.db, renamed, NOW + 1000);
    assert.deepEqual(again, { inserted: 0, updated: 51 });

    const row = handle.raw.prepare("SELECT enabled, name FROM sources WHERE id = ?").get(target.id) as { enabled: number; name: string };
    assert.equal(row.enabled, 0);
    assert.equal(row.name, `${target.name} (renamed)`);

    const job = handle.raw.prepare("SELECT kind, next_run_at FROM job").all() as { kind: string; next_run_at: string }[];
    assert.deepEqual(job, [{ kind: "ingest", next_run_at: "1970-01-01T00:00:00.000Z" }]);
    const providers = handle.raw.prepare("SELECT provider FROM provider_state ORDER BY provider").all() as { provider: string }[];
    assert.deepEqual(providers.map((p) => p.provider), ["epss", "kev", "ssvc"]);
    await handle.close();
  } finally {
    cleanup();
  }
});

test("loadMigrations returns version, name and the SHA-256 of the raw file bytes", () => {
  const migrations = loadMigrations();
  assert.equal(migrations.length, readdirSync(new URL("./migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).length);
  const first = migrations[0]!;
  assert.equal(first.version, 1);
  assert.equal(first.name, "init");
  const bytes = readFileSync(new URL("./migrations/0001_init.sql", import.meta.url));
  assert.equal(first.checksum, createHash("sha256").update(bytes).digest("hex"));
});

test("isBusyError is true for SQLITE_BUSY and SQLITE_BUSY_* codes only", () => {
  assert.equal(isBusyError(Object.assign(new Error("busy"), { code: "SQLITE_BUSY" })), true);
  assert.equal(isBusyError(Object.assign(new Error("busy"), { code: "SQLITE_BUSY_SNAPSHOT" })), true);
  assert.equal(isBusyError(Object.assign(new Error("ro"), { code: "SQLITE_READONLY" })), false);
  assert.equal(isBusyError(new Error("plain")), false);
  assert.equal(isBusyError("SQLITE_BUSY"), false);
  assert.equal(isBusyError(null), false);
});

// ---------------------------------------------------------------------------------------------
// Guards: checksum, ahead-of-image, backup seam, atomicity (PLAT-10)
// ---------------------------------------------------------------------------------------------

const NOW_FN = () => NOW;
const FAKE_BACKUP = "/backups/havadis-test.db";

function memory() {
  return openDb(":memory:", "cli");
}

function refusal(code: string, message?: RegExp | string) {
  return (err: unknown) => {
    const e = err as { name?: string; code?: string; message?: string };
    assert.equal(e.name, "MigrationRefused");
    assert.equal(e.code, code);
    if (typeof message === "string") assert.equal(e.message, message);
    else if (message) assert.match(e.message ?? "", message);
    return true;
  };
}

function tableNames(raw: ReturnType<typeof memory>["raw"]): string[] {
  return (raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
}

function extra(version: number, name: string, sql: string) {
  const bytes = Buffer.from(sql, "utf8");
  return { version, name, file: `${String(version).padStart(4, "0")}_${name}.sql`, sql, checksum: createHash("sha256").update(bytes).digest("hex") };
}

test("zero pending migrations calls no backup seam and writes nothing", async () => {
  const handle = memory();
  const migrations = loadMigrations();
  await runMigrations(handle, { migrations, backup: async () => null, now: NOW_FN });
  const before = handle.raw.prepare("SELECT * FROM schema_migrations").all();
  const changesBefore = (handle.raw.prepare("SELECT total_changes() AS c").get() as { c: number }).c;

  let calls = 0;
  const result = await runMigrations(handle, { migrations, backup: async () => { calls++; return FAKE_BACKUP; }, now: NOW_FN });

  assert.equal(calls, 0);
  assert.deepEqual(result, { applied: [], backupPath: null });
  assert.deepEqual(handle.raw.prepare("SELECT * FROM schema_migrations").all(), before);
  assert.equal((handle.raw.prepare("SELECT total_changes() AS c").get() as { c: number }).c, changesBefore);
  await handle.close();
});

test("an empty list on a fresh database creates nothing and calls no backup seam", async () => {
  const handle = memory();
  let calls = 0;
  const result = await runMigrations(handle, { migrations: [], backup: async () => { calls++; return null; }, now: NOW_FN });
  assert.equal(calls, 0);
  assert.deepEqual(result, { applied: [], backupPath: null });
  assert.deepEqual(tableNames(handle.raw), []);
  await handle.close();
});

test("pending migrations call the backup seam once, with the version range, before any DDL", async () => {
  const handle = memory();
  const seen: { info: unknown; tables: string[] }[] = [];
  const result = await runMigrations(handle, {
    migrations: loadMigrations(),
    backup: async (info) => { seen.push({ info, tables: tableNames(handle.raw) }); return null; },
    now: NOW_FN,
  });
  assert.deepEqual(seen, [{ info: { fromVersion: 0, toVersion: 1 }, tables: [] }]);
  assert.deepEqual(result, { applied: [1], backupPath: null });

  const second = extra(2, "later", "CREATE TABLE later (x INTEGER) STRICT;");
  const infos: unknown[] = [];
  const upgrade = await runMigrations(handle, {
    migrations: [...loadMigrations(), second],
    backup: async (info) => { infos.push(info); return FAKE_BACKUP; },
    now: NOW_FN,
  });
  assert.deepEqual(infos, [{ fromVersion: 1, toVersion: 2 }]);
  assert.deepEqual(upgrade, { applied: [2], backupPath: FAKE_BACKUP });
  await handle.close();
});

test("a throwing backup seam refuses with backup_failed and applies nothing", async () => {
  const handle = memory();
  await assert.rejects(
    runMigrations(handle, { migrations: loadMigrations(), backup: async () => { throw new Error("disk full"); }, now: NOW_FN }),
    refusal("backup_failed", /disk full/),
  );
  assert.deepEqual(tableNames(handle.raw), []);
  await handle.close();
});

test("a null backup above version 0 is refused as backup_failed, and nothing is applied", async () => {
  const handle = memory();
  await runMigrations(handle, { migrations: loadMigrations(), backup: async () => null, now: NOW_FN });
  const second = extra(2, "later", "CREATE TABLE later (x INTEGER) STRICT;");
  await assert.rejects(
    runMigrations(handle, { migrations: [...loadMigrations(), second], backup: async () => null, now: NOW_FN }),
    refusal("backup_failed"),
  );
  assert.equal(tableNames(handle.raw).includes("later"), false);
  assert.deepEqual(
    (handle.raw.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((r) => r.version),
    [1],
  );
  await handle.close();
});

test("a CRLF-only change to an applied migration is refused as checksum_mismatch naming the file", async () => {
  const handle = memory();
  const [original] = loadMigrations();
  await runMigrations(handle, { migrations: [original!], backup: async () => null, now: NOW_FN });

  const crlf = Buffer.from(original!.sql.replace(/\n/g, "\r\n"), "utf8");
  const tampered = { ...original!, sql: crlf.toString("utf8"), checksum: createHash("sha256").update(crlf).digest("hex") };
  assert.notEqual(tampered.checksum, original!.checksum);

  let calls = 0;
  await assert.rejects(
    runMigrations(handle, { migrations: [tampered], backup: async () => { calls++; return FAKE_BACKUP; }, now: NOW_FN }),
    refusal("checksum_mismatch", /0001_init\.sql/),
  );
  assert.equal(calls, 0);
  await handle.close();
});

test("loadMigrations hashes raw bytes: the same SQL with CRLF endings has a different checksum", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "havadis-mig-"));
  try {
    writeFileSync(path.join(dir, "0001_lf.sql"), "CREATE TABLE a (x INTEGER) STRICT;\n");
    writeFileSync(path.join(dir, "0002_crlf.sql"), "CREATE TABLE a (x INTEGER) STRICT;\r\n");
    const [lf, crlf] = loadMigrations(pathToFileURL(dir + path.sep));
    assert.notEqual(lf!.checksum, crlf!.checksum);
    assert.equal(lf!.checksum, createHash("sha256").update("CREATE TABLE a (x INTEGER) STRICT;\n").digest("hex"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(".gitattributes keeps migration files byte-exact", () => {
  const attributes = readFileSync(new URL("../../../.gitattributes", import.meta.url), "utf8");
  assert.match(attributes, /^src\/lib\/db\/migrations\/\*\.sql -text$/m);
});

test("a database newer than the image is refused as schema_ahead with both versions in the message", async () => {
  const handle = memory();
  await runMigrations(handle, { migrations: loadMigrations(), backup: async () => null, now: NOW_FN });
  handle.raw
    .prepare("INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (2, 'future', 'abc', '2026-11-11T08:00:00.000Z')")
    .run();

  let calls = 0;
  await assert.rejects(
    runMigrations(handle, { migrations: loadMigrations(), backup: async () => { calls++; return FAKE_BACKUP; }, now: NOW_FN }),
    refusal("schema_ahead", "database schema v2 is newer than this image (v1); use an image at least as new as the database"),
  );
  assert.equal(calls, 0);
  await handle.close();
});

test("a migration whose SQL fails leaves no partial table and no schema_migrations row", async () => {
  const handle = memory();
  await runMigrations(handle, { migrations: loadMigrations(), backup: async () => null, now: NOW_FN });
  const broken = extra(2, "broken", "CREATE TABLE half (x INTEGER) STRICT;\nINSERT INTO no_such_table VALUES (1);");
  await assert.rejects(
    runMigrations(handle, { migrations: [...loadMigrations(), broken], backup: async () => FAKE_BACKUP, now: NOW_FN }),
    /no_such_table/,
  );
  assert.equal(tableNames(handle.raw).includes("half"), false);
  assert.deepEqual(
    (handle.raw.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((r) => r.version),
    [1],
  );
  await handle.close();
});

test("LATEST_SCHEMA_VERSION is the highest NNNN in the migrations directory", () => {
  const highest = Math.max(
    ...readdirSync(new URL("./migrations/", import.meta.url)).map((f) => /^(\d{4})_.*\.sql$/.exec(f)).filter((m) => m !== null).map((m) => Number(m![1])),
  );
  assert.equal(LATEST_SCHEMA_VERSION, highest);
});

test("schemaStatus: pending with no table, current at v1, ahead when a v2 row exists", async () => {
  const handle = memory();
  assert.equal(schemaStatus(handle.raw), "pending");
  await runMigrations(handle, { migrations: loadMigrations(), backup: async () => null, now: NOW_FN });
  assert.equal(schemaStatus(handle.raw), "current");
  handle.raw
    .prepare("INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (2, 'future', 'abc', '2026-11-11T08:00:00.000Z')")
    .run();
  assert.equal(schemaStatus(handle.raw), "ahead");
  await handle.close();
});
