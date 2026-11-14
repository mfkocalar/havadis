/**
 * Budget capture (PLAT-04, D-01): reads the `budget {` runtime log lines and
 * the CDN request records through the Vercel CLI and appends whitelisted rows
 * to a JSONL file. Hobby keeps runtime logs for one hour, so this has to run
 * from a local machine. This plan builds the single-poll `--once` slice; the
 * polling loop comes in Plan 21-03.
 *
 * Usage:
 *     node --experimental-strip-types scripts/budget-capture.ts --once \
 *         --out <path> [--environment production|preview] [--deployment <id>] \
 *         [--window-min <n>]
 *
 * Flags: --once is required. --out is the JSONL file that is appended to.
 * --environment defaults to production. --deployment limits the runtime query
 * to one deployment. --window-min is the look-back window in minutes (default
 * 25; Hobby rejects windows near an hour).
 *
 * Environment: VERCEL_BIN names the CLI binary (default `vercel`). The CLI is
 * run with execFile and an argument array, never a shell, and inherits
 * process.env, so VERCEL_TOKEN (or the stored login) reaches it without
 * appearing on argv. No environment value, CLI stdout or CLI stderr is ever
 * printed or written (T-21-05); only rows from rowsFromCliOutput (T-21-06) and
 * one poll row are appended.
 *
 * Exit codes: 0 after a successful poll; 1 when the CLI fails (a poll row with
 * ok false is appended and only the exit code is printed); 2 on bad arguments.
 */
import { execFile } from "node:child_process";
import { appendFileSync } from "node:fs";
import { promisify } from "node:util";
import { rowsFromCliOutput, type PollRow } from "./budgetLog.ts";

const run = promisify(execFile);
const BIN = process.env.VERCEL_BIN ?? "vercel";
const TIMEOUT_MS = 60_000;
const MAX_BUFFER = 256 * 1024 * 1024;

function usageError(): never {
  console.error(
    "usage: budget-capture.ts --once --out <path> [--environment production|preview] [--deployment <id>] [--window-min <n>]",
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

/** Runs the CLI and returns stdout; on failure throws only the exit code. */
async function cli(args: string[]): Promise<string> {
  try {
    const { stdout } = await run(BIN, args, {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      encoding: "utf8",
    });
    return stdout;
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    throw new CliFailure(typeof code === "number" ? code : null);
  }
}

class CliFailure extends Error {
  readonly exitCode: number | null;
  constructor(exitCode: number | null) {
    super("cli failed");
    this.exitCode = exitCode;
  }
}

function append(out: string, lines: string[]): void {
  for (const line of lines) appendFileSync(out, `${line}\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!args.includes("--once")) usageError();
  const out = flagValue(args, "--out");
  if (out === undefined) usageError();
  const environment = flagValue(args, "--environment") ?? "production";
  if (environment !== "production" && environment !== "preview") usageError();
  const deployment = flagValue(args, "--deployment");
  const windowMin = Number(flagValue(args, "--window-min") ?? "25");
  if (!Number.isInteger(windowMin) || windowMin < 1) usageError();

  const to = new Date();
  const from = new Date(to.getTime() - windowMin * 60_000);
  const poll: PollRow = {
    k: "poll",
    at: to.toISOString(),
    from: from.toISOString(),
    to: to.toISOString(),
    ok: false,
    runtime: 0,
    requests: 0,
    cli: "",
  };

  try {
    const version = (await cli(["--version"])).split("\n").filter((l) => l.trim() !== "");
    poll.cli = (version[version.length - 1] ?? "").trim();
    const window = ["--since", `${windowMin}m`, "--until", "now", "--json", "--limit", "10000"];
    const runtimeArgs = ["logs", "runtime", "--environment", environment, ...window, "--query", "budget"];
    if (deployment !== undefined) runtimeArgs.push("--deployment", deployment);
    const runtimeRows = rowsFromCliOutput(await cli(runtimeArgs), "runtime");
    const requestRows = rowsFromCliOutput(
      await cli(["logs", "requests", "--environment", environment, ...window]),
      "requests",
    );
    poll.ok = true;
    poll.runtime = runtimeRows.length;
    poll.requests = requestRows.length;
    append(out, [...runtimeRows, ...requestRows, JSON.stringify(poll)]);
    console.log(`captured budget=${runtimeRows.length} requests=${requestRows.length}`);
  } catch (err) {
    append(out, [JSON.stringify(poll)]);
    const code = err instanceof CliFailure ? err.exitCode : null;
    console.error(code === null ? "cli failed" : `cli failed with exit code ${code}`);
    process.exit(1);
  }
}

await main();
