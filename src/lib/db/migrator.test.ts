import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SOURCES } from "../config/sources.ts";
import { isBusyError, openDb } from "./openDb.ts";
import { loadMigrations, runMigrations } from "./migrator.ts";
import { schemaStatus } from "./schemaVersion.ts";
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
