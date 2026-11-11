import { classify } from "../pipeline/classify.ts";
import { dedupeGroups, pickLead } from "../pipeline/dedupe.ts";
import { extractCves } from "../pipeline/extractCves.ts";
import { scoreImportance } from "../pipeline/importance.ts";
import type { StoredArticle } from "../store/articles.ts";
import type { Article, Importance, Section } from "../types.ts";

/**
 * Pure sticky-story planning. Stored and incoming sightings are grouped with v1's rule (canonical
 * URL OR normalized title, transitively), then each group is tied to one story that keeps its UUID
 * for life: a group with no story gets a new one, a group with one keeps it, and a group that links
 * several keeps the oldest and merges the rest (merge-only, a story is never split or deleted).
 *
 * Known limit (RESEARCH Pitfall 20): v1's grouping is transitive and a sticky merge is permanent,
 * so one bad link merges two stories for good. The cycle reports `storiesMerged` so merges stay
 * auditable; Phase 18 replaces the grouping with guarded clustering.
 */

/** A sighting that has no articles row yet. */
export type IncomingSighting = Article & { sourceId: string; canonicalUrl: string };

export type DerivedStory = {
  storyId: string;
  /** The in-window lead sighting the derived fields were computed from. */
  lead: { sourceId: string; canonicalUrl: string };
  section: Section;
  importance: Importance;
  importanceReason: string | null;
  cves: string[];
  /** True when a sighting joined or a merge landed, so last_activity_at moves to now. */
  joined: boolean;
};

export type DerivePlan = {
  newStories: Array<{ id: string; firstSeenAt: string }>;
  /** `loser` is merged into `survivor`; the loser's articles are re-pointed by the writer. */
  merges: Array<{ loser: string; survivor: string }>;
  /** Where each incoming sighting goes, keyed by its (sourceId, canonicalUrl). */
  assignments: Array<{ sourceId: string; canonicalUrl: string; storyId: string }>;
  derived: DerivedStory[];
};

type Sighting = StoredArticle | IncomingSighting;

/** An ISO millisecond string sorts chronologically; a story with no known first_seen_at sorts last. */
function firstSeenKey(storyId: string, firstSeen: ReadonlyMap<string, string>): string {
  return firstSeen.get(storyId) ?? "￿";
}

export function planStories(
  input: {
    stored: readonly StoredArticle[];
    incoming: readonly IncomingSighting[];
    storyFirstSeen: ReadonlyMap<string, string>;
  },
  newId: () => string,
  now: number,
): DerivePlan {
  const { stored, incoming, storyFirstSeen } = input;
  const nowIso = new Date(now).toISOString();
  const all: Sighting[] = [...stored, ...incoming];
  const groups = dedupeGroups(all);

  // A story never splits: groups that hold members of the same stored story are one group, even if
  // the link between those members has aged out of the window.
  const parent = groups.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const groupOfStory = new Map<string, number>();
  groups.forEach((indices, groupIndex) => {
    for (const index of indices) {
      if (index >= stored.length) continue;
      const storyId = stored[index]!.storyId;
      const seen = groupOfStory.get(storyId);
      if (seen === undefined) groupOfStory.set(storyId, groupIndex);
      else if (find(seen) !== find(groupIndex)) parent[find(groupIndex)] = find(seen);
    }
  });
  const combined = new Map<number, number[]>();
  groups.forEach((indices, groupIndex) => {
    const root = find(groupIndex);
    combined.set(root, [...(combined.get(root) ?? []), ...indices]);
  });

  const resolved = [...combined.values()].map((indices) => {
    const members = indices.map((i) => all[i]!);
    const lead = members[pickLead(members)]!;
    return { indices, members, lead };
  });
  // New story ids are allocated in a fan-out-independent order.
  resolved.sort((a, b) => {
    const keyA = `${a.lead.canonicalUrl}\n${a.lead.sourceId}`;
    const keyB = `${b.lead.canonicalUrl}\n${b.lead.sourceId}`;
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });

  const plan: DerivePlan = { newStories: [], merges: [], assignments: [], derived: [] };
  for (const { indices, lead } of resolved) {
    const storyIds = [...new Set(indices.filter((i) => i < stored.length).map((i) => stored[i]!.storyId))];
    let survivor: string;
    if (storyIds.length === 0) {
      survivor = newId();
      plan.newStories.push({ id: survivor, firstSeenAt: nowIso });
    } else {
      storyIds.sort((a, b) => {
        const keyA = firstSeenKey(a, storyFirstSeen);
        const keyB = firstSeenKey(b, storyFirstSeen);
        if (keyA !== keyB) return keyA < keyB ? -1 : 1;
        return a < b ? -1 : a > b ? 1 : 0;
      });
      survivor = storyIds[0]!;
      for (const loser of storyIds.slice(1)) plan.merges.push({ loser, survivor });
    }

    let joined = storyIds.length !== 1;
    for (const index of indices) {
      if (index < stored.length) continue;
      const sighting = incoming[index - stored.length]!;
      plan.assignments.push({ sourceId: sighting.sourceId, canonicalUrl: sighting.canonicalUrl, storyId: survivor });
      joined = true;
    }

    // Same stage order as composeFrontPage: classify, extractCves, scoreImportance on the lead.
    const section = classify(lead);
    const cves = extractCves(lead);
    const { importance, reason } = scoreImportance(lead, section, cves);
    plan.derived.push({
      storyId: survivor,
      lead: { sourceId: lead.sourceId, canonicalUrl: lead.canonicalUrl },
      section,
      importance,
      importanceReason: reason,
      cves,
      joined,
    });
  }
  return plan;
}
