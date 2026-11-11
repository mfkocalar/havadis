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
  const winnerIndices: number[] = [];
  for (const indices of dedupeGroups(articles)) {
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
 * The union-find grouping `dedupe` runs, exposed so the ingest cycle can group stored and incoming
 * sightings the same way: each group is the ascending input indices of articles that are the same
 * story (canonical URL OR normalized title, transitively). The partition does not depend on input
 * order, because it is the connected components of an equivalence relation.
 */
export function dedupeGroups(articles: readonly Article[]): number[][] {
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

  return [...groups.values()];
}

/**
 * The lead of a group of STORED sightings: the index of the earliest `publishedAt`, a tie to the
 * higher `TIER_WEIGHT`, a further tie to the smaller `canonicalUrl`, then the smaller `sourceId`.
 *
 * The last two steps are a declared, deliberate change from v1 (user decision 2026-11-10, A):
 * `pickSurvivor` settles a full publishedAt and tier tie by the earlier input index, and stored
 * sightings have no stable input order (fan-out order and SQL row order vary between cycles and
 * reads). Comparing canonicalUrl then sourceId keeps the lead identical in every fan-out and row
 * order. `dedupe()` and `composeFrontPage` keep v1's rule unchanged. An unparseable date never wins.
 */
export function pickLead(
  articles: readonly (Article & { canonicalUrl: string; sourceId: string })[]
): number {
  let best = 0;
  for (let i = 1; i < articles.length; i++) {
    if (leadComparison(articles[i], articles[best]) < 0) best = i;
  }
  return best;
}

function leadComparison(
  a: Article & { canonicalUrl: string; sourceId: string },
  b: Article & { canonicalUrl: string; sourceId: string }
): number {
  const timeA = toComparableTime(a.publishedAt);
  const timeB = toComparableTime(b.publishedAt);
  if (timeA !== timeB) return timeA < timeB ? -1 : 1;
  const weightA = TIER_WEIGHT[a.sourceTier];
  const weightB = TIER_WEIGHT[b.sourceTier];
  if (weightA !== weightB) return weightA > weightB ? -1 : 1;
  if (a.canonicalUrl !== b.canonicalUrl) return a.canonicalUrl < b.canonicalUrl ? -1 : 1;
  if (a.sourceId !== b.sourceId) return a.sourceId < b.sourceId ? -1 : 1;
  return 0;
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
