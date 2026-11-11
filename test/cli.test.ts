import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { SOURCES } from "../src/lib/config/sources.ts";
import { openDb } from "../src/lib/db/openDb.ts";
import { dbFile } from "../src/lib/db/paths.ts";
import { generateKey, loadOperatorKey } from "../src/lib/secrets/key.ts";
import { beat } from "../src/lib/store/jobs.ts";

/**
 * The real havadis command as a child process against temp directories. Each child gets a minimal
 * environment of its own, never this process's, so a developer's proxy or HAVADIS_* variables cannot
 * leak in. The shim bin/havadis only dynamic-imports the same file inside the image.
 */

const IS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;
const FLAG = "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON";

type Run = { code: number | null; stdout: string; stderr: string; events: Array<Record<string, unknown>> };

function runCli(args: string[], env: Record<string, string>, cwd: string = process.cwd()): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [FLAG, "src/cli/havadis.ts", ...args], {
      cwd,
      env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (c: string) => (stdout += c));
    child.stderr.setEncoding("utf8").on("data", (c: string) => (stderr += c));
    child.once("error", reject);
    child.once("close", (code) => {
      const events = stdout
        .split("\n")
        .filter((line) => line.startsWith("{"))
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      resolve({ code, stdout, stderr, events });
    });
  });
}

type Dirs = { root: string; data: string; backups: string; env: Record<string, string> };

async function withDirs(fn: (d: Dirs) => Promise<void>): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "havadis-cli-"));
  const data = path.join(root, "data");
  const backups = path.join(root, "backups");
  mkdirSync(data);
  mkdirSync(backups);
  const env = { HAVADIS_DATA_DIR: data, HAVADIS_BACKUP_DIR: backups, HAVADIS_SECRET_KEY: generateKey() };
  try {
    await fn({ root, data, backups, env });
  } finally {
    chmodSync(backups, 0o700);
    rmSync(root, { recursive: true, force: true });
  }
}

function eventNames(run: Run): string[] {
  return run.events.map((e) => String(e.event));
}

function rowCount(file: string, table: string): number {
  const h = openDb(file, "cli", { readonly: true });
  try {
    return (h.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  } finally {
    h.raw.close();
  }
}

/** A child process (inline code) that holds an idle WAL connection on `file` until killed. */
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

test("migrate on a fresh directory exits 0, leaves no backup, seeds 51 sources and a second migrate is a no-op; the key is never printed", async () => {
  await withDirs(async ({ data, backups, env }) => {
    const first = await runCli(["migrate"], env);
    assert.equal(first.code, 0, first.stderr);
    assert.deepEqual(readdirSync(backups), [], "a fresh database has nothing to back up");
    assert.ok(eventNames(first).includes("migrate_applied"), first.stdout);
    assert.equal(rowCount(dbFile(data), "sources"), 51);
    assert.equal(SOURCES.length, 51);

    const second = await runCli(["migrate"], env);
    assert.equal(second.code, 0, second.stderr);
    assert.ok(eventNames(second).includes("migrate_noop"), second.stdout);
    assert.deepEqual(readdirSync(backups), [], "nothing pending means no backup");

    for (const run of [first, second]) {
      assert.ok(!run.stdout.includes(env.HAVADIS_SECRET_KEY!) && !run.stderr.includes(env.HAVADIS_SECRET_KEY!), "the key is never echoed");
    }
  });
});

test("migrate without HAVADIS_SECRET_KEY exits 1 naming the variable and creates no database", async () => {
  await withDirs(async ({ data, backups }) => {
    const run = await runCli(["migrate"], { HAVADIS_DATA_DIR: data, HAVADIS_BACKUP_DIR: backups });
    assert.equal(run.code, 1);
    assert.match(run.stderr, /HAVADIS_SECRET_KEY/);
    assert.ok(run.events.some((e) => e.event === "startup_refused" && e.reason_code === "key_missing"), run.stdout);
    assert.equal(existsSync(dbFile(data)), false);
  });
});

test("migrate with a missing backups directory exits 1 with the chown hint and creates no database", async () => {
  await withDirs(async ({ root, data, env }) => {
    const run = await runCli(["migrate"], { ...env, HAVADIS_BACKUP_DIR: path.join(root, "nope") });
    assert.equal(run.code, 1);
    assert.match(run.stderr, /sudo chown 65532:65532 backups/);
    assert.equal(existsSync(dbFile(data)), false);
  });
});

test(
  "migrate with a 0500 backups directory exits 1 with the chown hint before touching the database",
  { skip: IS_ROOT ? "mode bits do not apply to root" : false },
  async () => {
    await withDirs(async ({ data, backups, env }) => {
      chmodSync(backups, 0o500);
      const run = await runCli(["migrate"], env);
      assert.equal(run.code, 1);
      assert.match(run.stderr, /sudo chown 65532:65532 backups/);
      assert.equal(existsSync(dbFile(data)), false);
    });
  },
);

test("PLAT-10: a pending migration on an existing database is preceded by a verified backup in the backups directory", async () => {
  // The image ships one migration, so a project copy gets a second one: the real command, the real wiring.
  const proj = mkdtempSync(path.join(tmpdir(), "havadis-cli-proj-"));
  try {
    cpSync(path.join(process.cwd(), "src", "lib"), path.join(proj, "src", "lib"), { recursive: true, filter: (s) => !s.endsWith(".test.ts") });
    cpSync(path.join(process.cwd(), "src", "cli"), path.join(proj, "src", "cli"), { recursive: true });
    cpSync(path.join(process.cwd(), "package.json"), path.join(proj, "package.json"));
    symlinkSync(path.join(process.cwd(), "node_modules"), path.join(proj, "node_modules"));

    await withDirs(async ({ data, backups, env }) => {
      const first = await runCli(["migrate"], env, proj);
      assert.equal(first.code, 0, first.stderr);
      assert.deepEqual(readdirSync(backups), []);

      writeFileSync(path.join(proj, "src", "lib", "db", "migrations", "0002_marker.sql"), "CREATE TABLE marker (x INTEGER) STRICT;\n");
      const second = await runCli(["migrate"], env, proj);
      assert.equal(second.code, 0, second.stderr);
      const names = readdirSync(backups);
      assert.equal(names.length, 1, `exactly one backup, got ${names.join(",")}`);
      assert.match(names[0]!, /^havadis-\d{8}T\d{6}Z-pre-migrate-v1-to-v2\.db$/);
      const backup = path.join(backups, names[0]!);
      assert.equal(statSync(backup).mode & 0o777, 0o600);
      assert.ok(second.events.some((e) => e.event === "backup_written" && e.kind === "pre_migrate"), second.stdout);
      assert.ok(second.events.some((e) => e.event === "migrate_applied" && e.to_version === 2 && e.backed_up === true), second.stdout);

      const live = openDb(dbFile(data), "cli", { readonly: true });
      const copy = openDb(backup, "cli", { readonly: true });
      try {
        const has = (h: typeof live): boolean => h.raw.prepare("SELECT 1 FROM sqlite_master WHERE name = 'marker'").get() !== undefined;
        assert.equal(has(live), true, "the migration was applied");
        assert.equal(has(copy), false, "the backup holds the state before it");
        assert.equal(copy.raw.pragma("integrity_check", { simple: true }), "ok");
      } finally {
        live.raw.close();
        copy.raw.close();
      }
    });
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

test("backup exits 0 and prints a file that exists with mode 0600, named manual", async () => {
  await withDirs(async ({ backups, env }) => {
    assert.equal((await runCli(["migrate"], env)).code, 0);
    const run = await runCli(["backup"], env);
    assert.equal(run.code, 0, run.stderr);
    const printed = run.stdout.split("\n").filter((l) => l !== "" && !l.startsWith("{"));
    assert.equal(printed.length, 1, run.stdout);
    const file = printed[0]!;
    assert.ok(existsSync(file), `${file} exists`);
    assert.equal(path.dirname(file), backups);
    assert.match(path.basename(file), /^havadis-\d{8}T\d{6}Z-manual\.db$/);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.ok(eventNames(run).includes("backup_written"));
    assert.equal(rowCount(file, "sources"), 51);
  });
});

test("backup with no database exits 1 and writes nothing", async () => {
  await withDirs(async ({ backups, env }) => {
    const run = await runCli(["backup"], env);
    assert.equal(run.code, 1);
    assert.deepEqual(readdirSync(backups), []);
  });
});

test("restore refuses while another process holds the database, then succeeds and keeps .pre-restore once it is gone", async () => {
  await withDirs(async ({ data, env }) => {
    assert.equal((await runCli(["migrate"], env)).code, 0);
    const backup = (await runCli(["backup"], env)).stdout.split("\n").find((l) => l !== "" && !l.startsWith("{"))!;
    const live = dbFile(data);

    const holder = await holdIdleConnection(live);
    try {
      const refused = await runCli(["restore", backup], env);
      assert.equal(refused.code, 1);
      assert.match(refused.stderr, /still running/);
      assert.ok(refused.events.some((e) => e.event === "restore_refused" && e.reason_code === "db_in_use"), refused.stdout);
      assert.equal(existsSync(`${live}.pre-restore`), false);
    } finally {
      await stop(holder);
    }

    const done = await runCli(["restore", backup], env);
    assert.equal(done.code, 0, done.stderr);
    assert.ok(eventNames(done).includes("restore_done"));
    assert.match(done.stdout, /next: docker compose up -d/);
    assert.ok(existsSync(`${live}.pre-restore`));
    assert.equal(rowCount(live, "sources"), 51);
  });
});

test("restore of a file outside the backups directory exits 1 and leaves the database alone", async () => {
  await withDirs(async ({ root, data, env }) => {
    assert.equal((await runCli(["migrate"], env)).code, 0);
    const backup = (await runCli(["backup"], env)).stdout.split("\n").find((l) => l !== "" && !l.startsWith("{"))!;
    const outside = path.join(root, "outside.db");
    cpSync(backup, outside);
    const run = await runCli(["restore", outside], env);
    assert.equal(run.code, 1);
    assert.ok(run.events.some((e) => e.event === "restore_refused" && e.reason_code === "outside_backups"), run.stdout);
    assert.equal(existsSync(`${dbFile(data)}.pre-restore`), false);
  });
});

test("keygen prints exactly one key that loadOperatorKey accepts, needs no configuration and writes nothing", async () => {
  await withDirs(async ({ root, data, backups }) => {
    const run = await runCli(["keygen"], {});
    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /^[A-Za-z0-9+/]{43}=\n$/);
    assert.equal(run.stderr, "");
    assert.equal(loadOperatorKey({ HAVADIS_SECRET_KEY: run.stdout.trim() }).ok, true);
    assert.deepEqual(readdirSync(data), []);
    assert.deepEqual(readdirSync(backups), []);
    assert.deepEqual(readdirSync(root).sort(), ["backups", "data"]);
  });
});

test("selftest proves the driver loads through openDb and fts5 is compiled in", async () => {
  const run = await runCli(["selftest"], {});
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /fts5/);
});

test("healthcheck worker is 1 without a database or heartbeat, 0 after a fresh beat, 1 once the beat is stale", async () => {
  await withDirs(async ({ data, env }) => {
    assert.equal((await runCli(["healthcheck", "worker"], env)).code, 1, "no database");
    assert.equal((await runCli(["migrate"], env)).code, 0);
    assert.equal((await runCli(["healthcheck", "worker"], env)).code, 1, "no heartbeat row yet");

    const handle = openDb(dbFile(data), "cli");
    try {
      await beat(handle.db, new Date().toISOString(), "idle");
      assert.equal((await runCli(["healthcheck", "worker"], env)).code, 0, "fresh beat");
      await beat(handle.db, new Date(Date.now() - 120_000).toISOString(), "idle");
      assert.equal((await runCli(["healthcheck", "worker"], env)).code, 1, "a beat two minutes old is stale");
    } finally {
      await handle.close();
    }
  });
});

type Health = { server: Server; port: number; paths: string[]; respond: { status: number; location?: string } };

async function startHealth(): Promise<Health> {
  const paths: string[] = [];
  const respond: Health["respond"] = { status: 200 };
  const server = createServer((req, res) => {
    paths.push(`${req.method} ${req.url}`);
    res.writeHead(respond.status, respond.location ? { Location: respond.location } : {});
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  return { server, port: address.port, paths, respond };
}

test("healthcheck web exits 0 only on a 200 from 127.0.0.1, ignores HTTP_PROXY and never follows a redirect", async () => {
  const health = await startHealth();
  try {
    // A proxy that is not there: global fetch would fail with it, a fresh http.Agent does not use it.
    const env = { PORT: String(health.port), NODE_USE_ENV_PROXY: "1", HTTP_PROXY: "http://127.0.0.1:9", http_proxy: "http://127.0.0.1:9", NO_PROXY: "" };
    assert.equal((await runCli(["healthcheck", "web"], env)).code, 0);
    assert.deepEqual(health.paths, ["GET /api/health"]);

    health.respond.status = 503;
    assert.equal((await runCli(["healthcheck", "web"], env)).code, 1, "503 is unhealthy");

    health.paths.length = 0;
    health.respond.status = 302;
    health.respond.location = "/elsewhere";
    assert.equal((await runCli(["healthcheck", "web"], env)).code, 1, "a redirect is not a 200");
    assert.deepEqual(health.paths, ["GET /api/health"], "the redirect was not followed");
  } finally {
    await new Promise<void>((resolve) => health.server.close(() => resolve()));
  }
  assert.equal((await runCli(["healthcheck", "web"], { PORT: String(health.port) })).code, 1, "nothing listening");
});

test("an unknown command, a bare invocation and wrong arguments exit 2 with a usage line", async () => {
  for (const args of [["frobnicate"], [], ["restore"], ["restore", "a", "b"], ["healthcheck"], ["healthcheck", "bogus"], ["migrate", "extra"], ["keygen", "x"]]) {
    const run = await runCli(args, {});
    assert.equal(run.code, 2, `havadis ${args.join(" ")}`);
    assert.match(run.stderr, /usage: havadis migrate \| backup \| restore <file> \| keygen \| healthcheck web\|worker \| selftest/);
    assert.equal(run.stdout, "");
  }
});
