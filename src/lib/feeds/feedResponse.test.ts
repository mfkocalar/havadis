import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { dbFile } from "../db/paths.ts";
import { loadMigrations, runMigrations } from "../db/migrator.ts";
import { openDb } from "../db/openDb.ts";
import { feedResponse } from "./feedResponse.ts";

/**
 * feedResponse's non-ready answers against the real web handle path: an unknown slug is a 404 before
 * any database read, a database with no successful cycle is a 503 with Retry-After 300 and the fixed
 * waiting text, and a busy read is a 503 with Retry-After 30 whose log line carries only the fixed
 * event and the route. The ready path (feed content, headers, last-good windows) is exercised against
 * a real production server in test/productionPage.test.ts.
 */

const WEB_DB_KEY = Symbol.for("havadis.webDb");
const holder = globalThis as unknown as Record<symbol, unknown>;
const dir = mkdtempSync(path.join(os.tmpdir(), "havadis-feed-"));
const previousDataDir = process.env.HAVADIS_DATA_DIR;

after(() => {
  delete holder[WEB_DB_KEY];
  if (previousDataDir === undefined) delete process.env.HAVADIS_DATA_DIR;
  else process.env.HAVADIS_DATA_DIR = previousDataDir;
  rmSync(dir, { recursive: true, force: true });
});

test("an unknown slug is a 404 and never opens the database", async () => {
  delete holder[WEB_DB_KEY];
  process.env.HAVADIS_DATA_DIR = path.join(dir, "does-not-exist");
  const res = await feedResponse("nope", "xml");
  assert.equal(res.status, 404);
  assert.equal(holder[WEB_DB_KEY], undefined);
});

test("before the first successful cycle a feed answers 503 with Retry-After 300 and no feed body", async () => {
  const worker = openDb(dbFile(dir), "worker");
  await runMigrations(worker, { migrations: loadMigrations(), backup: async () => null, now: () => Date.now() });
  await worker.close();
  delete holder[WEB_DB_KEY];
  process.env.HAVADIS_DATA_DIR = dir;

  for (const format of ["xml", "json"] as const) {
    const res = await feedResponse("all", format);
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("retry-after"), "300");
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    assert.equal(await res.text(), "Waiting for the first ingestion");
  }
});

test("a busy database answers 503 with Retry-After 30 and logs only the fixed event and route", async () => {
  const busy = Object.assign(new Error("database is locked: /secret/path/havadis.db"), { code: "SQLITE_BUSY" });
  holder[WEB_DB_KEY] = {
    db: new Proxy({}, {
      get() {
        throw busy;
      },
    }),
  };

  const lines: string[] = [];
  const realWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    if (text.includes("web_db_busy")) {
      lines.push(text);
      return true;
    }
    return (realWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  let res: Response;
  try {
    res = await feedResponse("critical", "json");
  } finally {
    process.stdout.write = realWrite;
  }

  assert.equal(res.status, 503);
  assert.equal(res.headers.get("retry-after"), "30");
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.equal(entry.event, "web_db_busy");
  assert.equal(entry.route, "/feed/critical.json");
  assert.ok(!lines[0]!.includes("secret"), "the driver's error text never reaches the log");
});

test("an error that is not a busy error is not swallowed", async () => {
  holder[WEB_DB_KEY] = {
    db: new Proxy({}, {
      get() {
        throw new Error("boom");
      },
    }),
  };
  await assert.rejects(feedResponse("all", "xml"), /boom/);
});
