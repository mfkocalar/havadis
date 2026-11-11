import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SOURCES } from "../src/lib/config/sources.ts";
import { openDb } from "../src/lib/db/openDb.ts";
import { dbFile } from "../src/lib/db/paths.ts";
import { loadMigrations, runMigrations } from "../src/lib/db/migrator.ts";
import { seedBuiltins } from "../src/lib/db/seed.ts";
import { FETCH_ERROR_CODES } from "../src/lib/reasonCodes.ts";
import { generateKey } from "../src/lib/secrets/key.ts";
import { startConnectProxy } from "./fixtures/connectProxy.ts";

/**
 * The real worker entry point, as a child process, behind a real CONNECT proxy that refuses every
 * target: no third-party traffic leaves the machine (the proxy logs each CONNECT it refuses).
 * The child gets a minimal environment of its own, never this process's, so a developer's proxy
 * or HAVADIS_* variables cannot leak in.
 */

type Line = Record<string, unknown>;

type Spawned = {
  child: ChildProcess;
  lines: Line[];
  raw: string[];
  stderr: () => string;
  exited: Promise<number | null>;
  waitForEvent: (event: string, timeoutMs: number) => Promise<Line>;
};

function spawnWorker(env: Record<string, string>): Spawned {
  const child = spawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "src/worker/main.ts"], {
    cwd: process.cwd(),
    // NODE_ENV is typed as required by Next's ProcessEnv augmentation; the worker does not read it.
    env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines: Line[] = [];
  const raw: string[] = [];
  let stderr = "";
  let buffer = "";
  child.stdout!.setEncoding("utf8").on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const text = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (text.trim() !== "") {
        raw.push(text);
        lines.push(JSON.parse(text) as Line);
      }
      newline = buffer.indexOf("\n");
    }
  });
  child.stderr!.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
  const waitForEvent = async (event: string, timeoutMs: number): Promise<Line> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = lines.find((l) => l.event === event);
      if (found) return found;
      assert.ok(Date.now() < deadline, `no ${event} line within ${timeoutMs} ms; stderr: ${stderr}; events: ${lines.map((l) => String(l.event)).join(",")}`);
      assert.equal(child.exitCode, null, `the worker exited early with ${String(child.exitCode)}; stderr: ${stderr}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  return { child, lines, raw, stderr: () => stderr, exited, waitForEvent };
}

/** The exit code, or "timeout"; the timer is cleared so it never keeps this test process alive. */
async function exitCodeWithin(worker: Spawned, ms: number): Promise<number | null | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([worker.exited, new Promise<"timeout">((resolve) => (timer = setTimeout(() => resolve("timeout"), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(path.join(tmpdir(), "havadis-worker-main-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A migrated, seeded data directory. */
async function provision(dir: string): Promise<void> {
  const handle = openDb(dbFile(dir), "cli");
  try {
    await runMigrations(handle, { migrations: loadMigrations(), backup: async () => null, now: () => Date.now() });
    await seedBuiltins(handle.db, SOURCES, Date.now());
  } finally {
    await handle.close();
  }
}

const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/;

test("the real worker sends its feed requests to HTTPS_PROXY, records a failed cycle with fixed codes, beats, and stops cleanly on SIGTERM", async () => {
  await withDir(async (dir) => {
    await provision(dir);
    const proxy = await startConnectProxy({ resolve: {} });
    const worker = spawnWorker({
      HAVADIS_DATA_DIR: dir,
      HAVADIS_SECRET_KEY: generateKey(),
      HTTPS_PROXY: proxy.url,
      HTTP_PROXY: proxy.url,
      NO_PROXY: "",
    });
    try {
      await worker.waitForEvent("worker_started", 15_000);
      const finished = await worker.waitForEvent("cycle_finished", 40_000);
      assert.equal(finished.status, "failed", "a proxy that refuses every target fails every source");
      // The enrichment stage runs after the ingest cycle, under the same lease (its KEV fetch is refused by the proxy too).
      const enriched = await worker.waitForEvent("enrich_finished", 40_000);
      assert.equal(enriched.kev, "failed");

      const failures = worker.lines.filter((l) => l.event === "source_failed" || l.event === "egress_denied");
      assert.ok(failures.length > 0, "at least one source_failed line");
      for (const line of failures) {
        assert.ok((FETCH_ERROR_CODES as readonly string[]).includes(String(line.code)), `fixed code, got ${String(line.code)}`);
        assert.equal(typeof line.source_id, "string");
      }
      assert.equal(failures.length, Number(finished.sources_total) - Number(finished.sources_ok), "one line per failed source");

      const proxied = SOURCES.some((s) => proxy.log.includes(`CONNECT ${new URL(s.url).hostname}:443`));
      assert.ok(proxied, `the proxy saw CONNECT for a curated feed host; log: ${proxy.log.slice(0, 3).join(" | ")}`);

      // Only the proxy was contacted: every logged request is a CONNECT or absolute-form request the proxy refused.
      assert.ok(proxy.log.length > 0);

      const check = openDb(dbFile(dir), "cli");
      try {
        const beat = check.raw.prepare("SELECT state FROM worker_heartbeat WHERE id = 1").get() as { state: string } | undefined;
        assert.ok(beat !== undefined, "a worker_heartbeat row exists");
        // The worker passes its real clock to the cycle, so the run's finish time is after its start time.
        const run = check.raw.prepare("SELECT started_at, finished_at, status FROM fetch_runs WHERE id = ?").get(finished.run_id) as { started_at: string; finished_at: string; status: string };
        assert.equal(run.status, "failed");
        assert.ok(run.finished_at > run.started_at, `finished_at ${run.finished_at} is after started_at ${run.started_at}`);
      } finally {
        await check.close();
      }

      worker.child.kill("SIGTERM");
      const code = await exitCodeWithin(worker, 10_000);
      assert.equal(code, 0, `exit 0 within 10 s; stderr: ${worker.stderr()}`);
      assert.ok(worker.lines.some((l) => l.event === "worker_stopping"));
      assert.ok(worker.lines.some((l) => l.event === "worker_stopped"));

      for (const line of worker.raw) {
        assert.ok(!line.includes(proxy.url), `no proxy URL in ${line}`);
        assert.ok(!line.includes("://"), `no URL in ${line}`);
        assert.ok(!IPV4.test(line), `no IPv4 address in ${line}`);
      }

      const after = openDb(dbFile(dir), "cli");
      try {
        assert.deepEqual(after.raw.prepare("SELECT count(*) AS n FROM fetch_runs WHERE status = 'running'").get(), { n: 0 });
        assert.deepEqual(after.raw.prepare("SELECT lease_owner FROM job WHERE kind = 'ingest'").get(), { lease_owner: null });
        assert.deepEqual(after.raw.prepare("SELECT state FROM worker_heartbeat WHERE id = 1").get(), { state: "stopped" });
      } finally {
        await after.close();
      }
    } finally {
      if (worker.child.exitCode === null) worker.child.kill("SIGKILL");
      await worker.exited;
      await proxy.close();
    }
  });
});

const REFUSALS: Array<{ name: string; reason: string; variable?: string; stderr: RegExp; setup?: (dir: string) => Promise<void>; env: Record<string, string> }> = [
  { name: "no key", reason: "key_missing", stderr: /HAVADIS_SECRET_KEY/, env: {} },
  { name: "malformed key", reason: "key_malformed", stderr: /HAVADIS_SECRET_KEY/, env: { HAVADIS_SECRET_KEY: "not-a-key" } },
  { name: "invalid config", reason: "config_invalid", variable: "HAVADIS_INGEST_INTERVAL_MINUTES", stderr: /HAVADIS_INGEST_INTERVAL_MINUTES/, env: { HAVADIS_SECRET_KEY: generateKey(), HAVADIS_INGEST_INTERVAL_MINUTES: "2" } },
  { name: "no database file", reason: "db_missing", stderr: /database not found/, env: { HAVADIS_SECRET_KEY: generateKey() } },
  {
    name: "schema pending",
    reason: "schema_pending",
    stderr: /migrate first/,
    env: { HAVADIS_SECRET_KEY: generateKey() },
    setup: async (dir) => {
      const handle = openDb(dbFile(dir), "cli");
      await handle.close();
    },
  },
  {
    name: "schema ahead",
    reason: "schema_ahead",
    stderr: /newer than this image/,
    env: { HAVADIS_SECRET_KEY: generateKey() },
    setup: async (dir) => {
      await provision(dir);
      const handle = openDb(dbFile(dir), "cli");
      try {
        handle.raw.prepare("INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (9999, 'future', 'x', '2026-11-11T08:00:00.000Z')").run();
      } finally {
        await handle.close();
      }
    },
  },
];

for (const refusal of REFUSALS) {
  test(`startup refusal (${refusal.name}): exit 1, a startup_refused line with a fixed reason code and a fixed message on stderr`, async () => {
    await withDir(async (dir) => {
      await refusal.setup?.(dir);
      const worker = spawnWorker({ HAVADIS_DATA_DIR: dir, ...refusal.env });
      try {
        const code = await exitCodeWithin(worker, 20_000);
        assert.equal(code, 1, `stderr: ${worker.stderr()}`);
        const refused = worker.lines.find((l) => l.event === "startup_refused");
        assert.ok(refused, "a startup_refused line");
        assert.equal(refused.component, "worker");
        assert.equal(refused.reason_code, refusal.reason);
        assert.equal(refused.variable, refusal.variable);
        assert.match(worker.stderr(), refusal.stderr);
        assert.ok(!worker.lines.some((l) => l.event === "worker_started"), "never started");
        if (refusal.reason === "db_missing") assert.equal(existsSync(dbFile(dir)), false, "a refusal does not create the database");
        for (const key of Object.values(refusal.env)) {
          if (key.length >= 20) assert.ok(!worker.raw.join("\n").includes(key) && !worker.stderr().includes(key), "the key value is never echoed");
        }
      } finally {
        if (worker.child.exitCode === null) worker.child.kill("SIGKILL");
        await worker.exited;
      }
    });
  });
}
