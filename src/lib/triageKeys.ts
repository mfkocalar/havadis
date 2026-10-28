/**
 * Keyboard shortcuts for the triage pass: j / k move between visible stories,
 * f flags and r marks the focused story read. Pure key mapping only; the DOM
 * side lives in `src/components/TriageKeys.tsx`.
 */

export type TriageKeyAction = "next" | "prev" | "flag" | "read";

/** The shortcut list shown to readers, in display order. */
export const TRIAGE_KEYS: readonly { key: string; label: string }[] = [
  { key: "j", label: "next" },
  { key: "k", label: "previous" },
  { key: "f", label: "flag" },
  { key: "r", label: "read" },
];

const ACTIONS: Readonly<Record<string, TriageKeyAction>> = {
  j: "next",
  k: "prev",
  f: "flag",
  r: "read",
};

/** The subset of a KeyboardEvent the mapping reads. */
export type KeyLike = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
};

/** The subset of an event target the mapping reads. */
export type TargetLike = { tagName?: string; isContentEditable?: boolean } | null;

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** True when the key press belongs to a text field, not to the page. */
export function isTypingTarget(target: TargetLike): boolean {
  if (target === null) return false;
  return target.isContentEditable === true || TYPING_TAGS.has((target.tagName ?? "").toUpperCase());
}

/**
 * The triage action for a key press, or null when the press is not a
 * shortcut. Any modifier (including Shift) leaves the browser's own shortcuts
 * alone, and f / r ignore auto-repeat so a held key cannot toggle a mark back
 * and forth. j / k may repeat to scroll through stories.
 */
export function triageActionForKey(event: KeyLike, target: TargetLike): TriageKeyAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  if (isTypingTarget(target)) return null;
  const action = ACTIONS[event.key] ?? null;
  if (event.repeat && (action === "flag" || action === "read")) return null;
  return action;
}

/**
 * The index to move to from `current` (-1 when no story is focused yet)
 * among `count` visible stories. Stops at both ends instead of wrapping, and
 * returns -1 when there is nothing to move to.
 */
export function stepIndex(current: number, count: number, action: "next" | "prev"): number {
  if (count === 0) return -1;
  if (current < 0) return action === "next" ? 0 : count - 1;
  return action === "next" ? Math.min(current + 1, count - 1) : Math.max(current - 1, 0);
}
