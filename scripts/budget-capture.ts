/**
 * Budget capture (PLAT-04, D-01): reads the `budget {` runtime log lines and
 * the CDN request records through the Vercel CLI and appends whitelisted rows
 * to a JSONL file. Hobby keeps runtime logs for one hour and rejects
 * `--since 1h`, so a local follower polls inside a window of at most 50 min,
 * records every gap and never writes a row twice.
 *
 * Usage:
 *     node --experimental-strip-types scripts/budget-capture.ts \
 *         --out <path> [--hours 24] [--interval-min 10] [--window-min 25] \
 *         [--environment production|preview] [--deployment <id>] [--once]
 *
 * Flags: --out is the JSONL file that is appended to; it must lie outside the
 * repository or be git-ignored. --hours is how long the loop runs (default
 * 24). --interval-min is the poll period (default 10). --window-min is the
 * look-back of each poll (default 25; at most 50 and at least interval + 5, so
 * consecutive polls overlap). --environment defaults to production.
 * --deployment limits the runtime query to one deployment. --once runs a single
 * poll and exits.
 *
 * Environment: VERCEL_BIN names the CLI binary (default `vercel`). The CLI is
 * run with execFile and an argument array, never a shell, and inherits
 * process.env, so VERCEL_TOKEN (or the stored login) reaches it without
 * appearing on argv. No environment value, CLI stdout or CLI stderr is ever
 * printed or written (T-21-05); only rows from rowsFromCliOutput (T-21-06), gap
 * rows with an enum reason and poll rows are appended.
 *
 * Concurrency: `<out>.lock` holds the PID of the running capture; a second
 * capture on the same file exits 2, a lock of a dead PID is taken over. A kill
 * can leave one truncated last line, which every reader skips.
 *
 * Exit codes: 0 after a clean run (or --once with a successful poll); 1 when
 * --once and the poll failed; 2 on bad arguments, an unusable --out, an old CLI
 * or a held lock.
 */
import { execFile, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  acquireLock,
  keysFromText,
  outPathProblem,
  parseSummaryRecord,
  readRows,
  releaseLock,
  rowsFromCliOutput,
  takeNew,
  validateWindow,
  type BudgetRow,
  type GapReason,
  type GapRow,
  type PollRow,
  type RequestRow,
  type Row,
} from "./budgetLog.ts";

const run = promisify(execFile);
const BIN = process.env.VERCEL_BIN ?? "vercel";
const TIMEOUT_MS = 60_000;
const MAX_BUFFER = 256 * 1024 * 1024;
const MAX_PAGES = 20;
const REPO_ROOT = path.resolve(new URL("..", import.meta.url).pathname);

function usageError(message?: string): never {
  console.error(
    message ??
      "usage: budget-capture.ts --out <path> [--hours <n>] [--interval-min <n>] [--window-min <n>] [--environment production|preview] [--deployment <id>] [--once]",
  );
  process.exit(2);
}

function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) usageError();
  return value;
}

class CliFailure extends Error {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  constructor(exitCode: number | null, timedOut: boolean) {
    super("cli failed");
    this.exitCode = exitCode;
    this.timedOut = timedOut;
  }
}

/** Runs the CLI and returns stdout; on failure throws only the exit code and a timeout flag. */
async function cli(args: string[]): Promise<string> {
  try {
    const { stdout } = await run(BIN, args, {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      encoding: "utf8",
    });
    return stdout;
  } catch (err) {
    const e = err as { code?: unknown; killed?: unknown };
    throw new CliFailure(typeof e.code === "number" ? e.code : null, e.killed === true);
  }
}

function isIgnoredByGit(absolutePath: string): boolean {
  try {
    execFileSync("git", ["-C", REPO_ROOT, "check-ignore", "-q", absolutePath], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function lastLine(text: string): string {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  return (lines[lines.length - 1] ?? "").trim();
}

function parseTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Options {
  out: string;
  environment: string;
  deployment: string | undefined;
  windowMin: number;
  intervalMin: number;
  cliVersion: string;
}

interface PollResult {
  ok: boolean;
  failCode: number | null;
}

/** All pages of one `logs` call as whitelisted rows, plus the gap rows the pages imply. */
async function readKind(
  kind: "runtime" | "requests",
  baseArgs: string[],
  window: { from: string; to: string },
): Promise<{ rows: string[]; gaps: GapRow[] }> {
  const rows: string[] = [];
  const gaps: GapRow[] = [];
  let cursor: string | null = null;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const stdout = await cli(cursor === null ? baseArgs : [...baseArgs, "--next", cursor]);
    rows.push(...rowsFromCliOutput(stdout, kind));
    let next: string | null = null;
    for (const line of stdout.split("\n")) {
      const summary = line.includes('"summary"') ? parseSummaryRecord(line) : null;
      if (summary === null) continue;
      for (const entry of summary.excluded) {
        const o = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
        gaps.push({
          k: "gap",
          from: parseTime(o.start) ?? window.from,
          to: parseTime(o.end) ?? window.to,
          reason: "excluded",
        });
      }
      next = summary.hasMore ? summary.next : null;
    }
    if (next === null) return { rows, gaps };
    cursor = next;
    if (page === MAX_PAGES) gaps.push({ k: "gap", from: window.from, to: window.to, reason: "truncated" });
  }
  return { rows, gaps };
}

async function pollOnce(
  opts: Options,
  seen: Set<string>,
  lastOkTo: number | null,
): Promise<PollResult & { lastOkTo: number | null }> {
  const to = new Date();
  const from = new Date(to.getTime() - opts.windowMin * 60_000);
  const window = { from: from.toISOString(), to: to.toISOString() };
  const poll: PollRow = {
    k: "poll",
    at: window.to,
    from: window.from,
    to: window.to,
    ok: false,
    runtime: 0,
    requests: 0,
    cli: opts.cliVersion,
  };
  const pending: Row[] = [];
  let failCode: number | null = null;
  let failed = false;

  if (lastOkTo !== null && to.getTime() - lastOkTo > (opts.windowMin - opts.intervalMin) * 60_000) {
    pending.push({ k: "gap", from: new Date(lastOkTo).toISOString(), to: window.to, reason: "missed-poll" });
  }

  const span = ["--since", `${opts.windowMin}m`, "--until", "now", "--json", "--limit", "10000"];
  const runtimeArgs = ["logs", "runtime", "--environment", opts.environment, ...span, "--query", "budget"];
  if (opts.deployment !== undefined) runtimeArgs.push("--deployment", opts.deployment);
  const requestArgs = ["logs", "requests", "--environment", opts.environment, ...span];
  const calls: Array<["runtime" | "requests", string[]]> = [
    ["runtime", runtimeArgs],
    ["requests", requestArgs],
  ];
  for (const [kind, args] of calls) {
    try {
      const result = await readKind(kind, args, window);
      const parsed = result.rows.map((line) => JSON.parse(line) as BudgetRow | RequestRow);
      if (kind === "runtime") poll.runtime = parsed.length;
      else poll.requests = parsed.length;
      pending.push(...parsed, ...result.gaps);
    } catch (err) {
      failed = true;
      const reason: GapReason = err instanceof CliFailure && err.timedOut ? "timeout" : "cli-exit";
      failCode = err instanceof CliFailure ? err.exitCode : null;
      pending.push({ k: "gap", from: window.from, to: window.to, reason });
    }
  }

  poll.ok = !failed;
  const fresh = takeNew(pending, seen);
  for (const row of fresh) appendFileSync(opts.out, `${JSON.stringify(row)}\n`);
  appendFileSync(opts.out, `${JSON.stringify(poll)}\n`);
  const added = fresh.filter((r) => r.k === "budget" || r.k === "req").length;
  console.log(`poll ${poll.ok ? "ok" : "fail"} runtime=${poll.runtime} requests=${poll.requests} new=${added}`);
  return { ok: poll.ok, failCode, lastOkTo: poll.ok ? to.getTime() : lastOkTo };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const out = flagValue(args, "--out");
  if (out === undefined) usageError();
  const environment = flagValue(args, "--environment") ?? "production";
  if (environment !== "production" && environment !== "preview") usageError();
  const deployment = flagValue(args, "--deployment");
  const hours = Number(flagValue(args, "--hours") ?? "24");
  if (!Number.isFinite(hours) || hours <= 0) usageError();
  const intervalMin = Number(flagValue(args, "--interval-min") ?? "10");
  const windowMin = Number(flagValue(args, "--window-min") ?? "25");
  const windowProblem = validateWindow(intervalMin, windowMin);
  if (windowProblem !== null) usageError(windowProblem);
  const once = args.includes("--once");

  const pathProblem = outPathProblem(out, REPO_ROOT, isIgnoredByGit);
  if (pathProblem !== null) usageError(pathProblem);

  let cliVersion: string;
  try {
    cliVersion = lastLine(await cli(["--version"]));
  } catch {
    usageError("vercel --version failed");
  }
  const major = Number(/(\d+)\.\d+\.\d+/.exec(cliVersion)?.[1] ?? "0");
  if (major < 64) usageError("vercel CLI >= 64 is required (logs runtime)");

  const lock = `${out}.lock`;
  if (!acquireLock(lock, process.pid)) usageError("another capture holds the lock");
  const release = () => releaseLock(lock, process.pid);
  const stop = () => {
    release();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const existing = existsSync(out) ? readFileSync(out, "utf8") : "";
  const seen = keysFromText(existing);
  let lastOkTo: number | null = null;
  for (const row of readRows(existing).rows) {
    if (row.k === "poll" && row.ok) lastOkTo = Math.max(lastOkTo ?? 0, Date.parse(row.to));
  }

  const opts: Options = { out, environment, deployment, windowMin, intervalMin, cliVersion };
  const startedAt = Date.now();
  const deadline = startedAt + hours * 3_600_000;
  let result: PollResult = { ok: true, failCode: null };
  for (let i = 0; ; i += 1) {
    const polled = await pollOnce(opts, seen, lastOkTo);
    lastOkTo = polled.lastOkTo;
    result = polled;
    if (once) break;
    const nextAt = startedAt + (i + 1) * intervalMin * 60_000;
    if (nextAt > deadline) break;
    await sleep(Math.max(0, nextAt - Date.now()));
  }
  release();
  if (once && !result.ok) {
    console.error(result.failCode === null ? "cli failed" : `cli failed with exit code ${result.failCode}`);
    process.exit(1);
  }
}

await main();
