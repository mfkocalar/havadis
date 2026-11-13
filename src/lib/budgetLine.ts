import type { EnrichmentHealth } from "./types.ts";

// RED stub: the contract exists so the tests compile and fail on their
// assertions; the real implementation lands in the GREEN commit.

export const BUDGET_PREFIX = "budget ";
export type BudgetProducer = "edition" | "kev" | "ssvc" | "epss" | "render";
export type SsvcBudgetState = "assessed" | "not-assessed" | "failed";
export const BUDGET_KEYS = [
  "p",
  "ok",
  "ms",
  "cpuMs",
  "n",
  "bytes",
  "rcW",
  "rcR",
  "kvCmd",
] as const;
export type BudgetLine = {
  p: BudgetProducer;
  ok: 0 | 1;
  ms: number;
  cpuMs: number;
  n: number;
  bytes: number;
  rcW: number;
  rcR: number;
  kvCmd: number;
  st?: SsvcBudgetState;
};
export type BudgetCounts = {
  n: number;
  bytes: number;
  rcW: number;
  rcR?: number;
  ok?: 0 | 1;
  st?: SsvcBudgetState;
};

export function formatBudgetLine(line: BudgetLine): string {
  void line;
  return "";
}

export function parseBudgetLine(message: string): BudgetLine | null {
  void message;
  return undefined as unknown as null;
}

export async function withBudgetLine<T>(
  p: BudgetProducer,
  run: () => Promise<T>,
  describe: (value: T) => BudgetCounts,
  emit?: (line: string) => void
): Promise<T> {
  void p;
  void describe;
  void emit;
  return run();
}

export function renderReadOps(health: EnrichmentHealth): number {
  void health;
  return -1;
}
