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

// ---- Recompute (Plan 21-03 Task 2) ----

const DAY_MIN = 1440;
const MS_PER_MIN = 60_000;

/** Runtime Cache write units of one line: each write counts once per 8 KiB of its payload (model A1). */
export function writeUnits(line: BudgetLine): number {
  return line.rcW === 0 ? 0 : line.rcW * Math.max(1, Math.ceil(line.bytes / line.rcW / 8192));
}

/**
 * Exact tripwire status in BigInt arithmetic. `total` is the amount measured
 * over `coveredMin` minutes; the projection is total * 1440 * 30 / coveredMin.
 * OVER-100 only when that is strictly above the allotment, OVER-60 only when
 * strictly above 60% of it, so exactly 60% stays OK (D-09).
 */
export function meterStatus(
  total: number,
  coveredMin: number,
  allotPerMonth: number,
): "OK" | "OVER-60" | "OVER-100" {
  const used = BigInt(Math.round(total)) * BigInt(DAY_MIN) * BigInt(30) * BigInt(MS_PER_MIN);
  const covered = BigInt(Math.round(coveredMin * MS_PER_MIN));
  const allot = BigInt(Math.round(allotPerMonth));
  if (used > covered * allot) return "OVER-100";
  if (used * BigInt(100) > covered * allot * BigInt(60)) return "OVER-60";
  return "OK";
}

function windowOf(row: PollRow): [number, number] | null {
  const from = Date.parse(row.from);
  const to = Date.parse(row.to);
  return Number.isNaN(from) || Number.isNaN(to) || to < from ? null : [from, to];
}

/** The period the recompute judges: first successful window start, at least one full day long. */
export function defaultPeriod(rows: Row[]): { from: string; to: string } | undefined {
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    if (row.k !== "poll" || !row.ok) continue;
    const w = windowOf(row);
    if (w === null) continue;
    first = Math.min(first, w[0]);
    last = Math.max(last, w[1]);
  }
  if (first === Number.POSITIVE_INFINITY) return undefined;
  return {
    from: new Date(first).toISOString(),
    to: new Date(Math.max(last, first + DAY_MIN * MS_PER_MIN)).toISOString(),
  };
}

/**
 * Minutes covered by the union of the windows of successful polls, clipped to
 * the period (default: first window start to last window end). Windows that
 * exactly touch merge; any hole, even 1 ms, is not covered.
 */
export function coverage(
  rows: Row[],
  period?: { from: string; to: string },
): { coveredMin: number; periodMin: number } {
  const windows: Array<[number, number]> = [];
  for (const row of rows) {
    if (row.k !== "poll" || !row.ok) continue;
    const w = windowOf(row);
    if (w !== null) windows.push(w);
  }
  windows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let from = period === undefined ? (windows[0]?.[0] ?? 0) : Date.parse(period.from);
  let to =
    period === undefined ? Math.max(...windows.map((w) => w[1]), from) : Date.parse(period.to);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) {
    from = 0;
    to = 0;
  }
  let covered = 0;
  let curStart = 0;
  let curEnd = Number.NEGATIVE_INFINITY;
  const flush = () => {
    if (curEnd > curStart) covered += curEnd - curStart;
  };
  for (const [s, e] of windows) {
    const cs = Math.max(s, from);
    const ce = Math.min(e, to);
    if (ce <= cs) continue;
    if (cs <= curEnd) curEnd = Math.max(curEnd, ce);
    else {
      flush();
      curStart = cs;
      curEnd = ce;
    }
  }
  flush();
  return { coveredMin: covered / MS_PER_MIN, periodMin: (to - from) / MS_PER_MIN };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : Math.ceil((sorted[mid - 1] + sorted[mid]) / 2);
}

function medianBytes(rows: Row[], producer: BudgetLine["p"]): number {
  return median(
    rows.flatMap((r) => (r.k === "budget" && r.line.p === producer && r.line.ok === 1 ? [r.line.bytes] : [])),
  );
}

const FEED_PATH = /^\/feed(\.xml|\.json|\/)/;

/**
 * Modelled Runtime Cache read units (labelled modelled, never measured): each
 * render line adds the edition and KEV payload units plus one per SSVC lookup
 * and EPSS batch (rcR - 2); each feed request answered STALE or MISS adds one
 * edition read. `known` is false when no edition size was observed.
 */
export function readUnits(rows: Row[]): { units: number; known: boolean } {
  const edBytes = medianBytes(rows, "edition");
  if (edBytes === 0) return { units: 0, known: false };
  const edUnits = Math.ceil(edBytes / 8192);
  const kevUnits = Math.ceil(medianBytes(rows, "kev") / 8192);
  let units = 0;
  for (const row of rows) {
    if (row.k === "budget" && row.line.p === "render") {
      units += edUnits + kevUnits + Math.max(0, row.line.rcR - 2);
    } else if (row.k === "req" && FEED_PATH.test(row.path) && /^(stale|miss)$/i.test(row.cache)) {
      units += edUnits;
    }
  }
  return { units, known: true };
}

export interface Allotments {
  rcWrites: number;
  rcReads: number;
  kv: number;
  cpuS: number;
}

export interface RenderOptions {
  period?: { from: string; to: string };
  allot: Allotments;
}

function sortKey(row: Row): [string, string, string] {
  const ts = row.k === "poll" ? row.at : row.k === "gap" ? row.from : row.ts;
  const key = row.k === "budget" || row.k === "req" ? dedupeKey(row) : JSON.stringify(row);
  return [ts, row.k, key];
}

function sorted(rows: Row[]): Row[] {
  const keyed = rows.map((row) => ({ row, key: sortKey(row) }));
  keyed.sort((a, b) => {
    for (let i = 0; i < 3; i += 1) {
      if (a.key[i] < b.key[i]) return -1;
      if (a.key[i] > b.key[i]) return 1;
    }
    return 0;
  });
  return takeNew(
    keyed.map((x) => x.row),
    new Set<string>(),
  );
}

function grouped(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const PRODUCER_ORDER: readonly BudgetLine["p"][] = ["edition", "kev", "ssvc", "epss", "render"];

/**
 * The markdown budget report for a capture's rows: coverage line, per-producer
 * table, meters table, write split. It does not gate on coverage (the
 * recompute does, before calling this) and never depends on input order.
 */
export function renderTable(input: Row[], opts: RenderOptions): string {
  const rows = sorted(input);
  const period = opts.period ?? defaultPeriod(rows);
  const { coveredMin, periodMin } = coverage(rows, period);
  const perDay = (total: number): number => (coveredMin > 0 ? (total * DAY_MIN) / coveredMin : 0);
  const month = (total: number): number => Math.round(perDay(total) * 30);
  const pct = periodMin > 0 ? (coveredMin / periodMin) * 100 : 0;
  const out: string[] = [];
  out.push(`coverage: ${Math.round(coveredMin)}/${Math.round(periodMin)} min (${pct.toFixed(1)}%)`);
  out.push("");

  const lines = rows.filter((r): r is BudgetRow => r.k === "budget");
  const stats = PRODUCER_ORDER.map((p) => {
    const mine = lines.filter((r) => r.line.p === p);
    return {
      p,
      lines: mine.length,
      ok: mine.filter((r) => r.line.ok === 1).length,
      fail: mine.filter((r) => r.line.ok === 0).length,
      rcW: mine.reduce((a, r) => a + r.line.rcW, 0),
      units: mine.reduce((a, r) => a + writeUnits(r.line), 0),
      bytes: medianBytes(rows, p),
      cpuMs: mine.reduce((a, r) => a + r.line.cpuMs, 0),
    };
  });
  out.push("| producer | lines/day | ok/fail | write ops/day | write units/day | median bytes | cpu s/day |");
  out.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const s of stats) {
    const cpu = `${(perDay(s.cpuMs) / 1000).toFixed(1)}${s.p === "ssvc" ? " (overlapping, not summed)" : ""}`;
    out.push(
      `| ${s.p} | ${perDay(s.lines).toFixed(1)} | ${s.ok}/${s.fail} | ${perDay(s.rcW).toFixed(1)} | ${perDay(s.units).toFixed(1)} | ${s.bytes} | ${cpu} |`,
    );
  }
  out.push("");

  const meterRow = (
    name: string,
    measured: string,
    projected: string,
    allot: number,
    shownPct: string,
    status: string,
    basis: string,
    unit = "",
  ): string =>
    `| ${name} | ${measured} | ${projected} | ${grouped(allot)}${unit} | ${grouped((allot * 60) / 100)}${unit} | ${shownPct} | ${status} | ${basis} |`;
  const share = (total: number, allot: number): string =>
    `${((month(total) / allot) * 100).toFixed(1)}%`;

  out.push("| meter | measured per day | projected 30-day month | allotment | 60% tripwire per month | % of allotment | status | basis |");
  out.push("| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |");
  const writes = stats.reduce((a, s) => a + s.units, 0);
  out.push(
    meterRow(
      "Runtime Cache writes (units)",
      perDay(writes).toFixed(1),
      grouped(month(writes)),
      opts.allot.rcWrites,
      share(writes, opts.allot.rcWrites),
      meterStatus(writes, coveredMin, opts.allot.rcWrites),
      "measured-log; units modelled (8 KB, A1)",
    ),
  );
  const reads = readUnits(rows);
  out.push(
    reads.known
      ? meterRow(
          "Runtime Cache reads (units)",
          perDay(reads.units).toFixed(1),
          grouped(month(reads.units)),
          opts.allot.rcReads,
          share(reads.units, opts.allot.rcReads),
          meterStatus(reads.units, coveredMin, opts.allot.rcReads),
          "modelled",
        )
      : meterRow(
          "Runtime Cache reads (units)",
          "n/a (no edition size observed)",
          "n/a",
          opts.allot.rcReads,
          "n/a",
          "UNKNOWN",
          "modelled",
        ),
  );
  const kv = lines.reduce((a, r) => a + r.line.kvCmd, 0);
  out.push(
    kv === 0
      ? meterRow(
          "Upstash commands",
          "not measured in product (kvCmd 0 by design)",
          "n/a",
          opts.allot.kv,
          "n/a",
          "NOT-MEASURED",
          "none in product",
        )
      : meterRow(
          "Upstash commands",
          perDay(kv).toFixed(1),
          grouped(month(kv)),
          opts.allot.kv,
          share(kv, opts.allot.kv),
          meterStatus(kv, coveredMin, opts.allot.kv),
          "measured-log",
        ),
  );
  const compose = stats.find((s) => s.p === "edition")?.cpuMs ?? 0;
  out.push(
    meterRow(
      "Active CPU, compose (edition, s)",
      (perDay(compose) / 1000).toFixed(1),
      grouped(month(compose) / 1000),
      opts.allot.cpuS,
      `${((month(compose) / 1000 / opts.allot.cpuS) * 100).toFixed(1)}%`,
      meterStatus(compose, coveredMin, opts.allot.cpuS * 1000),
      "measured-log (upper bound)",
      " s",
    ),
  );
  const kevCpu = stats.find((s) => s.p === "kev")?.cpuMs ?? 0;
  out.push("");
  out.push(
    `kev cpu: ${(perDay(kevCpu) / 1000).toFixed(1)} s/day (own line, upper bound, not added to the compose row)`,
  );
  out.push("");

  out.push("write split by producer (units):");
  for (const s of stats.filter((x) => x.p !== "render")) {
    const share100 = writes > 0 ? ((s.units / writes) * 100).toFixed(1) : "0.0";
    out.push(`- ${s.p}: ${share100}%`);
  }
  return out.join("\n");
}
