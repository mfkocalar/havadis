import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/openDb.ts";
import type { DbHandle } from "../db/openDb.ts";
import { loadMigrations, runMigrations } from "../db/migrator.ts";
import { seedBuiltins } from "../db/seed.ts";
import { kevHealth, uniqueCves } from "../enrichment/display.ts";
import { readFrontPage } from "../adapters/frontPage.ts";
import { runIngestCycle } from "../worker/cycle.ts";
import type { FeedFetchResult } from "../pipeline/feedResult.ts";
import {
  applyKevToSignals,
  persistPostEnrich,
  persistSsvcPositive,
  readKevFromDb,
  recordProviderAttempt,
  replaceKevCatalog,
  selectEnrichmentCandidates,
} from "./signals.ts";
import { makeArticle, makeSource } from "../../../test/fixtures/makeArticle.ts";
import type {
  Article,
  CveEnrichment,
  EnrichmentSnapshot,
  EpssState,
  KevMap,
  SourceConfig,
  SsvcState,
} from "../types.ts";

/**
 * The signal store against an in-memory database: keep-last-good writes, the exact-change
 * observation rule, the stored KEV catalog and the refresh candidates that follow the edition
 * readers see (PLAT-08, PLAT-09 for signals).
 */

const T = Date.parse("2026-11-11T08:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString();

const SRC_A = makeSource({ id: "src-a", name: "Source A", family: "fam-a", sourceType: "news", tier: "Security Research" });
const SRC_B = makeSource({ id: "src-b", name: "Source B", family: "fam-b", sourceType: "news", tier: "Government" });

async function open(): Promise<DbHandle> {
  const handle = openDb(":memory:", "worker");
  await runMigrations(handle, { migrations: loadMigrations(), backup: async () => null, now: () => T });
  await seedBuiltins(handle.db, [SRC_A, SRC_B], T);
  return handle;
}

/** A finished run row to hang observations on (fetch_runs is the run_id foreign key). */
async function newRun(h: DbHandle, startedAt = T): Promise<number> {
  const row = await h.db
    .insertInto("fetch_runs")
    .values({ started_at: iso(startedAt), finished_at: iso(startedAt), status: "ok", trigger: "test" })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function addCve(h: DbHandle, id: string): Promise<void> {
  await h.db.insertInto("cve_signals").values({ cve_id: id, first_seen_at: iso(T) }).execute();
}

const row = (h: DbHandle, id: string) =>
  h.db.selectFrom("cve_signals").selectAll().where("cve_id", "=", id).executeTakeFirstOrThrow();

/** Observations of one CVE in id order, the order the API contract promises. */
const observations = (h: DbHandle, id: string) =>
  h.db.selectFrom("cve_signal_snapshots").selectAll().where("cve_id", "=", id).orderBy("id").execute();

const UNAVAILABLE_ENR: CveEnrichment = {
  kev: { state: "unavailable" },
  epss: { state: "unavailable" },
  ssvc: { state: "unavailable" },
};

function snap(byCve: Record<string, Partial<CveEnrichment>>): EnrichmentSnapshot {
  const full: Record<string, CveEnrichment> = {};
  for (const [id, partial] of Object.entries(byCve)) full[id] = { ...UNAVAILABLE_ENR, ...partial };
  return {
    byCve: full,
    health: {
      kev: { status: "unavailable", fetchedAt: null },
      epss: { status: "ok", requested: 0, unavailable: 0 },
      ssvc: { status: "ok", requested: 0, unavailable: 0 },
    },
  };
}

const scored = (score: number, date = "2026-11-10"): EpssState => ({ state: "scored", score, date });
const assessed = (exploitation: "none" | "poc" | "active"): SsvcState => ({
  state: "assessed",
  exploitation,
  automatable: "no",
  technicalImpact: "partial",
});

function kevMap(entries: KevMap["entries"], catalogVersion = "2026.11.10"): KevMap {
  return { version: 1, fetchedAt: iso(T), catalogVersion, entries };
}

// ---------------------------------------------------------------------------
// KEV catalog
// ---------------------------------------------------------------------------

test("readKevFromDb: unavailable while no catalog was ever read, then the stored catalog as a KevMap", async () => {
  const h = await open();
  try {
    assert.deepEqual(await readKevFromDb(h.db), { status: "unavailable" });

    // Catalog rows without a successful read still read as unavailable.
    await replaceKevCatalog(
      h.db,
      kevMap({ "CVE-2026-40001": { added: "2026-11-01", due: "2026-11-22", ransomware: true }, "CVE-2026-40002": { added: "2026-11-02", due: "", ransomware: false } }),
    );
    assert.deepEqual(await readKevFromDb(h.db), { status: "unavailable" }, "no last_success_at yet");

    await recordProviderAttempt(h.db, "kev", { ok: true, catalogVersion: "2026.11.10" }, iso(T + HOUR));
    const read = await readKevFromDb(h.db);
    assert.equal(read.status, "ok");
    if (read.status !== "ok") return;
    assert.deepEqual(read.map, {
      version: 1,
      fetchedAt: iso(T + HOUR),
      catalogVersion: "2026.11.10",
      entries: {
        "CVE-2026-40001": { added: "2026-11-01", due: "2026-11-22", ransomware: true },
        "CVE-2026-40002": { added: "2026-11-02", due: "", ransomware: false },
      },
    });
    assert.deepEqual(kevHealth(read, T + 2 * HOUR), { status: "ok", fetchedAt: iso(T + HOUR) });
  } finally {
    await h.close();
  }
});

test("replaceKevCatalog replaces the whole catalog and stores an empty due date as NULL", async () => {
  const h = await open();
  try {
    await replaceKevCatalog(h.db, kevMap({ "CVE-2026-40001": { added: "2026-11-01", due: "", ransomware: false }, "CVE-2026-40002": { added: "2026-11-02", due: "2026-11-23", ransomware: true } }));
    await replaceKevCatalog(h.db, kevMap({ "CVE-2026-40002": { added: "2026-11-02", due: "2026-11-23", ransomware: true }, "CVE-2026-40003": { added: "2026-11-03", due: "", ransomware: false } }));
    const rows = await h.db.selectFrom("kev_catalog").select(["cve_id", "added", "due", "ransomware"]).orderBy("cve_id").execute();
    assert.deepEqual(rows, [
      { cve_id: "CVE-2026-40002", added: "2026-11-02", due: "2026-11-23", ransomware: 1 },
      { cve_id: "CVE-2026-40003", added: "2026-11-03", due: null, ransomware: 0 },
    ]);
  } finally {
    await h.close();
  }
});

test("applyKevToSignals: listed and not-listed from the stored catalog, one observation per first check, none on a repeat, one when a CVE leaves", async () => {
  const h = await open();
  try {
    const runId = await newRun(h);
    await addCve(h, "CVE-2026-40001");
    await addCve(h, "CVE-2026-40002");
    await addCve(h, "CVE-2026-40003");
    await replaceKevCatalog(h.db, kevMap({
      "CVE-2026-40001": { added: "2026-11-01", due: "", ransomware: true },
      "CVE-2026-40002": { added: "2026-11-02", due: "2026-11-23", ransomware: false },
    }));
    await applyKevToSignals(h.db, iso(T + MINUTE), runId);

    const a = await row(h, "CVE-2026-40001");
    assert.deepEqual(
      [a.kev_state, a.kev_added, a.kev_due, a.kev_ransomware, a.kev_checked_at],
      ["listed", "2026-11-01", null, 1, iso(T + MINUTE)],
      "an empty due date is stored as NULL",
    );
    const b = await row(h, "CVE-2026-40002");
    assert.deepEqual([b.kev_state, b.kev_added, b.kev_due, b.kev_ransomware], ["listed", "2026-11-02", "2026-11-23", 0]);
    const c = await row(h, "CVE-2026-40003");
    assert.deepEqual([c.kev_state, c.kev_added, c.kev_due, c.kev_ransomware, c.kev_checked_at], ["not-listed", null, null, null, iso(T + MINUTE)]);

    for (const id of ["CVE-2026-40001", "CVE-2026-40002", "CVE-2026-40003"]) {
      const obs = await observations(h, id);
      assert.equal(obs.length, 1, `first check of ${id} appends one observation`);
      assert.equal(obs[0]!.cause, "kev");
      assert.equal(obs[0]!.run_id, runId);
      assert.equal(obs[0]!.observed_at, iso(T + MINUTE));
      assert.equal(obs[0]!.epss_state, "unavailable");
      assert.equal(obs[0]!.ssvc_state, "unavailable");
    }
    assert.equal((await observations(h, "CVE-2026-40001"))[0]!.kev_state, "listed");
    assert.equal((await observations(h, "CVE-2026-40003"))[0]!.kev_state, "not-listed");

    // The same catalog again: only kev_checked_at moves.
    await applyKevToSignals(h.db, iso(T + HOUR), runId);
    for (const id of ["CVE-2026-40001", "CVE-2026-40002", "CVE-2026-40003"]) {
      assert.equal((await observations(h, id)).length, 1, `re-applying the same catalog appends nothing for ${id}`);
      assert.equal((await row(h, id)).kev_checked_at, iso(T + HOUR));
    }

    // CVE-2026-40001 leaves the catalog.
    await replaceKevCatalog(h.db, kevMap({ "CVE-2026-40002": { added: "2026-11-02", due: "2026-11-23", ransomware: false } }));
    await applyKevToSignals(h.db, iso(T + 2 * HOUR), runId);
    const left = await observations(h, "CVE-2026-40001");
    assert.equal(left.length, 2, "leaving the catalog appends one observation");
    assert.deepEqual([left[1]!.cause, left[1]!.kev_state], ["kev", "not-listed"]);
    assert.equal((await row(h, "CVE-2026-40001")).kev_state, "not-listed");
    assert.equal((await observations(h, "CVE-2026-40002")).length, 1);
    assert.equal((await observations(h, "CVE-2026-40003")).length, 1);
  } finally {
    await h.close();
  }
});

test("applyKevToSignals onlyUnavailable gives a CVE first seen between refreshes its state from the stored catalog, and writes nothing without a successful read", async () => {
  const h = await open();
  try {
    const runId = await newRun(h);
    await addCve(h, "CVE-2026-40001");
    await replaceKevCatalog(h.db, kevMap({ "CVE-2026-40002": { added: "2026-11-02", due: "", ransomware: false } }));

    // A catalog is stored but no read ever succeeded: not-listed must never be written.
    await applyKevToSignals(h.db, iso(T), runId, { onlyUnavailable: true });
    assert.equal((await row(h, "CVE-2026-40001")).kev_state, "unavailable");
    assert.equal((await row(h, "CVE-2026-40001")).kev_checked_at, null);
    assert.equal((await observations(h, "CVE-2026-40001")).length, 0);

    await applyKevToSignals(h.db, iso(T), runId);
    await recordProviderAttempt(h.db, "kev", { ok: true, catalogVersion: "v1" }, iso(T));
    await addCve(h, "CVE-2026-40002");
    await addCve(h, "CVE-2026-40003");
    await applyKevToSignals(h.db, iso(T + HOUR), runId, { onlyUnavailable: true });

    assert.equal((await row(h, "CVE-2026-40002")).kev_state, "listed");
    assert.equal((await row(h, "CVE-2026-40003")).kev_state, "not-listed");
    const old = await row(h, "CVE-2026-40001");
    assert.equal(old.kev_checked_at, iso(T), "a CVE that already had a state is not touched");
    assert.equal((await observations(h, "CVE-2026-40001")).length, 1);
    assert.equal((await observations(h, "CVE-2026-40002")).length, 1);
  } finally {
    await h.close();
  }
});

// ---------------------------------------------------------------------------
// provider_state
// ---------------------------------------------------------------------------

test("recordProviderAttempt: success sets both times and clears the error, failure keeps the last success and stores a fixed code", async () => {
  const h = await open();
  try {
    const state = () =>
      h.db.selectFrom("provider_state").selectAll().where("provider", "=", "epss").executeTakeFirstOrThrow();
    await recordProviderAttempt(h.db, "epss", { ok: false, code: "network_error" }, iso(T));
    assert.deepEqual(
      [(await state()).last_success_at, (await state()).last_attempt_at, (await state()).last_error_code],
      [null, iso(T), "network_error"],
    );

    await recordProviderAttempt(h.db, "epss", { ok: true }, iso(T + HOUR));
    assert.deepEqual(
      [(await state()).last_success_at, (await state()).last_attempt_at, (await state()).last_error_code],
      [iso(T + HOUR), iso(T + HOUR), null],
    );

    await recordProviderAttempt(h.db, "epss", { ok: false, code: "validation_failed" }, iso(T + 2 * HOUR));
    assert.deepEqual(
      [(await state()).last_success_at, (await state()).last_attempt_at, (await state()).last_error_code],
      [iso(T + HOUR), iso(T + 2 * HOUR), "validation_failed"],
    );

    await recordProviderAttempt(h.db, "kev", { ok: true, catalogVersion: "2026.11.10" }, iso(T));
    const kev = await h.db.selectFrom("provider_state").selectAll().where("provider", "=", "kev").executeTakeFirstOrThrow();
    assert.equal(kev.catalog_version, "2026.11.10");
  } finally {
    await h.close();
  }
});

// ---------------------------------------------------------------------------
// SSVC
// ---------------------------------------------------------------------------

test("persistSsvcPositive stores assessed and not-assessed and appends an observation only when the decision points change", async () => {
  const h = await open();
  try {
    const runId = await newRun(h);
    const id = "CVE-2026-41001";
    await addCve(h, id);

    assert.equal(await persistSsvcPositive(h.db, id, { state: "assessed", exploitation: "poc", automatable: "no", technicalImpact: "partial" }, iso(T), runId), true);
    let r = await row(h, id);
    assert.deepEqual([r.ssvc_state, r.ssvc_exploitation, r.ssvc_automatable, r.ssvc_technical_impact, r.ssvc_checked_at], ["assessed", "poc", "no", "partial", iso(T)]);
    assert.equal((await observations(h, id)).length, 1, "the first check appends");

    assert.equal(await persistSsvcPositive(h.db, id, { state: "assessed", exploitation: "poc", automatable: "no", technicalImpact: "partial" }, iso(T + HOUR), runId), false);
    assert.equal((await observations(h, id)).length, 1, "the same answer appends nothing");
    assert.equal((await row(h, id)).ssvc_checked_at, iso(T + HOUR), "but the check time moves");

    await persistSsvcPositive(h.db, id, { state: "assessed", exploitation: "active", automatable: "no", technicalImpact: "partial" }, iso(T + 2 * HOUR), runId);
    assert.equal((await observations(h, id)).length, 2, "one changed decision point appends");

    await persistSsvcPositive(h.db, id, { state: "not-assessed" }, iso(T + 3 * HOUR), runId);
    r = await row(h, id);
    assert.deepEqual([r.ssvc_state, r.ssvc_exploitation, r.ssvc_automatable, r.ssvc_technical_impact], ["not-assessed", null, null, null]);
    const obs = await observations(h, id);
    assert.equal(obs.length, 3);
    assert.deepEqual(
      obs.map((o) => [o.cause, o.ssvc_state, o.ssvc_exploitation, o.observed_at, o.run_id]),
      [
        ["ssvc", "assessed", "poc", iso(T), runId],
        ["ssvc", "assessed", "active", iso(T + 2 * HOUR), runId],
        ["ssvc", "not-assessed", null, iso(T + 3 * HOUR), runId],
      ],
    );
  } finally {
    await h.close();
  }
});

test("an observation records the full current tuple of all three providers", async () => {
  const h = await open();
  try {
    const runId = await newRun(h);
    const id = "CVE-2026-41002";
    await addCve(h, id);
    await replaceKevCatalog(h.db, kevMap({ [id]: { added: "2026-11-01", due: "", ransomware: false } }));
    await applyKevToSignals(h.db, iso(T), runId);
    await persistPostEnrich(h.db, snap({ [id]: { epss: scored(0.25) } }), iso(T + HOUR), runId);
    await persistSsvcPositive(h.db, id, assessed("active") as Extract<SsvcState, { state: "assessed" }>, iso(T + 2 * HOUR), runId);

    const obs = await observations(h, id);
    assert.deepEqual(
      obs.map((o) => [o.cause, o.kev_state, o.epss_state, o.epss_score, o.ssvc_state, o.ssvc_exploitation]),
      [
        ["kev", "listed", "unavailable", null, "unavailable", null],
        ["epss", "listed", "scored", 0.25, "unavailable", null],
        ["ssvc", "listed", "scored", 0.25, "assessed", "active"],
      ],
    );
  } finally {
    await h.close();
  }
});

// ---------------------------------------------------------------------------
// post-enrich persistence
// ---------------------------------------------------------------------------

test("PLAT-08/adjacency: an EPSS score equal to the stored one appends nothing, any difference however small appends one", async () => {
  const h = await open();
  try {
    const runId = await newRun(h);
    const id = "CVE-2026-42001";
    await addCve(h, id);

    await persistPostEnrich(h.db, snap({ [id]: { epss: scored(0.1) } }), iso(T), runId);
    assert.equal((await observations(h, id)).length, 1, "the first check appends");

    await persistPostEnrich(h.db, snap({ [id]: { epss: scored(0.1) } }), iso(T + 6 * HOUR), runId);
    assert.equal((await observations(h, id)).length, 1, "an equal score appends no observation");
    assert.equal((await row(h, id)).epss_checked_at, iso(T + 6 * HOUR), "the check time still moves");

    await persistPostEnrich(h.db, snap({ [id]: { epss: scored(0.1000001) } }), iso(T + 12 * HOUR), runId);
    const obs = await observations(h, id);
    assert.equal(obs.length, 2, "0.1 versus 0.1000001 is a difference");
    assert.deepEqual(obs.map((o) => o.epss_score), [0.1, 0.1000001]);
    assert.equal((await row(h, id)).epss_score, 0.1000001);

    // Same score on a newer EPSS date: the stored date follows, the history does not grow.
    await persistPostEnrich(h.db, snap({ [id]: { epss: scored(0.1000001, "2026-11-12") } }), iso(T + 18 * HOUR), runId);
    assert.equal((await observations(h, id)).length, 2);
    assert.equal((await row(h, id)).epss_date, "2026-11-12");
  } finally {
    await h.close();
  }
});

test("persistPostEnrich EPSS: no-row is stored with its check time, unavailable only updates the attempt time and keeps a stored score", async () => {
  const h = await open();
  try {
    const runId = await newRun(h);
    const fresh = "CVE-2026-42002";
    const kept = "CVE-2026-42003";
    await addCve(h, fresh);
    await addCve(h, kept);

    await persistPostEnrich(h.db, snap({ [kept]: { epss: scored(0.42) }, [fresh]: { epss: { state: "no-row" } } }), iso(T), runId);
    let r = await row(h, fresh);
    assert.deepEqual([r.epss_state, r.epss_score, r.epss_date, r.epss_checked_at], ["no-row", null, null, iso(T)]);

    await persistPostEnrich(h.db, snap({ [kept]: { epss: { state: "unavailable" } } }), iso(T + 6 * HOUR), runId);
    r = await row(h, kept);
    assert.deepEqual(
      [r.epss_state, r.epss_score, r.epss_date, r.epss_checked_at, r.epss_attempt_at],
      ["scored", 0.42, "2026-11-10", iso(T), iso(T + 6 * HOUR)],
      "a stored positive state is never overwritten with unavailable",
    );
    assert.equal((await observations(h, kept)).length, 1);

    // A CVE never checked stays unavailable, with no check time, after a failed attempt.
    const never = "CVE-2026-42004";
    await addCve(h, never);
    await persistPostEnrich(h.db, snap({ [never]: {} }), iso(T + HOUR), runId);
    r = await row(h, never);
    assert.deepEqual(
      [r.epss_state, r.epss_checked_at, r.epss_attempt_at, r.ssvc_state, r.ssvc_checked_at, r.ssvc_attempt_at, r.kev_state],
      ["unavailable", null, iso(T + HOUR), "unavailable", null, iso(T + HOUR), "unavailable"],
    );
    assert.equal((await observations(h, never)).length, 0, "a failed attempt is not an observation");
  } finally {
    await h.close();
  }
});

test("persistPostEnrich SSVC: skipped is stored with NULL decision points, unavailable keeps a stored assessed row, and not-listed is never written", async () => {
  const h = await open();
  try {
    const runId = await newRun(h);
    const listed = "CVE-2026-43001";
    const keep = "CVE-2026-43002";
    await addCve(h, listed);
    await addCve(h, keep);
    await persistSsvcPositive(h.db, keep, { state: "assessed", exploitation: "poc", automatable: "yes", technicalImpact: "total" }, iso(T), runId);

    await persistPostEnrich(
      h.db,
      snap({
        // Whatever the snapshot claims about KEV, post-enrich persistence never writes it.
        [listed]: { ssvc: { state: "skipped" }, kev: { state: "not-listed" } },
        [keep]: { ssvc: { state: "unavailable" } },
      }),
      iso(T + 6 * HOUR),
      runId,
    );

    let r = await row(h, listed);
    assert.deepEqual(
      [r.ssvc_state, r.ssvc_exploitation, r.ssvc_automatable, r.ssvc_technical_impact, r.ssvc_checked_at],
      ["skipped", null, null, null, iso(T + 6 * HOUR)],
    );
    assert.equal(r.kev_state, "unavailable", "kev_state is only ever written by applyKevToSignals");
    assert.equal(r.kev_checked_at, null);
    assert.equal((await observations(h, listed)).length, 1, "skipped is a state change and is observed");

    r = await row(h, keep);
    assert.deepEqual(
      [r.ssvc_state, r.ssvc_exploitation, r.ssvc_automatable, r.ssvc_technical_impact, r.ssvc_checked_at, r.ssvc_attempt_at],
      ["assessed", "poc", "yes", "total", iso(T), iso(T + 6 * HOUR)],
    );
    assert.equal((await observations(h, keep)).length, 1, "the unavailable answer left no observation");
  } finally {
    await h.close();
  }
});

test("PLAT-08/ordering: observations of one CVE read back in id order when observed_at is equal", async () => {
  const h = await open();
  try {
    const runId = await newRun(h);
    const id = "CVE-2026-44001";
    await addCve(h, id);
    const at = iso(T);
    await persistPostEnrich(h.db, snap({ [id]: { epss: scored(0.3) } }), at, runId);
    await persistSsvcPositive(h.db, id, { state: "not-assessed" }, at, runId);
    await persistPostEnrich(h.db, snap({ [id]: { epss: scored(0.4) } }), at, runId);
    await persistSsvcPositive(h.db, id, { state: "assessed", exploitation: "none", automatable: "no", technicalImpact: "partial" }, at, runId);

    const obs = await observations(h, id);
    assert.equal(new Set(obs.map((o) => o.observed_at)).size, 1, "every observation shares one observed_at");
    assert.deepEqual(obs.map((o) => o.cause), ["epss", "ssvc", "epss", "ssvc"], "insertion order survives");
    assert.deepEqual([...obs.map((o) => o.id)], [...obs.map((o) => o.id)].sort((a, b) => a - b));
    assert.deepEqual(obs.map((o) => o.epss_score), [0.3, 0.3, 0.4, 0.4]);
  } finally {
    await h.close();
  }
});

// ---------------------------------------------------------------------------
// refresh candidates follow the edition readers see
// ---------------------------------------------------------------------------

const ERROR_FEED: FeedFetchResult = { status: "error", code: "network_error", httpStatus: null, retryAfterMs: null };

function okFeed(articles: Article[]): FeedFetchResult {
  return { status: "ok", articles, validators: { etag: null, lastModified: null }, httpStatus: 200 };
}

function art(source: SourceConfig, title: string, url: string, publishedAt: number): Article {
  return makeArticle({
    title,
    url,
    source: source.name,
    sourceTier: source.tier,
    sourceType: source.sourceType,
    publishedAt: iso(publishedAt),
  });
}

type Harness = { h: DbHandle; cycle: (at: number, feeds: Record<string, FeedFetchResult>) => ReturnType<typeof runIngestCycle> };

async function harness(): Promise<Harness> {
  const h = await open();
  let counter = 0;
  const newId = () => `story-${String(++counter).padStart(3, "0")}`;
  return {
    h,
    cycle: (at, feeds) =>
      runIngestCycle(h.db, { sources: [SRC_A, SRC_B], newId, concurrency: 2, fetchFeed: async (s) => feeds[s.id] ?? ERROR_FEED }, at),
  };
}

const TTL = 6 * HOUR;
const COOLDOWN = HOUR;

test("candidates: nothing before the first good cycle, even when CVE rows and sightings exist", async () => {
  const { h, cycle } = await harness();
  try {
    await cycle(T, { "src-a": okFeed([art(SRC_A, "CVE-2026-45001 flaw patched in the Cedar gateway", "https://a.test/1", T - 2 * HOUR)]) });
    const before = await selectEnrichmentCandidates(h.db, T, TTL, COOLDOWN);
    assert.deepEqual(before.staleIds, ["CVE-2026-45001"], "sanity: a good cycle gives a candidate");

    await h.db.deleteFrom("meta").where("key", "in", ["last_good_run_id", "edition_generated_at"]).execute();
    const gated = await selectEnrichmentCandidates(h.db, T, TTL, COOLDOWN);
    assert.deepEqual(gated, { staleIds: [], cardCves: [], ssvcDue: new Set() });
  } finally {
    await h.close();
  }
});

test("candidates: the CVEs of the stories readers see, due by TTL and cooldown, in the adapter's card order", async () => {
  const { h, cycle } = await harness();
  try {
    await cycle(T, {
      "src-a": okFeed([
        art(SRC_A, "Ransomware gang exploits CVE-2026-45101 and CVE-2026-45102 in the field", "https://a.test/1", T - 2 * HOUR),
        art(SRC_A, "Vendor patches CVE-2026-45103 in its edge gateway", "https://a.test/2", T - 5 * HOUR),
        art(SRC_A, "Council votes on rules for connected car software", "https://a.test/3", T - 9 * HOUR),
      ]),
      "src-b": okFeed([art(SRC_B, "Agency advisory covers CVE-2026-45104 exposure", "https://b.test/1", T - 3 * HOUR)]),
    });
    // A CVE no visible story mentions is never a candidate.
    await addCve(h, "CVE-2026-45999");

    const page = await readFrontPage(h.db, T);
    assert.equal(page.kind, "ready");
    if (page.kind !== "ready") return;
    const adapterOrder = uniqueCves(page.result.articles);
    assert.equal(adapterOrder.length, 4);

    const all = await selectEnrichmentCandidates(h.db, T, TTL, COOLDOWN);
    assert.deepEqual(all.staleIds, adapterOrder, "ordered like the adapter's cards");
    assert.deepEqual(all.cardCves, page.result.articles.map((a) => a.cves));
    assert.deepEqual([...all.ssvcDue].sort(), [...adapterOrder].sort());
    assert.ok(!all.staleIds.includes("CVE-2026-45999"));

    // Fresh EPSS and SSVC: not due. Fresh EPSS only: still due through SSVC.
    const [first, second, third] = adapterOrder;
    const runId = (await h.db.selectFrom("fetch_runs").select("id").executeTakeFirstOrThrow()).id;
    await persistPostEnrich(h.db, snap({ [first!]: { epss: scored(0.2), ssvc: { state: "not-assessed" } }, [second!]: { epss: scored(0.3) } }), iso(T), runId);
    const afterFresh = await selectEnrichmentCandidates(h.db, T + HOUR, TTL, COOLDOWN);
    assert.ok(!afterFresh.staleIds.includes(first!), "fresh on both providers");
    assert.ok(afterFresh.staleIds.includes(second!), "SSVC for the second is still due");
    assert.ok(!afterFresh.ssvcDue.has(first!));
    assert.ok(afterFresh.ssvcDue.has(second!));

    // TTL elapsed: due again.
    const later = await selectEnrichmentCandidates(h.db, T + TTL, TTL, COOLDOWN);
    assert.deepEqual(later.staleIds, adapterOrder, "a check exactly one TTL old is due");

    // A failed attempt inside the cooldown keeps the CVE out; after it, back in.
    await persistPostEnrich(h.db, snap({ [third!]: { epss: { state: "unavailable" }, ssvc: { state: "unavailable" } } }), iso(T + 10 * MINUTE), runId);
    const cooling = await selectEnrichmentCandidates(h.db, T + 10 * MINUTE + 30 * MINUTE, TTL, COOLDOWN);
    assert.ok(!cooling.staleIds.includes(third!), "not retried inside the one-hour cooldown");
    const retry = await selectEnrichmentCandidates(h.db, T + 10 * MINUTE + HOUR, TTL, COOLDOWN);
    assert.ok(retry.staleIds.includes(third!), "retried once the cooldown has passed");
  } finally {
    await h.close();
  }
});

test("candidates: after failed cycles four days later the same edition's due CVEs are still returned", async () => {
  const { h, cycle } = await harness();
  try {
    await cycle(T, {
      "src-a": okFeed([art(SRC_A, "Vendor patches CVE-2026-46001 in its edge gateway", "https://a.test/1", T - 2 * HOUR)]),
      "src-b": okFeed([art(SRC_B, "Agency advisory covers CVE-2026-46002 exposure", "https://b.test/1", T - 3 * HOUR)]),
    });
    await cycle(T + DAY, { "src-a": ERROR_FEED, "src-b": ERROR_FEED });
    await cycle(T + 4 * DAY, {});

    const stale = await selectEnrichmentCandidates(h.db, T + 4 * DAY, TTL, COOLDOWN);
    assert.deepEqual([...stale.staleIds].sort(), ["CVE-2026-46001", "CVE-2026-46002"]);
  } finally {
    await h.close();
  }
});

test("candidates: after a partial cycle at T + 4 days in which source B failed, B's earlier stories keep their CVEs as candidates", async () => {
  const { h, cycle } = await harness();
  try {
    await cycle(T, {
      "src-a": okFeed([art(SRC_A, "Alpha patches CVE-2026-47001 in its old gateway", "https://a.test/old", T - 3 * HOUR)]),
      "src-b": okFeed([art(SRC_B, "Bravo advisory covers CVE-2026-47002 exposure", "https://b.test/old", T - 4 * HOUR)]),
    });
    const later = T + 4 * DAY;
    await cycle(later, {
      "src-a": okFeed([art(SRC_A, "Alpha fresh report on CVE-2026-47003 exploitation", "https://a.test/new", later - HOUR)]),
      "src-b": ERROR_FEED,
    });

    const stale = await selectEnrichmentCandidates(h.db, later + HOUR, TTL, COOLDOWN);
    assert.deepEqual([...stale.staleIds].sort(), ["CVE-2026-47002", "CVE-2026-47003"], "B's T-story stays, A's window moved off its old story");
  } finally {
    await h.close();
  }
});
