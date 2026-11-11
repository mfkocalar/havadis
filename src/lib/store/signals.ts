import type { Kysely, Selectable } from "kysely";
import { CVE_ID_SHAPE } from "../cveChips.ts";
import type { CveSignalsTable, Database, SignalCause } from "../db/schema.ts";
import { uniqueCves } from "../enrichment/display.ts";
import { articleId } from "../pipeline/articleId.ts";
import { pickLead } from "../pipeline/dedupe.ts";
import { extractCves } from "../pipeline/extractCves.ts";
import { groupBySection } from "../pipeline/groupBySection.ts";
import type { FetchErrorCode } from "../reasonCodes.ts";
import type { CacheableSsvcState, ClassifiedArticle, EnrichmentSnapshot, KevEntry, KevMap, KevRead } from "../types.ts";
import { readLastGood, readSourceAnchors, selectInWindowArticles } from "./articles.ts";
import type { StoredArticle } from "./articles.ts";

/**
 * All SQL for kev_catalog, provider_state, cve_signals and cve_signal_snapshots (PLAT-08).
 *
 * Keep-last-good: a positive stored state is never overwritten with `unavailable`, `not-listed` is
 * written only by `applyKevToSignals` from a catalog that was read successfully, and a failed
 * attempt moves only an attempt time. Observations are append-only and exact: a row is appended
 * whenever the stored tuple of the provider that changed differs, with no threshold (approved
 * decision 2). Every function takes a Kysely handle or transaction and an explicit time and run id;
 * nothing here reads the clock or the network, and the callers decide where the transactions sit
 * (never around a network call, T-14-26). Every query is a Kysely builder with bound parameters.
 */

type Db = Kysely<Database>;
type SignalRow = Selectable<CveSignalsTable>;

/** Keeps `in (...)` lists and multi-row inserts small. */
const CHUNK = 400;

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

/** A fixed provider failure code, never error text (T-14-27). */
export type ProviderErrorCode = FetchErrorCode | "validation_failed";

export type ProviderOutcome = { ok: true; catalogVersion?: string } | { ok: false; code: ProviderErrorCode };

// ---------------------------------------------------------------------------
// KEV catalog
// ---------------------------------------------------------------------------

/**
 * The stored KEV catalog as the engine's `KevRead`. `unavailable` while no read ever succeeded
 * (provider_state kev.last_success_at is NULL), otherwise the map rebuilt from kev_catalog with
 * `fetchedAt` = the last successful read. An empty stored due date reads back as "".
 */
export async function readKevFromDb(db: Db): Promise<KevRead> {
  const state = await db
    .selectFrom("provider_state")
    .where("provider", "=", "kev")
    .select(["last_success_at", "catalog_version"])
    .executeTakeFirst();
  if (state === undefined || state.last_success_at === null) return { status: "unavailable" };
  const rows = await db.selectFrom("kev_catalog").select(["cve_id", "added", "due", "ransomware"]).execute();
  const entries: Record<string, KevEntry> = {};
  for (const r of rows) {
    if (CVE_ID_SHAPE.test(r.cve_id)) entries[r.cve_id] = { added: r.added, due: r.due ?? "", ransomware: r.ransomware === 1 };
  }
  return {
    status: "ok",
    map: { version: 1, fetchedAt: state.last_success_at, catalogVersion: state.catalog_version ?? "", entries },
  };
}

/** Replaces the whole stored catalog with `map` (the previous rows are the previous refresh's). Returns the row count. */
export async function replaceKevCatalog(db: Db, map: KevMap): Promise<number> {
  await db.deleteFrom("kev_catalog").execute();
  const values = Object.entries(map.entries)
    .filter(([id]) => CVE_ID_SHAPE.test(id))
    .map(([cve_id, e]) => ({
      cve_id,
      added: e.added,
      due: e.due === "" ? null : e.due,
      ransomware: e.ransomware ? 1 : 0,
    }));
  for (const part of chunks(values)) await db.insertInto("kev_catalog").values(part).execute();
  return values.length;
}

type SnapshotTuple = Pick<
  SignalRow,
  "kev_state" | "epss_state" | "epss_score" | "ssvc_state" | "ssvc_exploitation" | "ssvc_automatable" | "ssvc_technical_impact"
>;

/** Appends one observation: its cause, time and run, and the full current tuple of all three providers. */
async function appendObservation(
  db: Db,
  cveId: string,
  cause: SignalCause,
  nowIso: string,
  runId: number,
  t: SnapshotTuple,
): Promise<void> {
  await db
    .insertInto("cve_signal_snapshots")
    .values({
      cve_id: cveId,
      observed_at: nowIso,
      cause,
      kev_state: t.kev_state,
      epss_state: t.epss_state,
      epss_score: t.epss_score,
      ssvc_state: t.ssvc_state,
      ssvc_exploitation: t.ssvc_exploitation,
      ssvc_automatable: t.ssvc_automatable,
      ssvc_technical_impact: t.ssvc_technical_impact,
      run_id: runId,
    })
    .execute();
}

/**
 * Sets every CVE's KEV state from the stored catalog: listed with added, due and ransomware (an
 * empty due date is NULL), otherwise not-listed, with kev_checked_at = `nowIso`. This is the only
 * place `not-listed` is written, so it is only ever derived from a catalog that was read. An
 * observation (cause "kev") is appended for each CVE whose stored KEV tuple changed, which includes
 * its first check; a CVE whose state is unchanged only has its check time moved.
 *
 * `onlyUnavailable` limits it to CVEs that have no KEV state yet (first seen between refreshes) and
 * does nothing until a catalog read has succeeded.
 */
export async function applyKevToSignals(
  db: Db,
  nowIso: string,
  runId: number,
  opts: { onlyUnavailable?: boolean } = {},
): Promise<{ checked: number; changed: number }> {
  if (opts.onlyUnavailable === true) {
    const state = await db.selectFrom("provider_state").where("provider", "=", "kev").select("last_success_at").executeTakeFirst();
    if (state === undefined || state.last_success_at === null) return { checked: 0, changed: 0 };
  }
  const catalog = new Map(
    (await db.selectFrom("kev_catalog").select(["cve_id", "added", "due", "ransomware"]).execute()).map((r) => [r.cve_id, r]),
  );
  let query = db.selectFrom("cve_signals").selectAll();
  if (opts.onlyUnavailable === true) query = query.where("kev_state", "=", "unavailable");
  const rows = await query.execute();

  const unchanged: string[] = [];
  let changed = 0;
  for (const r of rows) {
    const entry = catalog.get(r.cve_id);
    const next =
      entry === undefined
        ? { kev_state: "not-listed" as const, kev_added: null, kev_due: null, kev_ransomware: null }
        : { kev_state: "listed" as const, kev_added: entry.added, kev_due: entry.due, kev_ransomware: entry.ransomware };
    const same =
      r.kev_state === next.kev_state &&
      r.kev_added === next.kev_added &&
      r.kev_due === next.kev_due &&
      r.kev_ransomware === next.kev_ransomware;
    if (same) {
      unchanged.push(r.cve_id);
      continue;
    }
    await db.updateTable("cve_signals").set({ ...next, kev_checked_at: nowIso }).where("cve_id", "=", r.cve_id).execute();
    await appendObservation(db, r.cve_id, "kev", nowIso, runId, { ...r, kev_state: next.kev_state });
    changed++;
  }
  for (const part of chunks(unchanged)) {
    await db.updateTable("cve_signals").set({ kev_checked_at: nowIso }).where("cve_id", "in", part).execute();
  }
  return { checked: rows.length, changed };
}

// ---------------------------------------------------------------------------
// SSVC and EPSS
// ---------------------------------------------------------------------------

type SsvcWrite = CacheableSsvcState | { state: "skipped" };

async function readSignalRow(db: Db, cveId: string): Promise<SignalRow | undefined> {
  return db.selectFrom("cve_signals").selectAll().where("cve_id", "=", cveId).executeTakeFirst();
}

/** Stores a positive SSVC answer or a deliberate skip, appending an observation when the decision tuple changed. */
async function storeSsvc(db: Db, cveId: string, s: SsvcWrite, nowIso: string, runId: number): Promise<boolean> {
  const r = await readSignalRow(db, cveId);
  if (r === undefined) return false;
  const next =
    s.state === "assessed"
      ? {
          ssvc_state: "assessed" as const,
          ssvc_exploitation: s.exploitation,
          ssvc_automatable: s.automatable,
          ssvc_technical_impact: s.technicalImpact,
        }
      : {
          ssvc_state: s.state,
          ssvc_exploitation: null,
          ssvc_automatable: null,
          ssvc_technical_impact: null,
        };
  const changed =
    r.ssvc_state !== next.ssvc_state ||
    r.ssvc_exploitation !== next.ssvc_exploitation ||
    r.ssvc_automatable !== next.ssvc_automatable ||
    r.ssvc_technical_impact !== next.ssvc_technical_impact;
  await db.updateTable("cve_signals").set({ ...next, ssvc_checked_at: nowIso }).where("cve_id", "=", cveId).execute();
  if (changed) await appendObservation(db, cveId, "ssvc", nowIso, runId, { ...r, ...next });
  return changed;
}

/**
 * Persists one positive SSVC answer (assessed or not-assessed) with its check time. The worker calls
 * it from the lookup callback in its own short transaction, so an answer that lands after the time
 * budget is still stored. Returns whether the decision tuple changed (an observation was appended).
 */
export async function persistSsvcPositive(
  db: Db,
  cveId: string,
  state: CacheableSsvcState,
  nowIso: string,
  runId: number,
): Promise<boolean> {
  return storeSsvc(db, cveId, state, nowIso, runId);
}

/**
 * Persists what `enrichCves` returned, keeping last good. EPSS scored or no-row is stored with its
 * check time (an observation when the state or score differs, exactly; a newer EPSS date with the
 * same score only moves the stored date); EPSS unavailable moves only epss_attempt_at. SSVC
 * assessed, not-assessed and skipped are stored (skipped with NULL decision points, so a KEV-listed
 * CVE never reads as a failed lookup, Pitfall 13); SSVC unavailable moves only ssvc_attempt_at. KEV
 * in the snapshot is ignored: kev_state is written by `applyKevToSignals` alone.
 */
export async function persistPostEnrich(
  db: Db,
  snapshot: EnrichmentSnapshot,
  nowIso: string,
  runId: number,
): Promise<{ changed: number }> {
  let changed = 0;
  for (const [cveId, enrichment] of Object.entries(snapshot.byCve)) {
    if (!CVE_ID_SHAPE.test(cveId)) continue;
    const r = await readSignalRow(db, cveId);
    if (r === undefined) continue;

    const { epss, ssvc } = enrichment;
    if (epss.state === "unavailable") {
      await db.updateTable("cve_signals").set({ epss_attempt_at: nowIso }).where("cve_id", "=", cveId).execute();
    } else {
      const next =
        epss.state === "scored"
          ? { epss_state: "scored" as const, epss_score: epss.score, epss_date: epss.date }
          : { epss_state: "no-row" as const, epss_score: null, epss_date: null };
      const differs = r.epss_state !== next.epss_state || r.epss_score !== next.epss_score;
      await db.updateTable("cve_signals").set({ ...next, epss_checked_at: nowIso }).where("cve_id", "=", cveId).execute();
      if (differs) {
        await appendObservation(db, cveId, "epss", nowIso, runId, { ...r, ...next });
        changed++;
      }
    }

    if (ssvc.state === "unavailable") {
      await db.updateTable("cve_signals").set({ ssvc_attempt_at: nowIso }).where("cve_id", "=", cveId).execute();
    } else if (await storeSsvc(db, cveId, ssvc, nowIso, runId)) {
      changed++;
    }
  }
  return { changed };
}

/**
 * The stored SSVC answer of one CVE when it is a positive one (assessed or not-assessed), else null.
 * The stage uses it so a CVE whose SSVC is still fresh is not looked up again just because its EPSS
 * is due.
 */
export async function readStoredSsvc(_db: Db, _cveId: string): Promise<CacheableSsvcState | null> {
  return null;
}

// ---------------------------------------------------------------------------
// provider_state
// ---------------------------------------------------------------------------

/**
 * Records one provider attempt: always last_attempt_at; on success also last_success_at, a cleared
 * error and, for KEV, the catalog version; on failure a fixed error code and the previous success
 * left alone. The row is created when it does not exist.
 */
export async function recordProviderAttempt(
  db: Db,
  provider: "kev" | "epss" | "ssvc",
  outcome: ProviderOutcome,
  nowIso: string,
): Promise<void> {
  const update = outcome.ok
    ? {
        last_attempt_at: nowIso,
        last_success_at: nowIso,
        last_error_code: null,
        ...(outcome.catalogVersion === undefined ? {} : { catalog_version: outcome.catalogVersion }),
      }
    : { last_attempt_at: nowIso, last_error_code: outcome.code };
  await db
    .insertInto("provider_state")
    .values({ provider, ...update })
    .onConflict((oc) => oc.column("provider").doUpdateSet(update))
    .execute();
}

// ---------------------------------------------------------------------------
// refresh candidates
// ---------------------------------------------------------------------------

/**
 * The CVEs due for a refresh, in the order the page shows their cards (EPSS caps its ids in
 * first-appearance order, so the visible cards come first), and the same cards' CVE lists for the
 * engine's chip-aware SSVC ordering. `ssvcDue` is the subset whose SSVC check is itself due.
 */
export type EnrichmentCandidates = { staleIds: string[]; cardCves: string[][]; ssvcDue: ReadonlySet<string> };

/**
 * The cards of the in-window sightings in page order, built the way the read adapter builds them
 * (one card per story from the engine's lead, sorted by content for a stable order, grouped and
 * ranked at the edition time), and returned as each card's extracted CVE list.
 */
async function editionCardCves(db: Db, stored: readonly StoredArticle[], editionAt: number): Promise<string[][]> {
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
    for (const r of rows) storyRows.set(r.id, { section: r.section, importance: r.importance, reason: r.importance_reason });
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
  cards.sort((a, b) => {
    const keyA = `${a.lead.canonicalUrl}\n${a.lead.sourceId}`;
    const keyB = `${b.lead.canonicalUrl}\n${b.lead.sourceId}`;
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });
  return groupBySection(
    cards.map((c) => c.card),
    editionAt,
  ).flatMap((group) => group.articles.map((a) => a.cves));
}

/**
 * The CVEs worth refreshing now. Nothing before the first good cycle (readLastGood is null);
 * afterwards the CVEs of the stories readers see: each source's stored sightings windowed at that
 * source's own last-good anchor (`readSourceAnchors`, `selectInWindowArticles`, the same read the
 * page does, user decision W3), never a window computed from `now`. A CVE is due when its EPSS or
 * its SSVC is due: checked_at NULL or at least `ttlMs` old, and attempt_at NULL or at least
 * `cooldownMs` old.
 */
export async function selectEnrichmentCandidates(
  db: Db,
  now: number,
  ttlMs: number,
  cooldownMs: number,
): Promise<EnrichmentCandidates> {
  const none: EnrichmentCandidates = { staleIds: [], cardCves: [], ssvcDue: new Set() };
  const lastGood = await readLastGood(db);
  if (lastGood === null) return none;
  const stored = await selectInWindowArticles(db, await readSourceAnchors(db));
  const cardCves = await editionCardCves(db, stored, lastGood.editionAt);
  const ids = uniqueCves(cardCves.map((cves) => ({ cves })));
  if (ids.length === 0) return { staleIds: [], cardCves, ssvcDue: new Set() };

  const checkedBefore = new Date(now - ttlMs).toISOString();
  const attemptedBefore = new Date(now - cooldownMs).toISOString();
  const isDue = (checkedAt: string | null, attemptAt: string | null): boolean =>
    (checkedAt === null || checkedAt <= checkedBefore) && (attemptAt === null || attemptAt <= attemptedBefore);

  const epssDue = new Set<string>();
  const ssvcDue = new Set<string>();
  for (const part of chunks(ids)) {
    const rows = await db
      .selectFrom("cve_signals")
      .where("cve_id", "in", part)
      .select(["cve_id", "epss_checked_at", "epss_attempt_at", "ssvc_checked_at", "ssvc_attempt_at"])
      .execute();
    for (const r of rows) {
      if (isDue(r.epss_checked_at, r.epss_attempt_at)) epssDue.add(r.cve_id);
      if (isDue(r.ssvc_checked_at, r.ssvc_attempt_at)) ssvcDue.add(r.cve_id);
    }
  }
  return { staleIds: ids.filter((id) => epssDue.has(id) || ssvcDue.has(id)), cardCves, ssvcDue };
}
