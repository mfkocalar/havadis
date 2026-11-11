import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SOURCES } from "../config/sources.ts";
import { assertBackupDirWritable, BACKUP_CHOWN_HINT, backupDatabase } from "./backup.ts";
import { loadMigrations, runMigrations } from "./migrator.ts";
import { openDb } from "./openDb.ts";
import type { DbHandle } from "./openDb.ts";
import { seedBuiltins } from "./seed.ts";

const NOW = Date.parse("2026-11-11T08:09:10.000Z");
const IS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;

type Fixture = { root: string; dataFile: string; backups: string; handle: DbHandle };

async function withFixture(fn: (f: Fixture) => Promise<void>): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "havadis-backup-"));
  const backups = path.join(root, "backups");
  mkdirSync(backups);
  const dataFile = path.join(root, "havadis.db");
  const handle = openDb(dataFile, "cli");
  try {
    await runMigrations(handle, { migrations: loadMigrations(), backup: async () => null, now: () => NOW });
    await seedBuiltins(handle.db, SOURCES, NOW);
    await fn({ root, dataFile, backups, handle });
  } finally {
    await handle.close();
    chmodSync(backups, 0o700);
    rmSync(root, { recursive: true, force: true });
  }
}

test("backupDatabase writes a named, 0600, integrity-checked copy with the same rows and no temporary file", async () => {
  await withFixture(async ({ backups, handle }) => {
    const out = await backupDatabase(handle, backups, NOW, "manual");
    assert.equal(out, path.join(backups, "havadis-20261111T080910Z-manual.db"));
    assert.equal(statSync(out).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(backups), ["havadis-20261111T080910Z-manual.db"]);

    const copy = openDb(out, "cli", { readonly: true });
    try {
      assert.equal(copy.raw.pragma("integrity_check", { simple: true }), "ok");
      assert.deepEqual(copy.raw.prepare("SELECT count(*) AS n FROM sources").get(), { n: SOURCES.length });
      assert.deepEqual(copy.raw.prepare("SELECT max(version) AS v FROM schema_migrations").get(), { v: 1 });
    } finally {
      await copy.close();
    }
  });
});

test("a migration label appears in the file name and labels outside [a-z0-9-] are refused", async () => {
  await withFixture(async ({ backups, handle }) => {
    const out = await backupDatabase(handle, backups, NOW, "pre-migrate-v1-to-v2");
    assert.equal(path.basename(out), "havadis-20261111T080910Z-pre-migrate-v1-to-v2.db");
    for (const bad of ["", "Manual", "a_b", "../x", "a b", "a/b"]) {
      await assert.rejects(backupDatabase(handle, backups, NOW, bad), /label/, `label ${JSON.stringify(bad)} must be refused`);
    }
    assert.deepEqual(readdirSync(backups), ["havadis-20261111T080910Z-pre-migrate-v1-to-v2.db"]);
  });
});

test("a backup succeeds while another connection holds an open read transaction (online)", async () => {
  await withFixture(async ({ dataFile, backups, handle }) => {
    const reader = openDb(dataFile, "cli", { readonly: true });
    try {
      reader.raw.exec("BEGIN");
      reader.raw.prepare("SELECT count(*) FROM sources").get();
      const out = await backupDatabase(handle, backups, NOW, "manual");
      const copy = openDb(out, "cli", { readonly: true });
      try {
        assert.equal(copy.raw.pragma("integrity_check", { simple: true }), "ok");
      } finally {
        await copy.close();
      }
    } finally {
      reader.raw.exec("ROLLBACK");
      await reader.close();
    }
  });
});

test("a failed integrity check deletes the temporary file and throws", async () => {
  await withFixture(async ({ backups, handle }) => {
    // A handle whose backup() writes garbage stands in for a copy that came out corrupt.
    const corrupt = {
      ...handle,
      raw: new Proxy(handle.raw, {
        get(target, prop) {
          if (prop === "backup") {
            return async (file: string) => {
              writeFileSync(file, "this is not a database file at all, just text".repeat(50));
              return { totalPages: 0, remainingPages: 0 };
            };
          }
          const value = Reflect.get(target, prop, target) as unknown;
          return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
      }),
    } as DbHandle;
    await assert.rejects(backupDatabase(corrupt, backups, NOW, "manual"), /integrity/);
    assert.deepEqual(readdirSync(backups), [], "neither the temp file nor a final file is left behind");
  });
});

test("assertBackupDirWritable reports a missing directory, a regular file and (non-root) a 0500 directory with the chown hint", () => {
  const root = mkdtempSync(path.join(tmpdir(), "havadis-backup-dir-"));
  try {
    const missing = path.join(root, "nope");
    const asFile = path.join(root, "file");
    writeFileSync(asFile, "x");
    const readOnly = path.join(root, "ro");
    mkdirSync(readOnly);
    chmodSync(readOnly, 0o500);

    const cases: Array<[string, boolean]> = [
      [missing, true],
      [asFile, true],
      [readOnly, !IS_ROOT],
    ];
    for (const [dir, applies] of cases) {
      if (!applies) continue;
      const result = assertBackupDirWritable(dir);
      assert.equal(result.ok, false, `${dir} must not be writable`);
      if (!result.ok) {
        assert.ok(result.message.includes(BACKUP_CHOWN_HINT), "message carries the hint");
        assert.ok(result.message.includes(dir), "message names the directory");
        assert.ok(result.message.includes("sudo chown 65532:65532 backups"));
      }
    }
    chmodSync(readOnly, 0o700);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("assertBackupDirWritable accepts a writable directory and leaves no probe file", () => {
  const root = mkdtempSync(path.join(tmpdir(), "havadis-backup-dir-"));
  try {
    assert.deepEqual(assertBackupDirWritable(root), { ok: true });
    assert.deepEqual(readdirSync(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
