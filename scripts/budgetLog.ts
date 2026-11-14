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
