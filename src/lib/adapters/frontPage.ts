import type { Kysely, Selectable } from "kysely";
import type { Database, CveSignalsTable } from "../db/schema.ts";
import { kevHealth, uniqueCves } from "../enrichment/display.ts";
import { pickLead } from "../pipeline/dedupe.ts";
import { articleId } from "../pipeline/articleId.ts";
import { extractCves } from "../pipeline/extractCves.ts";
import { groupBySection } from "../pipeline/groupBySection.ts";
import { readLastGood, readSourceAnchors, selectInWindowArticles } from "../store/articles.ts";
import type { StoredArticle } from "../store/articles.ts";
import type {
  ClassifiedArticle,
  CveEnrichment,
  EnrichmentSnapshot,
  EpssState,
  KevRead,
  KevState,
  SectionedFrontPageResult,
  SsvcState,
} from "../types.ts";

/**
 * TEMPORARY read adapter (Phase 16 deletes it): turns the stored rows into the shapes the existing
 * front page and feeds already consume (`SectionedFrontPageResult` and `EnrichmentSnapshot`), so the
 * UI stays as it is while the data moves from the ISR snapshot to SQLite.
 *
 * Imports only network-free modules: `uniqueCves` and `kevHealth` come from `enrichment/display.ts`
 * and `articleId` from `pipeline/articleId.ts`, never from `enrich.ts` or `getFrontPage.ts`, which
 * reach the network through `epss.ts`, `ssvc.ts` and `fetchSource.ts`.
 *
 * Last-good rule, read side (PLAT-09, user decision W3): each source's stored sightings are windowed
 * from that source's own last successful fetch (`readSourceAnchors`), never from the wall clock, so a
 * failed cycle, one source failing inside a partial cycle, or time passing cannot thin the page. The
 * stories, their sections, their order and `generatedAt` therefore depend only on stored rows. `now`
 * is used for KEV staleness in the health part alone.
 */

export type ReadyFrontPage = Extract<SectionedFrontPageResult, { status: "ok" }>;

export type FrontPageRead =
  | { kind: "waiting" }
  | { kind: "ready"; result: ReadyFrontPage; enrichment: EnrichmentSnapshot };

/** Test seam only; production callers never pass it. */
export type ReadFrontPageDeps = {
  /** Awaited after the last-good marker is read and before anything else is read. */
  betweenReads?: () => Promise<void>;
};

/** Keeps `in (...)` lists small; SQLite's bound-variable limit is far above this. */
const CHUNK = 400;

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

/** The enrichment columns of one cve_signals row. */
export type CveSignalRow = Pick<
  Selectable<CveSignalsTable>,
  | "kev_state"
  | "kev_added"
  | "kev_due"
  | "kev_ransomware"
  | "epss_state"
  | "epss_score"
  | "epss_date"
  | "ssvc_state"
  | "ssvc_exploitation"
  | "ssvc_automatable"
  | "ssvc_technical_impact"
>;

/**
 * One cve_signals row as the page's `CveEnrichment`. The database guards (honesty CHECKs) already
 * tie each state to its fields, so a state whose fields are missing reads as `unavailable` rather
 * than guessing. `skipped` stays `{ state: "skipped" }` (RESEARCH Pitfall 13): it is a deliberate
 * non-lookup, never a failure.
 */
export function cveEnrichmentFromRow(row: CveSignalRow): CveEnrichment {
  let kev: KevState = { state: "unavailable" };
  if (row.kev_state === "listed" && row.kev_added !== null) {
    kev = { state: "listed", added: row.kev_added, due: row.kev_due ?? "", ransomware: row.kev_ransomware === 1 };
  } else if (row.kev_state === "not-listed") {
    kev = { state: "not-listed" };
  }

  let epss: EpssState = { state: "unavailable" };
  if (row.epss_state === "scored" && row.epss_score !== null) {
    epss = { state: "scored", score: row.epss_score, date: row.epss_date ?? "" };
  } else if (row.epss_state === "no-row") {
    epss = { state: "no-row" };
  }

  let ssvc: SsvcState = { state: "unavailable" };
  if (
    row.ssvc_state === "assessed" &&
    row.ssvc_exploitation !== null &&
    row.ssvc_automatable !== null &&
    row.ssvc_technical_impact !== null
  ) {
    ssvc = {
      state: "assessed",
      exploitation: row.ssvc_exploitation,
      automatable: row.ssvc_automatable,
      technicalImpact: row.ssvc_technical_impact,
    };
  } else if (row.ssvc_state === "not-assessed") {
    ssvc = { state: "not-assessed" };
  } else if (row.ssvc_state === "skipped") {
    ssvc = { state: "skipped" };
  }

  return { kev, epss, ssvc };
}

const UNAVAILABLE: CveEnrichment = {
  kev: { state: "unavailable" },
  epss: { state: "unavailable" },
  ssvc: { state: "unavailable" },
};

/**
 * The enrichment of `ids` from stored rows. A CVE with no row, or never checked, reads
 * `unavailable` in all three providers, never "not listed". KEV health comes from
 * provider_state.kev.last_success_at (unavailable when null) through the same `kevHealth` the live
 * join used; EPSS and SSVC health are counted the way `enrichCves` counts them (the SSVC request
 * count excludes `skipped`).
 */
export async function readEnrichment(
  db: Kysely<Database>,
  ids: readonly string[],
  now: number,
): Promise<EnrichmentSnapshot> {
  const rows = new Map<string, CveSignalRow>();
  for (const part of chunks(ids)) {
    const found = await db
      .selectFrom("cve_signals")
      .where("cve_id", "in", part)
      .select([
        "cve_id",
        "kev_state",
        "kev_added",
        "kev_due",
        "kev_ransomware",
        "epss_state",
        "epss_score",
        "epss_date",
        "ssvc_state",
        "ssvc_exploitation",
        "ssvc_automatable",
        "ssvc_technical_impact",
      ])
      .execute();
    for (const row of found) rows.set(row.cve_id, row);
  }

  const kevState = await db
    .selectFrom("provider_state")
    .where("provider", "=", "kev")
    .select(["last_success_at", "catalog_version"])
    .executeTakeFirst();
  const kevRead: KevRead =
    kevState?.last_success_at == null
      ? { status: "unavailable" }
      : {
          status: "ok",
          map: { version: 1, fetchedAt: kevState.last_success_at, catalogVersion: kevState.catalog_version ?? "", entries: {} },
        };

  const byCve: Record<string, CveEnrichment> = {};
  let epssUnavailable = 0;
  let ssvcRequested = 0;
  let ssvcUnavailable = 0;
  for (const id of ids) {
    const row = rows.get(id);
    const enrichment = row ? cveEnrichmentFromRow(row) : UNAVAILABLE;
    byCve[id] = enrichment;
    if (enrichment.epss.state === "unavailable") epssUnavailable++;
    if (enrichment.ssvc.state !== "skipped") {
      ssvcRequested++;
      if (enrichment.ssvc.state === "unavailable") ssvcUnavailable++;
    }
  }

  const health = (requested: number, unavailable: number) => ({
    status: (requested === 0 || unavailable === 0 ? "ok" : unavailable === requested ? "unavailable" : "partial") as
      | "ok"
      | "partial"
      | "unavailable",
    requested,
    unavailable,
  });
  return {
    byCve,
    health: {
      kev: kevHealth(kevRead, now),
      epss: health(ids.length, epssUnavailable),
      ssvc: health(ssvcRequested, ssvcUnavailable),
    },
  };
}

/** The stories (one card each) of the in-window sightings, ranked by the engine's own stages. */
async function composeEdition(
  db: Kysely<Database>,
  stored: readonly StoredArticle[],
  editionAt: number,
): Promise<ReadyFrontPage> {
  const byStory = new Map<string, StoredArticle[]>();
  for (const article of stored) {
    const members = byStory.get(article.storyId);
    if (members) members.push(article);
    else byStory.set(article.storyId, [article]);
  }

  const storyRows = new Map<string, { section: ClassifiedArticle["section"]; importance: ClassifiedArticle["importance"]; reason: string | null }>();
  for (const part of chunks([...byStory.keys()])) {
    const rows = await db
      .selectFrom("stories")
      .where("id", "in", part)
      .select(["id", "section", "importance", "importance_reason"])
      .execute();
    for (const row of rows) storyRows.set(row.id, { section: row.section, importance: row.importance, reason: row.importance_reason });
  }

  const cards: Array<{ lead: StoredArticle; card: ClassifiedArticle }> = [];
  for (const [storyId, members] of byStory) {
    const story = storyRows.get(storyId);
    if (!story) continue;
    const lead = members[pickLead(members)]!;
    cards.push({
      lead,
      card: {
        title: lead.title,
        url: lead.url,
        source: lead.source,
        sourceTier: lead.sourceTier,
        sourceType: lead.sourceType,
        publishedAt: lead.publishedAt,
        summary: lead.summary,
        section: story.section,
        importance: story.importance,
        importanceReason: story.reason,
        id: articleId(lead.url),
        cves: extractCves(lead),
      },
    });
  }
  // A content-derived order for equal scores, so the same rows always give the same page.
  cards.sort((a, b) => {
    const keyA = `${a.lead.canonicalUrl}\n${a.lead.sourceId}`;
    const keyB = `${b.lead.canonicalUrl}\n${b.lead.sourceId}`;
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });

  // Ranking uses the newest good cycle's time, so the order never depends on when the page is read.
  const sections = groupBySection(
    cards.map((c) => c.card),
    editionAt,
  );
  return {
    status: "ok",
    articles: sections.flatMap((group) => group.articles),
    sections,
    generatedAt: new Date(editionAt).toISOString(),
  };
}

/**
 * The front page as stored: `waiting` until a cycle has succeeded (never an empty `ready` that would
 * read as a quiet news day), then the last-good edition with its enrichment. `now` only feeds KEV
 * staleness; the adapter never samples the clock itself.
 */
export async function readFrontPage(
  db: Kysely<Database>,
  now: number,
  deps: ReadFrontPageDeps = {},
): Promise<FrontPageRead> {
  const lastGood = await readLastGood(db);
  if (lastGood === null) return { kind: "waiting" };
  await deps.betweenReads?.();

  const anchors = await readSourceAnchors(db);
  const stored = await selectInWindowArticles(db, anchors);
  const result = await composeEdition(db, stored, lastGood.editionAt);
  const enrichment = await readEnrichment(db, uniqueCves(result.articles), now);
  return { kind: "ready", result, enrichment };
}
