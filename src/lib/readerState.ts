import type { Importance, Section } from "./types.ts";

/**
 * Pure logic for the reader's own triage state: view preferences (section
 * pills, minimum importance, unread-only, flagged-only) and per-article read
 * and flag marks. The client store in `useReaderState.ts` persists these in
 * localStorage; everything here is storage-free so `node --test` can load it.
 *
 * Like `sectionFilter.ts`, this module has type-only imports, so it adds only
 * these functions to the client bundle. Article identity is the opaque `id`
 * hash from `composeFrontPage`, never a feed URL or title (T-01-07).
 */

export type ImportanceFilter = "all" | "high" | "critical";

export type ReaderPrefs = {
  sections: readonly Section[];
  minImportance: ImportanceFilter;
  unreadOnly: boolean;
  flaggedOnly: boolean;
};

/** Article id -> epoch ms when it was marked. */
export type Marks = Readonly<Record<string, number>>;

/** Only what a client component needs to decide one card's visibility. */
export type ArticleMeta = { id: string; importance: Importance };

export const DEFAULT_PREFS: ReaderPrefs = {
  sections: [],
  minImportance: "all",
  unreadOnly: false,
  flaggedOnly: false,
};

/**
 * Marks older than this are dropped on load. The page only ever shows the last
 * 24 hours, so a week keeps every on-page mark with room for a cached page,
 * while storage stays bounded however long the reader uses the site.
 */
export const MARK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const SECTIONS: ReadonlySet<string> = new Set<Section>([
  "Vulnerabilities",
  "Advisories",
  "Ransomware",
  "Breaches",
  "Threat Intelligence",
  "Tools/Techniques",
  "Industry/Policy",
]);
const IMPORTANCE_FILTERS: ReadonlySet<string> = new Set<ImportanceFilter>(["all", "high", "critical"]);

/** Parses stored prefs, falling back field by field to defaults on anything unexpected. Never throws. */
export function parsePrefs(raw: string | null): ReaderPrefs {
  let value: unknown;
  try {
    value = raw === null ? null : JSON.parse(raw);
  } catch {
    return DEFAULT_PREFS;
  }
  if (typeof value !== "object" || value === null) return DEFAULT_PREFS;
  const v = value as Record<string, unknown>;
  return {
    sections: Array.isArray(v.sections)
      ? [...new Set(v.sections.filter((s): s is Section => typeof s === "string" && SECTIONS.has(s)))]
      : DEFAULT_PREFS.sections,
    minImportance:
      typeof v.minImportance === "string" && IMPORTANCE_FILTERS.has(v.minImportance)
        ? (v.minImportance as ImportanceFilter)
        : DEFAULT_PREFS.minImportance,
    unreadOnly: v.unreadOnly === true,
    flaggedOnly: v.flaggedOnly === true,
  };
}

/** Parses stored marks, dropping malformed and expired entries. Never throws. */
export function parseMarks(raw: string | null, now: number): Marks {
  let value: unknown;
  try {
    value = raw === null ? null : JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const marks: Record<string, number> = {};
  for (const [id, at] of Object.entries(value)) {
    if (typeof at === "number" && Number.isFinite(at) && now - at < MARK_RETENTION_MS) {
      marks[id] = at;
    }
  }
  return marks;
}

/** Returns NEW marks with `id` removed when present, added at `now` when absent. */
export function toggleMark(marks: Marks, id: string, now: number): Marks {
  const next = { ...marks };
  if (id in next) {
    delete next[id];
  } else {
    next[id] = now;
  }
  return next;
}

/** Returns NEW marks with every id in `ids` marked (existing timestamps kept). */
export function addMarks(marks: Marks, ids: readonly string[], now: number): Marks {
  const next = { ...marks };
  for (const id of ids) next[id] ??= now;
  return next;
}

const RANK: Record<Importance, number> = { normal: 0, high: 1, critical: 2 };

export function meetsImportance(importance: Importance, min: ImportanceFilter): boolean {
  return min === "all" || RANK[importance] >= RANK[min];
}

/** True when any filter beyond section selection is narrowing individual cards. */
export function hasArticleFilters(prefs: ReaderPrefs): boolean {
  return prefs.minImportance !== "all" || prefs.unreadOnly || prefs.flaggedOnly;
}

export function isArticleVisible(
  article: ArticleMeta,
  prefs: ReaderPrefs,
  read: Marks,
  flags: Marks,
): boolean {
  if (!meetsImportance(article.importance, prefs.minImportance)) return false;
  if (prefs.unreadOnly && article.id in read) return false;
  if (prefs.flaggedOnly && !(article.id in flags)) return false;
  return true;
}

export function countVisible(
  articles: readonly ArticleMeta[],
  prefs: ReaderPrefs,
  read: Marks,
  flags: Marks,
): number {
  let n = 0;
  for (const a of articles) if (isArticleVisible(a, prefs, read, flags)) n++;
  return n;
}
