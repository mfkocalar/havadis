/**
 * Row shapes and parsers shared by the budget capture and the recompute
 * (PLAT-04, Plan 21-02).
 *
 * Purpose: turn one line of `vercel logs runtime|requests --json` output into a
 * small row that is safe to store. Every row carries only the fields named
 * below, so no visitor value (country, user agent, IP) and no query string can
 * reach the capture file (T-21-06). The field names were pinned from one real
 * production record per kind (scripts/fixtures/budget-*-record.jsonl):
 *
 *   runtime  {"type":"log","data":{timestamp, requestId, requestPath,
 *            deploymentId, message, ...}}   message starts with `budget {`
 *   request  {"type":"request","data":{timestamp, requestId, requestPath,
 *            deploymentId, route, httpStatus, cacheResult, ...}}
 *   summary  {"type":"summary","pagination":{hasMore,next},
 *            "excludedIntervals":[...], ...}
 *
 * Every parser returns null on anything else and never throws.
 */
import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseBudgetLine, type BudgetLine } from "../src/lib/budgetLine.ts";

export interface BudgetRow {
  k: "budget";
  ts: string;
  rid: string;
  path: string;
  dep: string;
  line: BudgetLine;
}

export interface RequestRow {
  k: "req";
  ts: string;
  rid: string;
  path: string;
  route: string;
  status: number;
  cache: string;
  dep: string;
}

export interface PollRow {
  k: "poll";
  at: string;
  from: string;
  to: string;
  ok: boolean;
  runtime: number;
  requests: number;
  cli: string;
}

export type GapReason = "cli-exit" | "timeout" | "excluded" | "truncated" | "missed-poll";

/** A stretch of time the capture could not read. Never holds CLI text. */
export interface GapRow {
  k: "gap";
  from: string;
  to: string;
  reason: GapReason;
}

export type Row = BudgetRow | RequestRow | PollRow | GapRow;

export interface SummaryInfo {
  hasMore: boolean;
  next: string | null;
  excluded: unknown[];
}

type Obj = Record<string, unknown>;

function asObject(value: unknown): Obj | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Obj)
    : null;
}

/** The `data` object of a record of the given type, or null. */
function dataOf(jsonLine: string, type: string): Obj | null {
  try {
    const record = asObject(JSON.parse(jsonLine));
    if (record === null || record.type !== type) return null;
    return asObject(record.data);
  } catch {
    return null;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A stored path never carries a query string. */
function cutQuery(value: unknown): string {
  return text(value).split("?")[0];
}

export function parseRuntimeRecord(jsonLine: string): BudgetRow | null {
  const data = dataOf(jsonLine, "log");
  if (data === null || typeof data.timestamp !== "string" || typeof data.message !== "string") {
    return null;
  }
  const line = parseBudgetLine(data.message);
  if (line === null) return null;
  return {
    k: "budget",
    ts: data.timestamp,
    rid: text(data.requestId),
    path: cutQuery(data.requestPath),
    dep: text(data.deploymentId),
    line,
  };
}

export function parseRequestRecord(jsonLine: string): RequestRow | null {
  const data = dataOf(jsonLine, "request");
  if (
    data === null ||
    typeof data.timestamp !== "string" ||
    typeof data.httpStatus !== "number" ||
    !Number.isFinite(data.httpStatus)
  ) {
    return null;
  }
  return {
    k: "req",
    ts: data.timestamp,
    rid: text(data.requestId),
    path: cutQuery(data.requestPath),
    route: text(data.route),
    status: data.httpStatus,
    cache: text(data.cacheResult),
    dep: text(data.deploymentId),
  };
}

export function parseSummaryRecord(jsonLine: string): SummaryInfo | null {
  try {
    const record = asObject(JSON.parse(jsonLine));
    if (record === null || record.type !== "summary") return null;
    const pagination = asObject(record.pagination);
    return {
      hasMore: pagination?.hasMore === true,
      next: typeof pagination?.next === "string" ? pagination.next : null,
      excluded: Array.isArray(record.excludedIntervals) ? record.excludedIntervals : [],
    };
  } catch {
    return null;
  }
}

/**
 * The complete JSON lines the capture appends for one CLI call. This is the
 * pre-write whitelist: nothing outside the row fields can come out of it.
 */
export function rowsFromCliOutput(stdout: string, kind: "runtime" | "requests"): string[] {
  const parse = kind === "runtime" ? parseRuntimeRecord : parseRequestRecord;
  const rows: string[] = [];
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    const row = parse(line);
    if (row !== null) rows.push(JSON.stringify(row));
  }
  return rows;
}

const GAP_REASONS: readonly string[] = ["cli-exit", "timeout", "excluded", "truncated", "missed-poll"];

/**
 * sha1 hex over `k|ts|rid|` and the canonical payload: the budget line for a
 * budget row, the path for a request row. Two copies of one record collapse,
 * the same timestamp with another requestId does not.
 */
export function dedupeKey(row: BudgetRow | RequestRow): string {
  const payload = row.k === "budget" ? JSON.stringify(row.line) : row.path;
  return createHash("sha1").update(`${row.k}|${row.ts}|${row.rid}|${payload}`).digest("hex");
}

/** Dedupe key of any row; poll rows are never deduplicated. */
function rowKey(row: Row): string | null {
  if (row.k === "budget" || row.k === "req") return dedupeKey(row);
  if (row.k === "gap") return `gap|${row.from}|${row.to}|${row.reason}`;
  return null;
}

/** The rows whose key is not in `seen`; adds their keys to `seen`. */
export function takeNew<T extends Row>(rows: T[], seen: Set<string>): T[] {
  const fresh: T[] = [];
  for (const row of rows) {
    const key = rowKey(row);
    if (key !== null) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    fresh.push(row);
  }
  return fresh;
}

/** The dedupe keys of every valid row in an existing capture file. */
export function keysFromText(text: string): Set<string> {
  const seen = new Set<string>();
  takeNew(readRows(text).rows, seen);
  return seen;
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isStr(value: unknown): value is string {
  return typeof value === "string";
}

/** A parsed JSON value as a Row, or null when it is not exactly one of the four shapes. */
function asRow(value: unknown): Row | null {
  const o = asObject(value);
  if (o === null) return null;
  if (o.k === "budget") {
    const line = asObject(o.line);
    if (!isIso(o.ts) || !isStr(o.rid) || !isStr(o.path) || !isStr(o.dep) || line === null) return null;
    if (parseBudgetLine(`budget ${JSON.stringify(line)}`) === null) return null;
    return o as unknown as BudgetRow;
  }
  if (o.k === "req") {
    if (!isIso(o.ts) || !isStr(o.rid) || !isStr(o.path) || !isStr(o.route)) return null;
    if (typeof o.status !== "number" || !isStr(o.cache) || !isStr(o.dep)) return null;
    return o as unknown as RequestRow;
  }
  if (o.k === "poll") {
    if (!isIso(o.at) || !isIso(o.from) || !isIso(o.to) || typeof o.ok !== "boolean") return null;
    if (typeof o.runtime !== "number" || typeof o.requests !== "number" || !isStr(o.cli)) return null;
    return o as unknown as PollRow;
  }
  if (o.k === "gap") {
    if (!isIso(o.from) || !isIso(o.to) || typeof o.reason !== "string" || !GAP_REASONS.includes(o.reason)) {
      return null;
    }
    return o as unknown as GapRow;
  }
  return null;
}

/** Valid rows of a capture file. Blank lines are ignored; truncated or invalid lines are counted in skipped. */
export function readRows(text: string): { rows: Row[]; skipped: number } {
  const rows: Row[] = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let row: Row | null = null;
    try {
      row = asRow(JSON.parse(line));
    } catch {
      row = null;
    }
    if (row === null) skipped += 1;
    else rows.push(row);
  }
  return { rows, skipped };
}

/** Why the window cannot be used, or null. Hobby rejects `--since 1h`; the overlap guard is interval + 5. */
export function validateWindow(intervalMin: number, windowMin: number): string | null {
  if (!Number.isInteger(intervalMin) || intervalMin < 1) return "--interval-min must be a whole number >= 1";
  if (!Number.isInteger(windowMin) || windowMin < 1) return "--window-min must be a whole number >= 1";
  if (windowMin > 50) return "--window-min must be <= 50 (Hobby rejects --since 1h)";
  if (windowMin < intervalMin + 5) return "--window-min must be at least --interval-min + 5";
  return null;
}

/** Why the output path may not be used, or null: inside the repo it has to be git-ignored. */
export function outPathProblem(
  out: string,
  repoRoot: string,
  isIgnored: (absolutePath: string) => boolean,
): string | null {
  const abs = path.resolve(out);
  const rel = path.relative(repoRoot, abs);
  const inside = rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  if (inside && !isIgnored(abs)) return "--out is inside the repository and not git-ignored";
  return null;
}

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: string }).code === "EPERM";
  }
}

/** Takes `<out>.lock` for `pid`; false while another live process holds it, a dead holder is replaced. */
export function acquireLock(lockPath: string, pid: number): boolean {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, "wx");
      writeFileSync(fd, `${pid}\n`);
      closeSync(fd);
      return true;
    } catch (err) {
      if ((err as { code?: string }).code !== "EEXIST") throw err;
    }
    let holder = Number.NaN;
    try {
      holder = Number(readFileSync(lockPath, "utf8").trim());
    } catch {
      // the lock vanished between the two calls: try again
    }
    if (alive(holder)) return false;
    try {
      unlinkSync(lockPath);
    } catch {
      // another process took it over first
    }
  }
  return false;
}

/** Removes the lock when this PID still owns it. */
export function releaseLock(lockPath: string, pid: number): void {
  try {
    if (Number(readFileSync(lockPath, "utf8").trim()) === pid) unlinkSync(lockPath);
  } catch {
    // nothing to release
  }
}
