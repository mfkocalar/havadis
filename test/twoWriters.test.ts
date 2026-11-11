import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isBusyError, openDb } from "../src/lib/db/openDb.ts";
import { loadMigrations, runMigrations } from "../src/lib/db/migrator.ts";

/**
 * Spike verdict (e) as a regression test (T-14-03): while another process holds BEGIN IMMEDIATE on
 * the database file, a web-role read returns at once, and a web-role write transaction fails with
 * SQLITE_BUSY after its 250 ms busy timeout and before the holder commits.
 *
 * The lock holder is a child process running inline code (no helper file under test/, RESEARCH
 * Pitfall 16: node --test runs every .ts under test/). Bounds are generous on purpose.
 */

const HOLD_MS = 600;

const HOLDER = `
import Database from "better-sqlite3";
const db = new Database(process.env.HAVADIS_TWO_WRITERS_DB);
db.pragma("busy_timeout = 5000");
db.exec("BEGIN IMMEDIATE");
db.prepare("INSERT INTO meta(key, value) VALUES ('holder', '1')").run();
console.log("locked");
setTimeout(() => {
  db.exec("COMMIT");
  console.log("done");
  db.close();
}, ${HOLD_MS});
`;

test("a web-role read is not blocked and a web-role write fails busy after 200 ms and before the holder commits", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "havadis-two-writers-"));
  const file = path.join(dir, "havadis.db");
  const child = spawn(process.execPath, ["--input-type=module", "-e", HOLDER], {
    cwd: process.cwd(),
    env: { ...process.env, HAVADIS_TWO_WRITERS_DB: file },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const setup = openDb(file, "worker");
    await runMigrations(setup, { migrations: loadMigrations(), backup: async () => null, now: () => Date.now() });
    await setup.close();

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));

    const deadline = Date.now() + 10_000;
    while (!stdout.includes("locked")) {
      assert.ok(Date.now() < deadline, `the holder never took the lock; stderr: ${stderr}`);
      assert.equal(child.exitCode, null, `the holder exited early; stderr: ${stderr}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const web = openDb(file, "web");
    try {
      const readStarted = performance.now();
      const row = web.raw.prepare("SELECT count(*) AS n FROM meta").get() as { n: number };
      const readMs = performance.now() - readStarted;
      assert.equal(row.n, 0, "the holder's uncommitted row is not visible");
      assert.ok(readMs < 150, `the read returned at once (took ${readMs.toFixed(0)} ms)`);

      const writeStarted = performance.now();
      let failure: unknown = null;
      try {
        await web.db.transaction().execute((trx) => trx.insertInto("meta").values({ key: "web", value: "1" }).execute());
      } catch (err) {
        failure = err;
      }
      const writeMs = performance.now() - writeStarted;
      assert.ok(isBusyError(failure), `the write failed with SQLITE_BUSY (got ${String(failure)})`);
      assert.ok(writeMs >= 200, `the write waited for the busy timeout (took ${writeMs.toFixed(0)} ms)`);
      assert.ok(writeMs < 550, `the write failed before the holder committed (took ${writeMs.toFixed(0)} ms)`);
    } finally {
      await web.close();
    }

    assert.equal(await exited, 0, `the holder exited cleanly; stderr: ${stderr}`);
    assert.ok(stdout.includes("done"));
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
