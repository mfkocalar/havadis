/**
 * Per-host back-off arithmetic (SAFE-03, T-14-16). Pure: no clock, no randomness of its own, no I/O,
 * so the cycle injects `random` and the tests pin it.
 */

export const BACKOFF_BASE_MS = 15 * 60_000;
export const BACKOFF_MAX_MS = 6 * 3_600_000;
export const BACKOFF_JITTER_RATIO = 0.1;

/**
 * How long a host stays untouched after its `failures`-th consecutive failure: 15 minutes doubling
 * per failure up to 6 hours, spread by plus or minus 10% (`random()` in [0, 1]), never above 6 hours.
 * A `retryAfterMs` from the publisher raises the result when it is longer, capped at 6 hours too
 * (T-14-17); it never shortens the back-off.
 */
export function backoffDelayMs(failures: number, random: () => number, retryAfterMs: number | null): number {
  const base = Math.min(BACKOFF_BASE_MS * 2 ** (Math.max(1, failures) - 1), BACKOFF_MAX_MS);
  const jittered = Math.min(base * (1 + (random() * 2 - 1) * BACKOFF_JITTER_RATIO), BACKOFF_MAX_MS);
  const floor = retryAfterMs === null ? 0 : Math.min(retryAfterMs, BACKOFF_MAX_MS);
  return Math.round(Math.max(jittered, floor));
}

/** The back-off key of a feed URL: its lower-cased host, with the port when it is not the default. */
export function hostKey(url: string): string {
  return new URL(url).host;
}
