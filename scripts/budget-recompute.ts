/**
 * Budget recompute (PLAT-04): turns a capture JSONL into a markdown table, one
 * row per producer. This plan prints the per-producer table only.
 *
 * Usage:
 *     node --experimental-strip-types scripts/budget-recompute.ts --in <path>
 *
 * Prints `producer | lines | ok | fail | write units`, where one line's write
 * units are rcW === 0 ? 0 : rcW * Math.max(1, Math.ceil(bytes / rcW / 8192)),
 * i.e. each Runtime Cache write counts once per 8 KiB of its payload. The last
 * line printed is `RECOMPUTE_OK`.
 *
 * Exit codes: 0 on success; 2 on bad arguments or an unreadable file.
 */
import { readFileSync } from "node:fs";
import type { BudgetProducer } from "../src/lib/budgetLine.ts";
import type { BudgetRow } from "./budgetLog.ts";

const PRODUCERS: readonly BudgetProducer[] = ["edition", "kev", "ssvc", "epss", "render"];

function writeUnits(rcW: number, bytes: number): number {
  return rcW === 0 ? 0 : rcW * Math.max(1, Math.ceil(bytes / rcW / 8192));
}

function main(): void {
  const i = process.argv.indexOf("--in");
  const file = i === -1 ? undefined : process.argv[i + 1];
  if (file === undefined) {
    console.error("usage: budget-recompute.ts --in <path>");
    process.exit(2);
  }
  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    console.error("cannot read the input file");
    process.exit(2);
  }

  const totals = new Map<BudgetProducer, { lines: number; ok: number; fail: number; units: number }>(
    PRODUCERS.map((p) => [p, { lines: 0, ok: 0, fail: 0, units: 0 }]),
  );
  for (const raw of source.split("\n")) {
    if (raw.trim() === "") continue;
    let row: BudgetRow;
    try {
      row = JSON.parse(raw) as BudgetRow;
    } catch {
      continue;
    }
    if (row.k !== "budget") continue;
    const total = totals.get(row.line.p);
    if (total === undefined) continue;
    total.lines += 1;
    if (row.line.ok === 1) total.ok += 1;
    else total.fail += 1;
    total.units += writeUnits(row.line.rcW, row.line.bytes);
  }

  console.log("| producer | lines | ok | fail | write units |");
  console.log("| --- | ---: | ---: | ---: | ---: |");
  for (const [producer, t] of totals) {
    console.log(`| ${producer} | ${t.lines} | ${t.ok} | ${t.fail} | ${t.units} |`);
  }
  console.log("RECOMPUTE_OK");
}

main();
