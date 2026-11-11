import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SOURCES } from "../config/sources.ts";
import { backupDatabase } from "./backup.ts";
import { loadMigrations, runMigrations } from "./migrator.ts";
import { openDb } from "./openDb.ts";
import type { DbHandle } from "./openDb.ts";
import { assertNoOtherHolder, RestoreRefused, restoreDatabase } from "./restore.ts";
import { schemaStatus } from "./schemaVersion.ts";
import { seedBuiltins } from "./seed.ts";

const NOW = Date.parse("2026-11-11T08:09:10.000Z");

type Fixture = { root: string; dataDir: string; dataFile: string; backups: string; handle: DbHandle };

/** A migrated, seeded live database in a temp data directory, with an empty backups directory beside it. */
async function withFixture(fn: (f: Fixture, close: () => Promise<void>) => Promise<void>): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "havadis-restore-"));
  const dataDir = path.join(root, "data");
  const backups = path.join(root, "backups");
  mkdirSync(dataDir);
  mkdirSync(backups);
  const dataFile = path.join(dataDir, "havadis.db");
  const handle = openDb(dataFile, "cli");
  let closed = false;
  const close = async (): Promise<void> => {
    if (!closed) {
      closed = true;
      await handle.close();
    }
  };
  try {
    await runMigrations(handle, { migrations: loadMigrations(), backup: async () => null, now: () => NOW });
    await seedBuiltins(handle.db, SOURCES, NOW);
    await fn({ root, dataDir, dataFile, backups, handle }, close);
  } finally {
    await close();
    rmSync(root, { recursive: true, force: true });
  }
}

function refusal(code: string): (err: unknown) => boolean {
  return (err) => err instanceof RestoreRefused && err.code === code;
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function count(file: string, table: string): number {
  const h = openDb(file, "cli", { readonly: true });
  try {
    return (h.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  } finally {
    h.raw.close();
  }
}

/** A child process (inline code, no helper file) that holds an idle WAL connection on `file` until killed. */
async function holdIdleConnection(file: string): Promise<ChildProcess> {
  const code = `
    const Database = require("better-sqlite3");
    const db = new Database(process.argv[1]);
    db.pragma("journal_mode = WAL");
    db.prepare("SELECT count(*) AS n FROM sources").get();
    process.stdout.write("ready\\n");
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ["-e", code, file], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  await new Promise<void>((resolve, reject) => {
    let out = "";
    let err = "";
    child.stderr!.setEncoding("utf8").on("data", (c: string) => (err += c));
    child.stdout!.setEncoding("utf8").on("data", (c: string) => {
      out += c;
      if (out.includes("ready")) resolve();
    });
    child.once("exit", (c) => reject(new Error(`holder exited early with ${String(c)}: ${err}`)));
  });
  return child;
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGKILL");
  await exited;
}

test("restore refuses with db_in_use while another process holds an idle connection, and touches nothing", async () => {
  await withFixture(async ({ dataDir, dataFile, backups, handle }, close) => {
    const backup = await backupDatabase(handle, backups, NOW, "manual");
    await close();
    const holder = await holdIdleConnection(dataFile);
    try {
      const names = readdirSync(dataDir).sort();
      const backupSum = sha256(backup);
      await assert.rejects(restoreDatabase({ file: backup, dataFile, backupsDir: backups }), refusal("db_in_use"));
      assert.deepEqual(readdirSync(dataDir).sort(), names, "no file created, moved or removed");
      assert.equal(existsSync(`${dataFile}.pre-restore`), false);
      assert.equal(sha256(backup), backupSum);
      assert.equal(count(dataFile, "sources"), SOURCES.length, "the live database is intact");
      await assert.rejects(assertNoOtherHolder(dataFile), refusal("db_in_use"));
    } finally {
      await stop(holder);
    }
    // Once the holder is gone the same probe passes.
    await assertNoOtherHolder(dataFile);
  });
});

test("a relative name resolves inside the backups directory; outside paths, symlinks, directories and missing files are refused", async () => {
  await withFixture(async ({ root, dataFile, backups, handle }, close) => {
    const backup = await backupDatabase(handle, backups, NOW, "manual");
    await close();
    const outside = path.join(root, "outside.db");
    copyFileSync(backup, outside);
    const insideLink = path.join(backups, "link-inside.db");
    symlinkSync(backup, insideLink);
    const outsideLink = path.join(root, "link-outside.db");
    symlinkSync(backup, outsideLink);
    mkdirSync(path.join(backups, "subdir"));
    // A directory symlink inside backups that points out of it must not smuggle a file in.
    symlinkSync(root, path.join(backups, "escape"));

    const attempts: Array<[string, string]> = [
      [outside, "outside_backups"],
      [path.join(backups, "..", "outside.db"), "outside_backups"],
      ["../outside.db", "outside_backups"],
      ["escape/outside.db", "outside_backups"],
      [outsideLink, "outside_backups"],
      [insideLink, "not_regular_file"],
      [path.join(backups, "subdir"), "not_regular_file"],
      ["subdir", "not_regular_file"],
      ["missing.db", "not_found"],
      [path.join(backups, "missing.db"), "not_found"],
    ];
    const before = readdirSync(path.dirname(dataFile)).sort();
    for (const [file, code] of attempts) {
      await assert.rejects(restoreDatabase({ file, dataFile, backupsDir: backups }), refusal(code), `${file} must be refused as ${code}`);
    }
    assert.deepEqual(readdirSync(path.dirname(dataFile)).sort(), before);
    assert.equal(existsSync(`${dataFile}.pre-restore`), false);

    // The bare file name is read from the backups directory.
    const result = await restoreDatabase({ file: path.basename(backup), dataFile, backupsDir: backups });
    assert.equal(result.restoredFrom, path.join(realpathSync(backups), path.basename(backup)));
  });
});

test("a backup with corrupted bytes fails integrity_check and the live database is untouched", async () => {
  await withFixture(async ({ dataFile, backups, handle }, close) => {
    const backup = await backupDatabase(handle, backups, NOW, "manual");
    await close();
    // Overwrite a stretch of table pages; the header stays valid so the file opens but does not verify.
    const fd = openSync(backup, "r+");
    try {
      writeSync(fd, Buffer.alloc(8192, 0xff), 0, 8192, 8192);
    } finally {
      closeSync(fd);
    }
    const liveSum = sha256(dataFile);
    await assert.rejects(restoreDatabase({ file: backup, dataFile, backupsDir: backups }), refusal("integrity_failed"));
    assert.equal(sha256(dataFile), liveSum);
    assert.equal(existsSync(`${dataFile}.pre-restore`), false);

    // A file that is not a database at all is refused the same way.
    const text = path.join(backups, "text.db");
    writeFileSync(text, "this is not a database file at all, just text".repeat(100));
    await assert.rejects(restoreDatabase({ file: text, dataFile, backupsDir: backups }), refusal("integrity_failed"));
  });
});

test("a backup that records a newer schema version than the image is refused", async () => {
  await withFixture(async ({ dataFile, backups, handle }, close) => {
    handle.raw
      .prepare("INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (2, 'future', 'x', '2026-11-11T08:09:10.000Z')")
      .run();
    const backup = await backupDatabase(handle, backups, NOW, "manual");
    await close();
    await assert.rejects(restoreDatabase({ file: backup, dataFile, backupsDir: backups }), refusal("backup_newer_than_image"));
    assert.equal(existsSync(`${dataFile}.pre-restore`), false);
    // The same file passes when the image is new enough.
    const ok = await restoreDatabase({ file: backup, dataFile, backupsDir: backups, latest: 2 });
    assert.ok(ok.preRestore !== null);
  });
});

test("an existing .pre-restore makes restore refuse instead of overwriting it", async () => {
  await withFixture(async ({ dataFile, backups, handle }, close) => {
    const backup = await backupDatabase(handle, backups, NOW, "manual");
    await close();
    writeFileSync(`${dataFile}.pre-restore`, "keep me");
    const liveSum = sha256(dataFile);
    await assert.rejects(restoreDatabase({ file: backup, dataFile, backupsDir: backups }), refusal("pre_restore_exists"));
    assert.equal(readFileSync(`${dataFile}.pre-restore`, "utf8"), "keep me");
    assert.equal(sha256(dataFile), liveSum);
  });
});

test("the happy path keeps the live database as .pre-restore, installs the backup with mode 0600 and leaves the backup alone", async () => {
  await withFixture(async ({ dataDir, dataFile, backups, handle }, close) => {
    const backup = await backupDatabase(handle, backups, NOW, "manual");
    // The live database moves on after the backup: one source is gone and a WAL holds recent writes.
    handle.raw.prepare("DELETE FROM sources WHERE id = ?").run(SOURCES[0]!.id);
    assert.equal(count(dataFile, "sources"), SOURCES.length - 1);
    await close();
    const backupSum = sha256(backup);

    const result = await restoreDatabase({ file: backup, dataFile, backupsDir: backups });
    assert.equal(result.restoredFrom, realpathSync(backup));
    assert.equal(result.preRestore, `${dataFile}.pre-restore`);

    assert.equal(count(dataFile, "sources"), SOURCES.length, "the restored database has the backup's rows");
    assert.equal(count(`${dataFile}.pre-restore`, "sources"), SOURCES.length - 1, "the previous database is kept intact");
    assert.equal(statSync(dataFile).mode & 0o777, 0o600);
    assert.equal(sha256(backup), backupSum, "the backup file is unchanged");
    assert.deepEqual(readdirSync(backups), [path.basename(backup)], "no sidecar or temp file is left in the backups directory");
    const names = readdirSync(dataDir).filter((n) => !n.startsWith("havadis.db."));
    assert.deepEqual(names, ["havadis.db"]);
    assert.equal(existsSync(`${dataFile}-wal`), false);
    assert.equal(existsSync(`${dataFile}-shm`), false);

    const restored = openDb(dataFile, "cli", { readonly: true });
    try {
      assert.equal(restored.raw.pragma("integrity_check", { simple: true }), "ok");
      assert.ok(["current", "pending"].includes(schemaStatus(restored.raw)));
    } finally {
      await restored.close();
    }
  });
});

test("with no live database restore installs the backup and reports no pre-restore copy; stale sidecars are removed", async () => {
  await withFixture(async ({ dataDir, dataFile, backups, handle }, close) => {
    const backup = await backupDatabase(handle, backups, NOW, "manual");
    await close();
    rmSync(dataFile, { force: true });
    rmSync(`${dataFile}-wal`, { force: true });
    rmSync(`${dataFile}-shm`, { force: true });
    writeFileSync(`${dataFile}-wal`, "stale wal from a database that no longer exists");

    const result = await restoreDatabase({ file: backup, dataFile, backupsDir: backups });
    assert.equal(result.preRestore, null);
    assert.equal(count(dataFile, "sources"), SOURCES.length);
    assert.deepEqual(readdirSync(dataDir), ["havadis.db"]);
  });
});

test("a live file SQLite cannot open is refused as live_unreadable, never replaced blind", async () => {
  await withFixture(async ({ dataFile, backups, handle }, close) => {
    const backup = await backupDatabase(handle, backups, NOW, "manual");
    await close();
    rmSync(`${dataFile}-wal`, { force: true });
    rmSync(`${dataFile}-shm`, { force: true });
    writeFileSync(dataFile, "garbage that is not a database".repeat(200));
    await assert.rejects(restoreDatabase({ file: backup, dataFile, backupsDir: backups }), refusal("live_unreadable"));
    assert.equal(existsSync(`${dataFile}.pre-restore`), false);
  });
});
