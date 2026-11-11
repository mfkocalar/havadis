import type { Kysely, Updateable } from "kysely";
import { openDb } from "../../src/lib/db/openDb.ts";
import type { CveSignalsTable, Database } from "../../src/lib/db/schema.ts";
import { dbFile } from "../../src/lib/db/paths.ts";
import { loadMigrations, runMigrations } from "../../src/lib/db/migrator.ts";
import { seedBuiltins } from "../../src/lib/db/seed.ts";
import { SOURCES } from "../../src/lib/config/sources.ts";
import type { FeedFetchResult } from "../../src/lib/pipeline/feedResult.ts";
import { recordProviderAttempt } from "../../src/lib/store/signals.ts";
import { runIngestCycle } from "../../src/lib/worker/cycle.ts";
import type { Article, SourceConfig } from "../../src/lib/types.ts";

/**
 * Seeds a temp database for the production page test through the real ingest cycle, so the page is
 * proved against rows the worker writes, never against hand-written inserts.
 *
 * Test-only module: no file under `src` may import it (same convention as `makeArticle.ts`). It is
 * a factory with no import-time side effects: nothing runs until `seedPageFixtureDb` is called.
 *
 * Three cycles, oldest first:
 *   1. a good (partial) cycle `PAGE_FIXTURE_AGE_MS` before `now`: twelve sources, one of which
 *      fails, the rest publishing deterministic articles 1 to 20 hours before it;
 *   2. a partial cycle `PAGE_FIXTURE_PARTIAL_AGE_MS` before `now` in which only source F succeeds,
 *      with one fresh article, so F's window moves forward and every other source keeps its own;
 *   3. a failed cycle at `now` in which every source fails.
 * The page read that follows therefore happens four days after the good cycle.
 *
 * After the cycles, enrichment rows are written directly with SQL that satisfies the table's CHECKs
 * (the enrichment stage needs the network, which the fixture never has): one KEV-listed CVE, one
 * EPSS-scored CVE and one SSVC-assessed CVE (exploitation active), each in a story that is still
 * shown, plus untouched CVEs that read `unavailable`. KEV provider health reads ok at read time.
 */

/** Age of the good cycle at read time: four days, far outside every lookback window. */
export const PAGE_FIXTURE_AGE_MS = 4 * 86_400_000;

/** Age of the partial cycle at read time: one day. */
export const PAGE_FIXTURE_PARTIAL_AGE_MS = 86_400_000;

/**
 * Plain ASCII titles with no character HTML or XML escapes, none normalizing equal to another
 * fixture title and none carrying a CVE ID. `kept` is published by K, which fails in the partial
 * cycle; `agedOut` by F, whose window moves forward in it; `fresh` by F inside it.
 */
export const PAGE_FIXTURE_TITLES = {
  kept: "Harbor lighting audit finds quiet corners still unmapped",
  fresh: "Orchard bridge survey notes a calm week for fiber routes",
  agedOut: "Lantern pier schedule changes announced for the winter ferry",
} as const;

/**
 * CVE ids of the pool titles above that carry enrichment rows. Each sits in a story published by a
 * source that failed in the partial cycle, so the story is still on the page. `untouched` ids keep
 * the all-unavailable defaults the cycle wrote.
 */
export const PAGE_FIXTURE_CVES = {
  kev: "CVE-2026-20011",
  epss: "CVE-2026-20012",
  ssvc: "CVE-2026-20041",
  untouched: ["CVE-2026-20013", "CVE-2026-20077"],
} as const;

/** F's second article of the good cycle; it ages out with `agedOut`. */
const F_OTHER_TITLE = "Dock crane maintenance slot moves to Thursday morning";

/** Titles that classify across all seven sections: 12 Vulnerabilities, 5 Ransomware, 5 Breaches, 4 Advisories, 5 Threat Intelligence, 4 Tools/Techniques, 5 Industry/Policy. */
const POOL_TITLES: readonly string[] = [
  "CVE-2026-20011 flaw in the Larch gateway lets guests leave their sandbox",
  "CVE-2026-20012 and CVE-2026-20013 patched in the Willow mail server",
  "Vendor ships patch for flaw in the Cedar print spooler",
  "Researchers detail an exploit chain against the Maple router firmware",
  "Critical vulnerability found in Birch backup agent",
  "Patch released for the Alder file sync vulnerability",
  "CVE-2026-20041 exploit code released for the Aspen wiki plugin",
  "Flaw in Poplar badge readers allows door unlocking",
  "Elm database driver vulnerability fixed after report",
  "Remote code execution flaw hits the Hazel calendar server",
  "CVE-2026-20077 flaw affects the Rowan ticket portal",
  "Fir VPN client patched against local privilege flaw",
  "Ransomware crew locks down a regional hospital network",
  "New malware family targets Linux file servers",
  "Trojan hides inside a cracked design suite installer",
  "Ransom note appears on a county records system",
  "Malware loader spreads through fake invoice emails",
  "Retailer confirms breach of loyalty program accounts",
  "Customer data leaked from a travel booking site",
  "Hosting firm compromised through a stolen admin token",
  "Marketing vendor breach exposes subscriber lists",
  "School district reports unauthorized access to records",
  "Agency advisory urges review of exposed management ports",
  "Security bulletin lists fixes for the Dogwood suite",
  "Regulator warns banks about a fake support line scam",
  "Joint advisory describes safe configuration for edge devices",
  "APT group shifts to cloud storage for command channels",
  "Threat actor advertises access to shipping networks",
  "State-sponsored campaign targets ministry staff",
  "Threat group reuses old infrastructure in new campaign",
  "Nation-state operators probe energy suppliers",
  "New open source tool maps exposed storage buckets",
  "Technique for tracing phishing kits gains traction",
  "Framework lets teams replay network captures",
  "Defense playbook for small teams published",
  "Council votes on rules for connected car software",
  "Survey finds hiring slows for entry level roles",
  "Standards body opens draft for review",
  "Conference announces speaker lineup for spring",
  "Union of banks funds a skills program",
];

/** The twelve sources of the fixture, by id in SOURCES. */
const F_ID = "dark-reading";
const K_ID = "bleeping-computer";
const FAILING_ID = "hackread";
const PUBLISHER_IDS = [
  "krebs",
  "hacker-news",
  "help-net-security",
  "techcrunch-security",
  "cso-online",
  "databreaches",
  "computer-weekly",
  "cisa",
  "graham-cluley",
] as const;

const HOUR = 3_600_000;
const MINUTE = 60_000;

const ERROR_RESULT: FeedFetchResult = { status: "error", code: "network_error", httpStatus: null, retryAfterMs: null };

function source(id: string): SourceConfig {
  const found = SOURCES.find((s) => s.id === id);
  if (!found) throw new Error(`fixture source ${id} is not in SOURCES`);
  return found;
}

function article(from: SourceConfig, title: string, slug: string, publishedAt: number): Article {
  return {
    title,
    url: `https://${from.id}.fixture.test/p/${slug}`,
    source: from.name,
    sourceTier: from.tier,
    sourceType: from.sourceType,
    publishedAt: new Date(publishedAt).toISOString(),
    summary: "A short fixture summary.",
  };
}

function ok(articles: Article[]): FeedFetchResult {
  return { status: "ok", articles, validators: { etag: null, lastModified: null }, httpStatus: 200 };
}

const DAY = 86_400_000;

/**
 * Gives three CVEs real enrichment rows and marks the KEV provider as last succeeded at `now`, so
 * KEV health reads ok at read time. Each update must hit exactly one row: a CVE the cycle did not
 * create would otherwise leave the page with no chip and the chip tests with nothing to prove.
 */
async function writeEnrichment(db: Kysely<Database>, now: number): Promise<void> {
  const checkedAt = new Date(now).toISOString();
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const updates: Array<[string, Updateable<CveSignalsTable>]> = [
    [
      PAGE_FIXTURE_CVES.kev,
      {
        kev_state: "listed",
        kev_added: day(now - 3 * DAY),
        kev_due: day(now + 18 * DAY),
        kev_ransomware: 0,
        kev_checked_at: checkedAt,
        ssvc_state: "skipped",
        ssvc_checked_at: checkedAt,
      },
    ],
    [
      PAGE_FIXTURE_CVES.epss,
      {
        kev_state: "not-listed",
        kev_checked_at: checkedAt,
        epss_state: "scored",
        epss_score: 0.42,
        epss_date: day(now - DAY),
        epss_checked_at: checkedAt,
      },
    ],
    [
      PAGE_FIXTURE_CVES.ssvc,
      {
        kev_state: "not-listed",
        kev_checked_at: checkedAt,
        ssvc_state: "assessed",
        ssvc_exploitation: "active",
        ssvc_automatable: "yes",
        ssvc_technical_impact: "total",
        ssvc_checked_at: checkedAt,
      },
    ],
  ];
  for (const [cveId, set] of updates) {
    const result = await db.updateTable("cve_signals").set(set).where("cve_id", "=", cveId).executeTakeFirst();
    if (Number(result.numUpdatedRows) !== 1) throw new Error(`fixture CVE ${cveId} has no cve_signals row to enrich`);
  }
  await recordProviderAttempt(db, "kev", { ok: true, catalogVersion: "2026.11.10" }, checkedAt);
}

/**
 * Opens `dbFile(dir)` as the worker, migrates and seeds it, and runs the three cycles described
 * above with injected feeds. Closes the handle and returns the file and the two cycle times.
 */
export async function seedPageFixtureDb(
  dir: string,
  now: number,
): Promise<{ dbFile: string; goodAt: number; partialAt: number }> {
  const file = dbFile(dir);
  const goodAt = now - PAGE_FIXTURE_AGE_MS;
  const partialAt = now - PAGE_FIXTURE_PARTIAL_AGE_MS;

  const F = source(F_ID);
  const K = source(K_ID);
  const failing = source(FAILING_ID);
  const publishers = PUBLISHER_IDS.map(source);
  const cycleSources = [F, K, failing, ...publishers];

  // The pool goes round-robin over the nine publishers and K; K also publishes `kept`.
  const bearers = [K, ...publishers];
  const byBearer = new Map<string, Article[]>(bearers.map((b) => [b.id, []]));
  POOL_TITLES.forEach((title, i) => {
    const bearer = bearers[i % bearers.length]!;
    const hoursBefore = 1 + ((i * 7) % 19);
    byBearer.get(bearer.id)!.push(article(bearer, title, `pool-${i}`, goodAt - hoursBefore * HOUR - i * MINUTE));
  });
  byBearer.get(K.id)!.push(article(K, PAGE_FIXTURE_TITLES.kept, "kept", goodAt - 2 * HOUR - 13 * MINUTE));

  const goodFeeds = new Map<string, FeedFetchResult>();
  for (const bearer of bearers) goodFeeds.set(bearer.id, ok(byBearer.get(bearer.id)!));
  goodFeeds.set(
    F.id,
    ok([
      article(F, PAGE_FIXTURE_TITLES.agedOut, "aged-out", goodAt - 3 * HOUR - 7 * MINUTE),
      article(F, F_OTHER_TITLE, "f-other", goodAt - 5 * HOUR),
    ]),
  );
  goodFeeds.set(failing.id, ERROR_RESULT);

  const partialFeeds = new Map<string, FeedFetchResult>([
    [F.id, ok([article(F, PAGE_FIXTURE_TITLES.fresh, "fresh", partialAt - HOUR)])],
  ]);

  const handle = openDb(file, "worker");
  try {
    await runMigrations(handle, { migrations: loadMigrations(), backup: async () => null, now: () => now });
    await seedBuiltins(handle.db, SOURCES, now);
    let counter = 0;
    const newId = () => `fixture-story-${String(++counter).padStart(4, "0")}`;
    const cycle = (at: number, feeds: ReadonlyMap<string, FeedFetchResult>) =>
      runIngestCycle(
        handle.db,
        { sources: cycleSources, newId, fetchFeed: async (s) => feeds.get(s.id) ?? ERROR_RESULT },
        at,
      );
    await cycle(goodAt, goodFeeds);
    await cycle(partialAt, partialFeeds);
    await cycle(now, new Map());
    await writeEnrichment(handle.db, now);
  } finally {
    await handle.close();
  }
  return { dbFile: file, goodAt, partialAt };
}
