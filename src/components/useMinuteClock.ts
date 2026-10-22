"use client";

import { useSyncExternalStore } from "react";

/**
 * A minute-granular wall clock shared by every client timestamp on the page
 * (the bar's "Updated" text and each card's age).
 *
 * One module-level interval serves all subscribers, so a front page of ~100
 * cards runs one timer, not one per card. Read through `useSyncExternalStore`
 * rather than an effect plus state: this repo's `react-hooks/set-state-in-effect`
 * rule rejects a mount flag, and `react-hooks/purity` rejects reading the clock
 * in render (04-RESEARCH.md Pitfall 3).
 *
 * Hydration contract: the server snapshot is `null`, and React uses it again
 * for the hydration pass, so the first client render matches the server HTML.
 * React then re-renders with the real minute. Callers render a deterministic,
 * clock-free label for `null`.
 */

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(onTick: () => void) {
  listeners.add(onTick);
  timer ??= setInterval(() => listeners.forEach((listener) => listener()), 60_000);
  return () => {
    listeners.delete(onTick);
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** The only clock read; it stays outside render. */
function getMinute(): number {
  return Math.floor(Date.now() / 60_000) * 60_000;
}

function getServerMinute(): number | null {
  return null;
}

/** The current minute (epoch ms) on the client, or `null` on the server and during hydration. */
export function useMinuteClock(): number | null {
  return useSyncExternalStore<number | null>(subscribe, getMinute, getServerMinute);
}
