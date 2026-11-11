import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../db/openDb.ts";
import type { DbHandle } from "../db/openDb.ts";
import { loadMigrations, runMigrations } from "../db/migrator.ts";
import { dbFile } from "../db/paths.ts";
import { seedBuiltins } from "../db/seed.ts";
import { readFrontPage } from "../adapters/frontPage.ts";
import { enrichmentNotice } from "../enrichment/display.ts";
import { produceKev as realProduceKev } from "../enrichment/kev.ts";
import { KEV_URL } from "../enrichment/config.ts";
import type { SafeFetch } from "../egress/safeFetch.ts";
import type { FeedFetchResult } from "../pipeline/feedResult.ts";
import { persistSsvcPositive, readKevFromDb } from "../store/signals.ts";
import { makeArticle, makeSource } from "../../../test/fixtures/makeArticle.ts";
import type { CacheableSsvcState, KevEntry, KevMap } from "../types.ts";
import { runIngestCycle } from "./cycle.ts";
import { runEnrichmentStage } from "./enrichRefresh.ts";
import type { EnrichReport, EnrichStageDeps } from "./enrichRefresh.ts";

/**
 * The enrichment stage against real database rows with injected providers: the spike (a) matrix
 * (cap, time budget, late success, keep last good), TTL and cooldown, the KEV outage rules,
 * Pitfall 13 and the rule that no transaction ever spans a network call. Nothing here reaches the
 * network: the KEV and SSVC producers and the EPSS fetcher are fakes.
 */

const T = Date.parse("2026-11-11T08:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();

const SRC_A = makeSource({ id: "src-a", name: "Source A", family: "fam-a", sourceType: "news", tier: "Security Research" });

const ASSESSED_POC: CacheableSsvcState = { state: "assessed", exploitation: "poc", automatable: "no", technicalImpact: "partial" };

const id = (n: number): string => `CVE-2026-${String(50000 + n).padStart(5, "0")}`;

type Sim = {
  h: DbHandle;
  runId: number;
  /** The stage clock; tests move it. */
  now: number;
  calls: { kev: number; ssvc: string[]; epss: string[][] };
  kev: { entries: Record<string, KevEntry>; fail: Error | null };
  epss: { fail: boolean; scores: Record<string, number> };
  ssvc: Record<string, (cve: string) => Promise<CacheableSsvcState>>;
  run: (overrides?: Partial<EnrichStageDeps>) => Promise<EnrichReport>;
  close: () => Promise<void>;
};

const OK_FEED = (articles: ReturnType<typeof makeArticle>[]): FeedFetchResult => ({
  status: "ok",
  articles,
  validators: { etag: null, lastModified: null },
  httpStatus: 200,
});

/** A migrated database with one good ingest cycle whose single story mentions every CVE in `cves`. */
async function sim(cves: readonly string[], opts: { file?: string } = {}): Promise<Sim> {
  const h = openDb(opts.file ?? ":memory:", "worker");
  await runMigrations(h, { migrations: loadMigrations(), backup: async () => null, now: () => T });
  await seedBuiltins(h.db, [SRC_A], T);
  const article = makeArticle({
    title: `Vendors patch ${cves.join(" ")} in edge gateways`,
    url: "https://a.test/story",
    source: SRC_A.name,
    sourceTier: SRC_A.tier,
    sourceType: SRC_A.sourceType,
    publishedAt: iso(T - 2 * HOUR),
  });
  const cycle = await runIngestCycle(
    h.db,
    { sources: [SRC_A], newId: () => "story-001", concurrency: 1, fetchFeed: async () => OK_FEED([article]) },
    T,
  );

  const s: Sim = {
    h,
    runId: cycle.runId,
    now: T + HOUR,
    calls: { kev: 0, ssvc: [], epss: [] },
    kev: { entries: {}, fail: null },
    epss: { fail: false, scores: Object.fromEntries(cves.map((c, i) => [c, 0.01 * (i + 1)])) },
    ssvc: {},
    run: async () => {
      throw new Error("replaced below");
    },
    close: () => h.close(),
  };

  const fetcher: SafeFetch = async (url) => {
    const ids = (new URL(url).searchParams.get("cve") ?? "").split(",").filter(Boolean);
    s.calls.epss.push(ids);
    if (s.epss.fail) return new Response("unavailable", { status: 500 });
    const data = ids
      .filter((c) => Object.hasOwn(s.epss.scores, c))
      .map((c) => ({ cve: c, epss: String(s.epss.scores[c]), percentile: "0.5", date: "2026-11-10" }));
    return new Response(JSON.stringify({ status: "OK", total: data.length, data }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const produceKev: EnrichStageDeps["produceKev"] = async (nowMs) => {
    s.calls.kev++;
    if (s.kev.fail) throw s.kev.fail;
    const map: KevMap = { version: 1, fetchedAt: iso(nowMs), catalogVersion: "2026.11.10", entries: s.kev.entries };
    return map;
  };
  const produceSsvc: EnrichStageDeps["produceSsvc"] = async (cve) => {
    s.calls.ssvc.push(cve);
    return (s.ssvc[cve] ?? (async () => ASSESSED_POC))(cve);
  };
  s.run = (overrides = {}) =>
    runEnrichmentStage(
      h.db,
      {
        fetcher,
        enrichIntervalMs: 6 * HOUR,
        cooldownMs: HOUR,
        ssvcMaxLookups: 100,
        ssvcBudgetMs: 5_000,
        produceKev,
        produceSsvc,
        ...overrides,
      },
      () => s.now,
      s.runId,
    );
  return s;
}

const signal = (s: Sim, cve: string) => s.h.db.selectFrom("cve_signals").selectAll().where("cve_id", "=", cve).executeTakeFirstOrThrow();
const observations = (s: Sim, cve: string) =>
  s.h.db.selectFrom("cve_signal_snapshots").selectAll().where("cve_id", "=", cve).orderBy("id").execute();
const provider = (s: Sim, name: "kev" | "epss" | "ssvc") =>
  s.h.db.selectFrom("provider_state").selectAll().where("provider", "=", name).executeTakeFirstOrThrow();

async function until(check: () => Promise<boolean>, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail("condition not reached in time");
}

// ---------------------------------------------------------------------------
// spike (a): cap, time budget, late success, keep last good, KEV skip
// ---------------------------------------------------------------------------

test("spike (a) replay: cap 3 and a 150 ms budget over [throws, ok, slow 400 ms, KEV-listed] keep last good, store the late success and skip the KEV-listed CVE", async () => {
  const [c1, c2, c3, c4] = [id(1), id(2), id(3), id(4)] as const;
  const s = await sim([c1, c2, c3, c4]);
  try {
    // 0001 was assessed a long time ago; its lookup will throw now.
    await persistSsvcPositive(s.h.db, c1, ASSESSED_POC, iso(T - 7 * HOUR), s.runId);
    s.kev.entries = { [c4]: { added: "2026-11-01", due: "", ransomware: false } };
    s.ssvc[c1] = async () => {
      throw new Error("boom");
    };
    s.ssvc[c3] = async () => {
      await new Promise((r) => setTimeout(r, 400));
      return ASSESSED_POC;
    };

    const report = await s.run({ ssvcMaxLookups: 3, ssvcBudgetMs: 150 });
    assert.equal(s.calls.ssvc.length, 3, "exactly the cap, the KEV-listed CVE is never looked up");
    assert.deepEqual([...s.calls.ssvc].sort(), [c1, c2, c3]);
    assert.equal(report.kev, "refreshed");
    assert.equal(report.requested, 4);
    assert.equal(report.ssvcLookups, 3);
    assert.equal(report.ssvcUnavailable, 2, "unavailable, assessed, unavailable, skipped");

    const r1 = await signal(s, c1);
    assert.deepEqual(
      [r1.ssvc_state, r1.ssvc_exploitation, r1.ssvc_checked_at, r1.ssvc_attempt_at],
      ["assessed", "poc", iso(T - 7 * HOUR), iso(s.now)],
      "a throwing lookup keeps the stored state",
    );
    assert.equal((await observations(s, c1)).filter((o) => o.cause === "ssvc").length, 1, "and writes no observation");
    assert.equal((await signal(s, c2)).ssvc_state, "assessed");
    const early3 = await signal(s, c3);
    assert.deepEqual([early3.ssvc_state, early3.ssvc_checked_at], ["unavailable", null], "the slow lookup missed the budget");
    assert.equal((await signal(s, c4)).ssvc_state, "skipped");

    // 500 ms later the late success is stored with its one observation.
    await until(async () => (await signal(s, c3)).ssvc_state === "assessed");
    const late3 = await signal(s, c3);
    assert.deepEqual([late3.ssvc_exploitation, late3.ssvc_checked_at], ["poc", iso(s.now)]);
    assert.equal((await observations(s, c3)).filter((o) => o.cause === "ssvc").length, 1);
    const r1After = await signal(s, c1);
    assert.deepEqual([r1After.ssvc_state, r1After.ssvc_exploitation], ["assessed", "poc"]);
    assert.equal((await observations(s, c1)).filter((o) => o.cause === "ssvc").length, 1);

    // The page reads these rows without any SSVC notice; the KEV-listed CVE is not a failure.
    const page = await readFrontPage(s.h.db, s.now);
    assert.equal(page.kind, "ready");
    if (page.kind !== "ready") return;
    assert.deepEqual(page.enrichment.byCve[c4]!.ssvc, { state: "skipped" });
    assert.equal(page.enrichment.byCve[c4]!.kev.state, "listed");
    assert.equal(enrichmentNotice(page.enrichment.health), null);
  } finally {
    await s.close();
  }
});

test("Pitfall 13: a KEV-listed CVE is stored skipped, never looked up, and adds no SSVC notice", async () => {
  const c = id(10);
  const s = await sim([c]);
  try {
    s.kev.entries = { [c]: { added: "2026-11-02", due: "2026-11-23", ransomware: true } };
    await s.run();
    assert.deepEqual(s.calls.ssvc, [], "no SSVC lookup for a KEV-listed CVE");
    const r = await signal(s, c);
    assert.deepEqual([r.kev_state, r.kev_ransomware, r.ssvc_state, r.ssvc_checked_at !== null], ["listed", 1, "skipped", true]);

    const page = await readFrontPage(s.h.db, s.now);
    assert.equal(page.kind, "ready");
    if (page.kind !== "ready") return;
    assert.equal(page.enrichment.health.ssvc.requested, 0);
    assert.equal(enrichmentNotice(page.enrichment.health), null);
  } finally {
    await s.close();
  }
});

test("at most HAVADIS_SSVC_MAX_LOOKUPS network lookups happen per pass, the rest stay unavailable and are retried after the cooldown", async () => {
  const ids = [1, 2, 3, 4, 5].map((n) => id(20 + n));
  const s = await sim(ids);
  try {
    const report = await s.run({ ssvcMaxLookups: 2 });
    assert.equal(s.calls.ssvc.length, 2);
    assert.equal(report.ssvcLookups, 2);
    assert.equal(report.ssvcUnavailable, 3);
    const states = await Promise.all(ids.map(async (c) => (await signal(s, c)).ssvc_state));
    assert.equal(states.filter((st) => st === "assessed").length, 2);
    assert.equal(states.filter((st) => st === "unavailable").length, 3, "a capped CVE is never presented as not assessed");

    s.now += HOUR;
    await s.run({ ssvcMaxLookups: 2 });
    assert.equal(s.calls.ssvc.length, 4, "the next pass looks up two of the remaining three");
    assert.equal(new Set(s.calls.ssvc).size, 4, "no CVE is looked up twice before its TTL");
  } finally {
    await s.close();
  }
});

test("a CVE whose SSVC is still fresh is not looked up again when only its EPSS is due", async () => {
  const [a, b] = [id(31), id(32)] as const;
  const s = await sim([a, b]);
  try {
    s.epss.fail = true;
    const first = await s.run();
    assert.equal(first.epssUnavailable, 2);
    assert.equal(s.calls.ssvc.length, 2);

    s.epss.fail = false;
    s.now += HOUR;
    const second = await s.run();
    assert.equal(s.calls.ssvc.length, 2, "no SSVC network call: both are fresh");
    assert.equal(second.ssvcLookups, 0);
    assert.equal(second.epssUnavailable, 0);
    for (const c of [a, b]) {
      const r = await signal(s, c);
      assert.equal(r.epss_state, "scored");
      assert.equal(r.ssvc_state, "assessed");
      assert.equal((await observations(s, c)).filter((o) => o.cause === "ssvc").length, 1);
    }
  } finally {
    await s.close();
  }
});

// ---------------------------------------------------------------------------
// TTL and cooldown
// ---------------------------------------------------------------------------

test("TTL: a second run inside enrichIntervalMs makes no KEV, EPSS or SSVC network call, and after it elapses the due CVEs are fetched again", async () => {
  const ids = [id(41), id(42), id(43)];
  const s = await sim(ids);
  try {
    const first = await s.run();
    assert.equal(first.kev, "refreshed");
    assert.deepEqual([s.calls.kev, s.calls.epss.length, s.calls.ssvc.length], [1, 1, 3]);
    assert.deepEqual([...s.calls.epss[0]!].sort(), ids);

    s.now += HOUR;
    const inside = await s.run();
    assert.equal(inside.kev, "fresh");
    assert.equal(inside.requested, 0);
    assert.deepEqual([s.calls.kev, s.calls.epss.length, s.calls.ssvc.length], [1, 1, 3], "zero network calls inside the interval");

    s.now += 5 * HOUR;
    const after = await s.run();
    assert.equal(after.kev, "refreshed");
    assert.equal(after.requested, 3);
    assert.deepEqual([s.calls.kev, s.calls.epss.length, s.calls.ssvc.length], [2, 2, 6], "KEV, EPSS and SSVC are fetched again");
  } finally {
    await s.close();
  }
});

test("cooldown: after a failure KEV, EPSS and SSVC are not retried before one hour, then all three are", async () => {
  const ids = [id(51), id(52)];
  const s = await sim(ids);
  try {
    s.kev.fail = new Error("socket hang up");
    s.epss.fail = true;
    for (const c of ids) s.ssvc[c] = async () => { throw new Error("unavailable"); };

    const first = await s.run();
    assert.equal(first.kev, "failed");
    assert.deepEqual([s.calls.kev, s.calls.epss.length, s.calls.ssvc.length], [1, 1, 2]);
    assert.deepEqual([(await provider(s, "epss")).last_error_code, (await provider(s, "ssvc")).last_error_code, (await provider(s, "kev")).last_error_code], ["network_error", "network_error", "network_error"]);

    s.now += 30 * MINUTE;
    const cooling = await s.run();
    assert.equal(cooling.requested, 0, "nothing is due inside the cooldown");
    assert.deepEqual([s.calls.kev, s.calls.epss.length, s.calls.ssvc.length], [1, 1, 2], "no retry before an hour");

    s.now += 30 * MINUTE;
    await s.run();
    assert.deepEqual([s.calls.kev, s.calls.epss.length, s.calls.ssvc.length], [2, 2, 4], "retried at the one-hour mark");
  } finally {
    await s.close();
  }
});

// ---------------------------------------------------------------------------
// KEV outage
// ---------------------------------------------------------------------------

test("KEV outage: a throwing produceKev keeps the previous catalog and every kev_state, records a fixed code and writes no not-listed", async () => {
  const [listed, other] = [id(61), id(62)] as const;
  const s = await sim([listed, other]);
  try {
    s.kev.entries = { [listed]: { added: "2026-11-01", due: "2026-11-22", ransomware: false } };
    await s.run();
    const before = {
      catalog: await s.h.db.selectFrom("kev_catalog").selectAll().execute(),
      listed: await signal(s, listed),
      other: await signal(s, other),
      success: (await provider(s, "kev")).last_success_at,
    };
    assert.deepEqual([before.listed.kev_state, before.other.kev_state], ["listed", "not-listed"]);

    s.now += 7 * HOUR;
    s.kev.fail = new Error("kev rejected: only 3 valid entries (minimum 1500)");
    const report = await s.run();
    assert.equal(report.kev, "failed");
    assert.deepEqual(await s.h.db.selectFrom("kev_catalog").selectAll().execute(), before.catalog, "the previous catalog stays");
    const now1 = await signal(s, listed);
    const now2 = await signal(s, other);
    assert.deepEqual([now1.kev_state, now1.kev_added, now1.kev_checked_at], ["listed", "2026-11-01", before.listed.kev_checked_at]);
    assert.deepEqual([now2.kev_state, now2.kev_checked_at], ["not-listed", before.other.kev_checked_at]);
    const state = await provider(s, "kev");
    assert.equal(state.last_error_code, "validation_failed", "a rejection is stored as a fixed code, not its message");
    assert.equal(state.last_success_at, before.success);
    assert.equal((await readKevFromDb(s.h.db)).status, "ok");

    // Any other throw is a network_error.
    s.now += HOUR;
    s.kev.fail = new Error("connect ECONNREFUSED");
    await s.run();
    assert.equal((await provider(s, "kev")).last_error_code, "network_error");
    assert.equal(JSON.stringify(await provider(s, "kev")).includes("ECONNREFUSED"), false);
  } finally {
    await s.close();
  }
});

test("KEV outage with no catalog ever: a new CVE stays kev unavailable and nothing reads as not listed", async () => {
  const c = id(71);
  const s = await sim([c]);
  try {
    s.kev.fail = new Error("socket hang up");
    const report = await s.run();
    assert.equal(report.kev, "failed");
    assert.deepEqual(await s.h.db.selectFrom("kev_catalog").selectAll().execute(), []);
    assert.deepEqual(await readKevFromDb(s.h.db), { status: "unavailable" });
    const r = await signal(s, c);
    assert.deepEqual([r.kev_state, r.kev_checked_at], ["unavailable", null]);
    assert.equal((await observations(s, c)).filter((o) => o.cause === "kev").length, 0);
  } finally {
    await s.close();
  }
});

test("a CVE first seen between KEV refreshes gets its state from the stored catalog", async () => {
  const [first, second] = [id(81), id(82)] as const;
  const s = await sim([first]);
  try {
    s.kev.entries = { [first]: { added: "2026-11-01", due: "", ransomware: false } };
    await s.run();
    assert.equal((await signal(s, first)).kev_state, "listed");

    // A later cycle introduces a CVE; the KEV catalog is still fresh.
    await s.h.db.insertInto("cve_signals").values({ cve_id: second, first_seen_at: iso(s.now) }).execute();
    s.now += HOUR;
    const report = await s.run();
    assert.equal(report.kev, "fresh");
    assert.equal(s.calls.kev, 1, "no new KEV fetch");
    assert.equal((await signal(s, second)).kev_state, "not-listed");
  } finally {
    await s.close();
  }
});

// ---------------------------------------------------------------------------
// honesty on the read side
// ---------------------------------------------------------------------------

test("a CVE never checked reads unavailable in all three providers, and when every provider failed the notice says so", async () => {
  const c = id(91);
  const s = await sim([c]);
  try {
    s.kev.fail = new Error("socket hang up");
    s.epss.fail = true;
    s.ssvc[c] = async () => { throw new Error("unavailable"); };
    await s.run();

    const page = await readFrontPage(s.h.db, s.now);
    assert.equal(page.kind, "ready");
    if (page.kind !== "ready") return;
    assert.deepEqual(page.enrichment.byCve[c], {
      kev: { state: "unavailable" },
      epss: { state: "unavailable" },
      ssvc: { state: "unavailable" },
    });
    assert.equal(enrichmentNotice(page.enrichment.health), "KEV data unavailable · EPSS data unavailable · SSVC data unavailable");
  } finally {
    await s.close();
  }
});

// ---------------------------------------------------------------------------
// no transaction spans a network call
// ---------------------------------------------------------------------------

test("the stage opens no transaction around produceKev, the EPSS fetch or produceSsvc: a second connection writes mid-call without SQLITE_BUSY", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "havadis-enrich-"));
  const c = id(95);
  const s = await sim([c], { file: dbFile(dir) });
  const other = openDb(dbFile(dir), "cli");
  try {
    other.raw.pragma("busy_timeout = 0"); // a held write lock fails at once instead of waiting
    let writes = 0;
    const failures: unknown[] = [];
    const probe = (): void => {
      try {
        other.raw.prepare("INSERT INTO meta(key, value) VALUES (?, ?)").run(`probe-${writes++}`, "x");
      } catch (err) {
        failures.push(err);
      }
    };
    const innerEpss: SafeFetch = async (url) => {
      probe();
      const ids = (new URL(url).searchParams.get("cve") ?? "").split(",").filter(Boolean);
      const data = ids.map((cve) => ({ cve, epss: "0.2", percentile: "0.5", date: "2026-11-10" }));
      return new Response(JSON.stringify({ status: "OK", total: data.length, data }), { status: 200 });
    };
    const report = await s.run({
      fetcher: innerEpss,
      produceKev: async (nowMs) => {
        probe();
        return { version: 1, fetchedAt: iso(nowMs), catalogVersion: "v", entries: {} };
      },
      produceSsvc: async () => {
        probe();
        return ASSESSED_POC;
      },
    });
    assert.deepEqual(failures, [], "no write was ever refused");
    assert.equal(writes, 3, "one probe per provider call");
    assert.equal(report.kev, "refreshed");
    assert.equal(report.ssvcLookups, 1);
    assert.equal((await signal(s, c)).epss_state, "scored");
  } finally {
    await other.close();
    await s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the real produceKev runs behind the stage with the injected fetcher", async () => {
  const c = id(97);
  const s = await sim([c]);
  try {
    const feed = {
      catalogVersion: "2026.11.10",
      count: 2,
      vulnerabilities: [
        { cveID: c, dateAdded: "2026-11-01", dueDate: "2026-11-22", knownRansomwareCampaignUse: "Known" },
        { cveID: "CVE-2026-99999", dateAdded: "2026-11-02", dueDate: "", knownRansomwareCampaignUse: "Unknown" },
      ],
    };
    const fetcher: SafeFetch = async (url) => {
      if (url === KEV_URL) return new Response(JSON.stringify(feed), { status: 200 });
      return new Response(JSON.stringify({ status: "OK", total: 0, data: [] }), { status: 200 });
    };
    const report = await s.run({ fetcher, produceKev: (nowMs, d) => realProduceKev(nowMs, { ...d, minEntries: 1 }) });
    assert.equal(report.kev, "refreshed");
    const r = await signal(s, c);
    assert.deepEqual([r.kev_state, r.kev_added, r.kev_due, r.kev_ransomware], ["listed", "2026-11-01", "2026-11-22", 1]);
    assert.equal((await provider(s, "kev")).catalog_version, "2026.11.10");
  } finally {
    await s.close();
  }
});
