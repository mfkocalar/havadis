// Skeleton for the RED commit; the arithmetic lands in the GREEN commit.
export const BACKOFF_BASE_MS = 15 * 60_000;
export const BACKOFF_MAX_MS = 6 * 3_600_000;
export const BACKOFF_JITTER_RATIO = 0.1;

export function backoffDelayMs(_failures: number, _random: () => number, _retryAfterMs: number | null): number {
  return 0;
}

export function hostKey(_url: string): string {
  return "";
}
