import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadMigrations, runMigrations } from "./migrator.ts";
import { openDb } from "./openDb.ts";
import type { DbHandle } from "./openDb.ts";

const T = "2026-11-10T10:00:00.000Z";

async function migrated(): Promise<DbHandle> {
  const handle = openDb(":memory:", "cli");
  await runMigrations(handle, { migrations: loadMigrations(), backup: async () => null, now: () => Date.parse(T) });
  return handle;
}

/** The statement must be refused by a constraint (not by a typo), optionally naming a pattern. */
function constraint(pattern?: RegExp) {
  return (err: unknown) => {
    const e = err as { code?: string; message?: string };
    assert.match(e.code ?? "", /^SQLITE_CONSTRAINT/, `expected a constraint error, got ${e.code}: ${e.message}`);
    if (pattern) assert.match(e.message ?? "", pattern);
    return true;
  };
}

function signal(h: DbHandle, cols: Record<string, string | number | null>) {
  const names = Object.keys(cols);
  h.raw
    .prepare(`INSERT INTO cve_signals (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`)
    .run(...Object.values(cols));
}

const base = { cve_id: "CVE-2026-1234", first_seen_at: T };

function seedStory(h: DbHandle, id = "s1") {
  h.raw
    .prepare("INSERT INTO stories (id, first_seen_at, section, importance, derive_version, last_activity_at) VALUES (?, ?, 'Vulnerabilities', 'normal', 1, ?)")
    .run(id, T, T);
}

function seedSource(h: DbHandle, id = "src1") {
  h.raw
    .prepare("INSERT INTO sources (id, name, tier, source_type, family, url, lang) VALUES (?, 'n', 'Government', 'cert', 'f', 'https://example.test/feed', 'en')")
    .run(id);
}

test("timestamp CHECK accepts toISOString output and rejects seconds-only, space-separated and offset forms", async () => {
  const h = await migrated();
  const insert = (ts: string) => h.raw.prepare("INSERT INTO fetch_runs (started_at, status, \"trigger\") VALUES (?, 'ok', 't')").run(ts);
  insert(T);
  for (const bad of ["2026-11-10T10:00:00Z", "2026-11-10 10:00:00", "2026-11-10T10:00:00.000+01:00"]) {
    assert.throws(() => insert(bad), constraint(), bad);
  }
  await h.close();
});

test("cve_signals accepts consistent rows and the anchored ID shape", async () => {
  const h = await migrated();
  signal(h, { ...base });
  signal(h, { cve_id: "CVE-2026-1234567", first_seen_at: T });
  signal(h, { cve_id: "CVE-2026-2000", first_seen_at: T, kev_state: "listed", kev_added: "2026-11-01", kev_checked_at: T, kev_ransomware: 1 });
  signal(h, { cve_id: "CVE-2026-2001", first_seen_at: T, epss_state: "scored", epss_score: 0.5, epss_date: "2026-11-10", epss_checked_at: T });
  signal(h, {
    cve_id: "CVE-2026-2002", first_seen_at: T, ssvc_state: "assessed", ssvc_exploitation: "none", ssvc_automatable: "no",
    ssvc_technical_impact: "partial", ssvc_checked_at: T,
  });
  signal(h, { cve_id: "CVE-2026-2003", first_seen_at: T, kev_state: "not-listed", kev_checked_at: T });
  await h.close();
});

test("cve_signals refuses every dishonest tri-state combination", async () => {
  const h = await migrated();
  const cases: [string, Record<string, string | number | null>, RegExp][] = [
    ["not-listed without kev_checked_at", { kev_state: "not-listed" }, /kev_checked_at/],
    ["unavailable with a kev_checked_at", { kev_state: "unavailable", kev_checked_at: T }, /kev_checked_at/],
    ["assessed without exploitation", { ssvc_state: "assessed", ssvc_checked_at: T, ssvc_automatable: "no", ssvc_technical_impact: "partial" }, /ssvc_exploitation/],
    ["exploitation without assessed", { ssvc_state: "skipped", ssvc_checked_at: T, ssvc_exploitation: "none" }, /ssvc_exploitation/],
    ["scored without a score", { epss_state: "scored", epss_checked_at: T }, /epss_score/],
    ["listed without kev_added", { kev_state: "listed", kev_checked_at: T }, /kev_added/],
    ["epss score above 1", { epss_state: "scored", epss_checked_at: T, epss_score: 1.5 }, /epss_score/],
    ["an unknown kev_state", { kev_state: "maybe" }, /kev_state/],
  ];
  for (const [label, cols, pattern] of cases) {
    assert.throws(() => signal(h, { ...base, ...cols }), constraint(pattern), label);
  }
  await h.close();
});

test("cve_signals refuses malformed CVE IDs", async () => {
  const h = await migrated();
  for (const bad of ["cve-2026-1234", "CVE-26-1234", "CVE-2026-123", "CVE-2026-12345678", "CVE-2026-12a4", "CVE-2026-1234 "]) {
    assert.throws(() => signal(h, { cve_id: bad, first_seen_at: T }), constraint(), bad);
  }
  await h.close();
});

test("cve_signal_snapshots is append-only: insert works, UPDATE and DELETE raise", async () => {
  const h = await migrated();
  signal(h, { ...base });
  h.raw
    .prepare("INSERT INTO cve_signal_snapshots (cve_id, observed_at, cause, kev_state, epss_state, ssvc_state) VALUES ('CVE-2026-1234', ?, 'kev', 'unavailable', 'unavailable', 'unavailable')")
    .run(T);
  assert.throws(() => h.raw.prepare("UPDATE cve_signal_snapshots SET cause = 'epss'").run(), /cve_signal_snapshots is append-only/);
  assert.throws(() => h.raw.prepare("DELETE FROM cve_signal_snapshots").run(), /cve_signal_snapshots is append-only/);
  assert.equal((h.raw.prepare("SELECT count(*) AS n FROM cve_signal_snapshots").get() as { n: number }).n, 1);
  await h.close();
});

test("only one fetch run may be running at a time", async () => {
  const h = await migrated();
  const insert = (status: string) => h.raw.prepare("INSERT INTO fetch_runs (started_at, status, \"trigger\") VALUES (?, ?, 't')").run(T, status);
  insert("running");
  assert.throws(() => insert("running"), constraint(/fetch_runs\.status/));
  insert("ok");
  insert("ok");
  insert("abandoned");
  await h.close();
});

test("articles are unique per (source_id, canonical_url) and carry first_seen_at", async () => {
  const h = await migrated();
  seedStory(h);
  seedSource(h, "a");
  seedSource(h, "b");
  const insert = (source: string, canonical: string) =>
    h.raw
      .prepare("INSERT INTO articles (story_id, source_id, url, canonical_url, title, first_seen_at, last_seen_at) VALUES ('s1', ?, 'https://x.test/p', ?, 't', ?, ?)")
      .run(source, canonical, T, T);
  insert("a", "https://x.test/p");
  assert.throws(() => insert("a", "https://x.test/p"), constraint(/articles\.source_id, articles\.canonical_url/));
  insert("b", "https://x.test/p");
  insert("a", "https://x.test/q");
  await h.close();
});

test("stories can be merged into another story but never into themselves", async () => {
  const h = await migrated();
  seedStory(h, "s1");
  seedStory(h, "s2");
  h.raw.prepare("UPDATE stories SET merged_into = 's2' WHERE id = 's1'").run();
  assert.throws(() => h.raw.prepare("UPDATE stories SET merged_into = id WHERE id = 's2'").run(), constraint(/merged_into/));
  assert.throws(() => h.raw.prepare("UPDATE stories SET merged_into = 'nope' WHERE id = 's2'").run(), /FOREIGN KEY/);
  await h.close();
});

test("source_fetches ties reason_code to the failed outcome", async () => {
  const h = await migrated();
  seedSource(h);
  h.raw.prepare("INSERT INTO fetch_runs (id, started_at, status, \"trigger\") VALUES (1, ?, 'ok', 't')").run(T);
  const insert = (outcome: string, reason: string | null, source = "src1") =>
    h.raw.prepare("INSERT INTO source_fetches (run_id, source_id, outcome, reason_code) VALUES (1, ?, ?, ?)").run(source, outcome, reason);
  assert.throws(() => insert("failed", null), constraint());
  assert.throws(() => insert("ok", "timeout"), constraint());
  assert.throws(() => insert("exploded", null), constraint(/outcome/));
  insert("failed", "timeout");
  seedSource(h, "src2");
  insert("ok", null, "src2");
  seedSource(h, "src3");
  insert("skipped_backoff", null, "src3");
  await h.close();
});

test("the approved decisions hold: no story_events, no cves table, stories carry section and importance with derive_version and no lead", async () => {
  const h = await migrated();
  const tables = (h.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
  assert.equal(tables.includes("story_events"), false);
  assert.equal(tables.includes("cves"), false);
  assert.equal(tables.includes("cve_signals"), true);

  const storyColumns = (h.raw.prepare("PRAGMA table_info(stories)").all() as { name: string }[]).map((c) => c.name);
  for (const wanted of ["section", "importance", "importance_reason", "derive_version", "merged_into"]) {
    assert.ok(storyColumns.includes(wanted), `stories.${wanted}`);
  }
  assert.deepEqual(storyColumns.filter((c) => /lead/.test(c)), []);

  const articleColumns = (h.raw.prepare("PRAGMA table_info(articles)").all() as { name: string }[]).map((c) => c.name);
  assert.ok(articleColumns.includes("first_seen_at"));
  await h.close();
});

test("auto_vacuum is INCREMENTAL (2) after the first migration of a file database", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "havadis-av-"));
  try {
    const h = openDb(path.join(dir, "havadis.db"), "worker");
    await runMigrations(h, { migrations: loadMigrations(), backup: async () => null, now: () => Date.parse(T) });
    assert.equal(h.raw.pragma("auto_vacuum", { simple: true }), 2);
    await h.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the approved anchor index exists, is partial, and serves the newest-success query by seek", async () => {
  const h = await migrated();
  const row = h.raw.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'source_fetches_success'").get() as { sql: string } | undefined;
  assert.ok(row, "source_fetches_success exists");
  assert.match(row.sql, /source_fetches\(source_id, run_id\)/);
  assert.match(row.sql, /WHERE outcome IN \('ok','not_modified'\)/);

  const plan = h.raw
    .prepare("EXPLAIN QUERY PLAN SELECT run_id FROM source_fetches WHERE source_id = 'x' AND outcome IN ('ok','not_modified') ORDER BY run_id DESC LIMIT 1")
    .all() as { detail: string }[];
  const details = plan.map((p) => p.detail);
  assert.ok(details.some((d) => d.includes("source_fetches_success")), details.join(" | "));
  assert.deepEqual(details.filter((d) => /\bSCAN source_fetches\b/.test(d)), []);

  const indexes = (h.raw.prepare("PRAGMA index_list(source_fetches)").all() as { name: string }[])
    .map((i) => i.name)
    .filter((n) => !n.startsWith("sqlite_autoindex_"));
  assert.deepEqual(indexes, ["source_fetches_success"]);
  await h.close();
});
