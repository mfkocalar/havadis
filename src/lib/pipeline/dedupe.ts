import type { Article } from "../types.ts";
import { TIER_WEIGHT } from "../config/ranking.ts";
import { canonicalizeUrl } from "./canonicalizeUrl.ts";
import { normalizeTitleForDedupe } from "./normalizeTitleForDedupe.ts";

/**
 * Collapses the same story arriving from more than one source into a
 * single surviving `Article` (NORM-02). Two articles are the same story if
 * EITHER their canonical URLs match OR their normalized titles match
 * (D-01) — a graph-equivalence relation, not two independent equality
 * checks, so this is implemented as path-compressed union-find over
 * article indices: two independent `Map`s (one per key type) would miss a
 * transitive chain, e.g. A shares a URL with B and C shares a title with B
 * but not directly with A (03-RESEARCH.md "Alternatives Considered").
 *
 * Runs AFTER each source's lookback window is applied (`getFrontPage.ts`'s
 * stage order; 72h or 24h by source type), so an in-window copy of a story
 * survives even when an older duplicate from another outlet has already
 * aged out of its own window.
 *
 * D-02: the winner of each group is the earliest `publishedAt`; a tie goes
 * to the higher `TIER_WEIGHT[sourceTier]`; a further tie goes to the
 * earlier position in input (source-iteration) order — so the same input
 * always yields the same survivor, deterministically.
 *
 * D-03: the collapse is silent — the returned value is the original,
 * unmodified `Article` object reference (no field is added, `url` and
 * `title` are untouched); the input array itself is never mutated.
 */
export function dedupe<T extends Article>(articles: readonly T[]): T[] {
  const parent = articles.map((_, i) => i);

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }

  function union(a: number, b: number): void {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  }

  const byUrlKey = new Map<string, number>();
  const byTitleKey = new Map<string, number>();

  articles.forEach((article, index) => {
    const urlKey = canonicalizeUrl(article.url);
    const existingUrlMatch = byUrlKey.get(urlKey);
    if (existingUrlMatch !== undefined) {
      union(index, existingUrlMatch);
    } else {
      byUrlKey.set(urlKey, index);
    }

    // An empty normalized title key (e.g. an emoji-only title) is skipped
    // entirely — it must never participate in matching, or two unrelated
    // emoji-only titles would incorrectly collapse into one story.
    const titleKey = normalizeTitleForDedupe(article.title);
    if (titleKey === "") return;
    const existingTitleMatch = byTitleKey.get(titleKey);
    if (existingTitleMatch !== undefined) {
      union(index, existingTitleMatch);
    } else {
      byTitleKey.set(titleKey, index);
    }
  });

  const groups = new Map<number, number[]>();
  articles.forEach((_, index) => {
    const root = find(index);
    const group = groups.get(root);
    if (group) {
      group.push(index);
    } else {
      groups.set(root, [index]);
    }
  });

  const winnerIndices: number[] = [];
  for (const indices of groups.values()) {
    let winner = indices[0];
    for (const candidate of indices.slice(1)) {
      winner = pickSurvivor(winner, candidate, articles);
    }
    winnerIndices.push(winner);
  }

  // Preserve the surviving winners' original relative (source-iteration)
  // order — union-find's `groups` Map iteration order is not guaranteed to
  // match input order, so an explicit sort by original index is required.
  winnerIndices.sort((a, b) => a - b);
  return winnerIndices.map((i) => articles[i]);
}

/**
 * D-02's tiebreak chain: earliest `publishedAt` wins; a non-finite
 * (unparseable) date is treated as +Infinity so it never wins over a copy
 * with a valid date. On a `publishedAt` tie, the higher `TIER_WEIGHT` wins.
 * On a further tie, the earlier original index wins — this makes the
 * comparison order-independent (calling with (a, b) or (b, a) yields the
 * same survivor).
 */
function pickSurvivor<T extends Article>(
  indexA: number,
  indexB: number,
  articles: readonly T[]
): number {
  const a = articles[indexA];
  const b = articles[indexB];

  const timeA = toComparableTime(a.publishedAt);
  const timeB = toComparableTime(b.publishedAt);
  if (timeA !== timeB) return timeA < timeB ? indexA : indexB;

  const weightA = TIER_WEIGHT[a.sourceTier];
  const weightB = TIER_WEIGHT[b.sourceTier];
  if (weightA !== weightB) return weightA > weightB ? indexA : indexB;

  return indexA < indexB ? indexA : indexB;
}

function toComparableTime(publishedAt: string): number {
  const time = new Date(publishedAt).getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}
