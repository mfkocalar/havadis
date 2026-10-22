"use client";

import { useSyncExternalStore } from "react";
import {
  addMarks,
  DEFAULT_PREFS,
  parseMarks,
  parsePrefs,
  toggleMark,
  type Marks,
  type ReaderPrefs,
} from "@/lib/readerState";

/**
 * The reader's triage state (view prefs, read marks, flags), persisted in
 * localStorage and shared by every client component on the page.
 *
 * One module-level snapshot object is replaced on every change, so
 * `useSyncExternalStore` sees a new reference exactly when something changed.
 * Hydration contract: the server snapshot is the constant `SERVER_STATE`
 * (defaults, nothing marked), and React uses it again for the hydration pass,
 * so the first client render equals the prerendered HTML. The stored state is
 * applied on the re-render straight after.
 *
 * Every storage access is wrapped: private windows, blocked site data or a
 * full quota throw, and the page must keep working with in-memory state.
 * Other tabs stay in sync through the `storage` event.
 */

export type ReaderState = { prefs: ReaderPrefs; read: Marks; flags: Marks };

const KEYS = {
  prefs: "havadis:prefs:v1",
  read: "havadis:read:v1",
  flags: "havadis:flags:v1",
} as const;

const SERVER_STATE: ReaderState = { prefs: DEFAULT_PREFS, read: {}, flags: {} };

let state: ReaderState | null = null;
const listeners = new Set<() => void>();

function readItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable or full: keep the in-memory state for this visit.
  }
}

function load(): ReaderState {
  const now = Date.now();
  return {
    prefs: parsePrefs(readItem(KEYS.prefs)),
    read: parseMarks(readItem(KEYS.read), now),
    flags: parseMarks(readItem(KEYS.flags), now),
  };
}

function emit() {
  listeners.forEach((listener) => listener());
}

function onStorage(event: StorageEvent) {
  if (event.key === null || Object.values(KEYS).includes(event.key as (typeof KEYS)[keyof typeof KEYS])) {
    state = load();
    emit();
  }
}

function subscribe(onChange: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): ReaderState {
  state ??= load();
  return state;
}

function getServerSnapshot(): ReaderState {
  return SERVER_STATE;
}

function update(next: Partial<ReaderState>) {
  const current = getSnapshot();
  state = { ...current, ...next };
  if (next.prefs) writeItem(KEYS.prefs, next.prefs);
  if (next.read) writeItem(KEYS.read, next.read);
  if (next.flags) writeItem(KEYS.flags, next.flags);
  emit();
}

export function useReaderState(): ReaderState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export const readerActions = {
  setPrefs(patch: Partial<ReaderPrefs>) {
    update({ prefs: { ...getSnapshot().prefs, ...patch } });
  },
  toggleRead(id: string) {
    update({ read: toggleMark(getSnapshot().read, id, Date.now()) });
  },
  toggleFlag(id: string) {
    update({ flags: toggleMark(getSnapshot().flags, id, Date.now()) });
  },
  markRead(ids: readonly string[]) {
    update({ read: addMarks(getSnapshot().read, ids, Date.now()) });
  },
  resetFilters() {
    update({ prefs: DEFAULT_PREFS });
  },
};
