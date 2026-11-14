/**
 * Budget recompute (PLAT-04, D-02): turns a capture JSONL into the markdown
 * budget report (coverage, per-producer table, meters with exact 60% tripwire
 * status, write split). It refuses to print per-day numbers when the capture
 * covers too little of the period.
 *
 * Usage:
 *     node --experimental-strip-types scripts/budget-recompute.ts --in <path> \
 *         [--min-coverage 0.9] [--from <iso>] [--to <iso>] \
 *         [--allot-rc-writes 200000] [--allot-rc-reads 1000000] \
 *         [--allot-kv 500000] [--allot-cpu-s 14400]
 *
 * The period defaults to the first successful poll window start, at least 24 h
 * long, so a young capture is judged against a full day. Coverage is the union
 * of the windows of successful polls inside the period. Below --min-coverage
 * (default 0.9), including an empty file, it prints the coverage line and
 * INSUFFICIENT_COVERAGE and exits 3. Otherwise the last line is RECOMPUTE_OK.
 * The input order never changes the output.
 *
 * Exit codes: 0 report printed; 2 bad arguments or an unreadable file; 3
 * insufficient coverage.
 */
import { readFileSync } from "node:fs";
import { coverage, defaultPeriod, readRows, renderTable } from "./budgetLog.ts";

function usageError(message?: string): never {
  console.error(
    message ??
      "usage: budget-recompute.ts --in <path> [--min-coverage <0..1>] [--from <iso>] [--to <iso>] [--allot-rc-writes <n>] [--allot-rc-reads <n>] [--allot-kv <n>] [--allot-cpu-s <n>]",
  );
  process.exit(2);
}

function flagValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const value = process.argv[i + 1];
  if (value === undefined || value.startsWith("--")) usageError();
  return value;
}

function numberFlag(name: string, fallback: number): number {
  const raw = flagValue(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) usageError(`${name} must be a non-negative number`);
  return n;
}

function main(): void {
  const file = flagValue("--in");
  if (file === undefined) usageError();
  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    usageError("cannot read the input file");
  }
  const minCoverage = numberFlag("--min-coverage", 0.9);
  if (minCoverage > 1) usageError("--min-coverage must be between 0 and 1");
  const allot = {
    rcWrites: numberFlag("--allot-rc-writes", 200_000),
    rcReads: numberFlag("--allot-rc-reads", 1_000_000),
    kv: numberFlag("--allot-kv", 500_000),
    cpuS: numberFlag("--allot-cpu-s", 14_400),
  };
  const from = flagValue("--from");
  const to = flagValue("--to");
  if ((from === undefined) !== (to === undefined)) usageError("--from and --to go together");
  if (from !== undefined && to !== undefined) {
    if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) usageError("--from and --to must be ISO times");
  }

  const { rows } = readRows(source);
  const period = from !== undefined && to !== undefined ? { from, to } : defaultPeriod(rows);
  const { coveredMin, periodMin } = coverage(rows, period);
  const ratio = periodMin > 0 ? coveredMin / periodMin : 0;
  if (coveredMin <= 0 || ratio < minCoverage) {
    console.log(`coverage: ${Math.round(coveredMin)}/${Math.round(periodMin)} min (${(ratio * 100).toFixed(1)}%)`);
    console.log("INSUFFICIENT_COVERAGE");
    process.exit(3);
  }
  console.log(renderTable(rows, { period, allot }));
  console.log("RECOMPUTE_OK");
}

main();
