import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ENRICH_RETRY_COOLDOWN_MS,
  HEALTH_STALE_FACTOR,
  INTERVAL_JITTER_RATIO,
  LEASE_TTL_MS,
  WORKER_HEARTBEAT_MS,
  WORKER_START_JITTER_MS,
  WORKER_TICK_MS,
  loadConfig,
  parseAllowHosts,
} from "./env.ts";
import type { HavadisConfig } from "./env.ts";

function refused(env: Record<string, string | undefined>): { variable: string; message: string } {
  const r = loadConfig(env);
  assert.equal(r.ok, false, JSON.stringify(env));
  if (r.ok) throw new Error("unreachable");
  return r;
}

test("loadConfig({}) returns the documented defaults", () => {
  const r = loadConfig({});
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.config, {
    baseUrl: "http://localhost:4000",
    ingestIntervalMs: 900_000,
    enrichIntervalMs: 21_600_000,
    ssvcMaxLookups: 300,
    ssvcBudgetMs: 60_000,
    fetchConcurrency: 8,
    egressAllowHosts: [],
    logLevel: "info",
  });
});

test("an empty string means unset for every variable", () => {
  const env = Object.fromEntries(
    [
      "HAVADIS_BASE_URL", "HAVADIS_INGEST_INTERVAL_MINUTES", "HAVADIS_ENRICH_INTERVAL_HOURS",
      "HAVADIS_SSVC_MAX_LOOKUPS", "HAVADIS_SSVC_BUDGET_MS", "HAVADIS_FETCH_CONCURRENCY",
      "HAVADIS_EGRESS_ALLOW_HOSTS", "HAVADIS_LOG_LEVEL",
    ].map((name) => [name, ""]),
  );
  const r = loadConfig(env);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.config.ingestIntervalMs, 900_000);
});

const BOUNDS: Array<[string, string, number, number, (c: HavadisConfig) => number, number]> = [
  ["HAVADIS_INGEST_INTERVAL_MINUTES", "ingest", 5, 1440, (c) => c.ingestIntervalMs, 60_000],
  ["HAVADIS_ENRICH_INTERVAL_HOURS", "enrich", 1, 168, (c) => c.enrichIntervalMs, 3_600_000],
  ["HAVADIS_SSVC_MAX_LOOKUPS", "lookups", 0, 5000, (c) => c.ssvcMaxLookups, 1],
  ["HAVADIS_SSVC_BUDGET_MS", "budget", 1000, 600_000, (c) => c.ssvcBudgetMs, 1],
  ["HAVADIS_FETCH_CONCURRENCY", "concurrency", 1, 32, (c) => c.fetchConcurrency, 1],
];

function okConfig(env: Record<string, string | undefined>): HavadisConfig | null {
  const r = loadConfig(env);
  return r.ok ? r.config : null;
}

for (const [variable, label, min, max, pick, unit] of BOUNDS) {
  test(`${label}: bounds are inclusive (${min} and ${max} pass, ${min - 1} and ${max + 1} fail)`, () => {
    assert.equal(pick(okConfig({ [variable]: String(min) })!), min * unit);
    assert.equal(pick(okConfig({ [variable]: String(max) })!), max * unit);
    if (min > 0) assert.equal(refused({ [variable]: String(min - 1) }).variable, variable);
    assert.equal(refused({ [variable]: String(max + 1) }).variable, variable);
  });

  test(`${label}: non-decimal or padded values are refused naming the variable`, () => {
    for (const bad of ["15m", "1e3", "-5", "0x10", " 15 ", "1.5", "+7", "٣"]) {
      const r = refused({ [variable]: bad });
      assert.equal(r.variable, variable, bad);
      assert.ok(r.message.includes(variable), bad);
    }
  });
}

test("HAVADIS_BASE_URL accepts http and https and removes a trailing slash", () => {
  assert.equal(okConfig({ HAVADIS_BASE_URL: "https://news.corp.example/" })!.baseUrl, "https://news.corp.example");
  assert.equal(okConfig({ HAVADIS_BASE_URL: "http://localhost:4000" })!.baseUrl, "http://localhost:4000");
  assert.equal(okConfig({ HAVADIS_BASE_URL: "https://corp.example/havadis/" })!.baseUrl, "https://corp.example/havadis");
});

test("HAVADIS_BASE_URL refuses other schemes, userinfo, query, fragment and garbage", () => {
  for (const bad of [
    "ftp://x.example", "javascript:alert(1)", "//x.example", "not a url", "x.example",
    "https://user:pw@x.example", "https://user@x.example", "https://@x.example",
    "https://x.example/?a=1", "https://x.example?", "https://x.example/#frag", "https://x.example#",
    " https://x.example",
  ]) {
    assert.equal(refused({ HAVADIS_BASE_URL: bad }).variable, "HAVADIS_BASE_URL", bad);
  }
});

test("HAVADIS_LOG_LEVEL accepts the four levels and refuses anything else", () => {
  for (const level of ["debug", "info", "warn", "error"] as const) {
    assert.equal(okConfig({ HAVADIS_LOG_LEVEL: level })!.logLevel, level);
  }
  assert.equal(refused({ HAVADIS_LOG_LEVEL: "verbose" }).variable, "HAVADIS_LOG_LEVEL");
  assert.equal(refused({ HAVADIS_LOG_LEVEL: "INFO" }).variable, "HAVADIS_LOG_LEVEL");
});

test("loadConfig carries a parsed allow-list through", () => {
  const config = okConfig({ HAVADIS_EGRESS_ALLOW_HOSTS: "feeds.corp.example, 10.0.0.5" })!;
  assert.deepEqual(config.egressAllowHosts, ["feeds.corp.example", "10.0.0.5"]);
});

test("SAFE-01/empty: unset, empty and whitespace-and-commas yield an empty allow-list", () => {
  for (const raw of [undefined, "", "   ", ",", " , ,, ", "\t,\n"]) {
    assert.deepEqual(parseAllowHosts(raw), { ok: true, hosts: [] }, JSON.stringify(raw));
  }
  assert.deepEqual(okConfig({ HAVADIS_EGRESS_ALLOW_HOSTS: " , " })!.egressAllowHosts, []);
});

test("parseAllowHosts normalises hostnames and literal IPs (lowercase, brackets removed)", () => {
  assert.deepEqual(parseAllowHosts("feeds.corp.example, 10.0.0.5 ,::1,[fd00::1]"), {
    ok: true,
    hosts: ["feeds.corp.example", "10.0.0.5", "::1", "fd00::1"],
  });
  assert.deepEqual(parseAllowHosts("Feeds.Corp.EXAMPLE,[FD00::A],localhost,a-b.c1.example"), {
    ok: true,
    hosts: ["feeds.corp.example", "fd00::a", "localhost", "a-b.c1.example"],
  });
});

test("parseAllowHosts refuses CIDR, wildcard, scheme, port, path, userinfo and short-form IPv4", () => {
  const bad = [
    "10.0.0.0/8", "*.corp.example", "https://x.example", "x.example:8443", "x.example/feed", "user@x.example",
    "127.1", "1.2.3", "0x7f.1", "2130706433", "0177.0.0.1", "10.0.0.5:80", "[fd00::1]:8443", "fd00::1/64",
    "fe80::1%eth0", "-x.example", "x-.example", "x..example", "x.example.", "under_score.example", "bücher.example",
    "a".repeat(64) + ".example", Array.from({ length: 64 }, () => "abcd").join(".") + ".example",
  ];
  for (const entry of bad) {
    const r = parseAllowHosts(`ok.example,${entry}`);
    assert.equal(r.ok, false, entry);
    if (!r.ok) assert.ok(r.message.includes("HAVADIS_EGRESS_ALLOW_HOSTS"), entry);
  }
});

test("parseAllowHosts accepts a 63-character label and a name of exactly 253 characters", () => {
  assert.equal(parseAllowHosts("a".repeat(63) + ".example").ok, true);
  const name = [63, 63, 63, 61].map((n) => "a".repeat(n)).join(".");
  assert.equal(name.length, 253);
  assert.equal(parseAllowHosts(name).ok, true);
  assert.equal(parseAllowHosts(name + "a").ok, false);
});

test("loadConfig refuses a bad allow-list naming HAVADIS_EGRESS_ALLOW_HOSTS", () => {
  const r = refused({ HAVADIS_EGRESS_ALLOW_HOSTS: "10.0.0.0/8" });
  assert.equal(r.variable, "HAVADIS_EGRESS_ALLOW_HOSTS");
  assert.ok(!r.message.includes("10.0.0.0/8"));
});

test("worker timing constants carry the documented values", () => {
  assert.equal(WORKER_TICK_MS, 15_000);
  assert.equal(WORKER_HEARTBEAT_MS, 15_000);
  assert.equal(WORKER_START_JITTER_MS, 5_000);
  assert.equal(INTERVAL_JITTER_RATIO, 0.1);
  assert.equal(LEASE_TTL_MS, 600_000);
  assert.equal(ENRICH_RETRY_COOLDOWN_MS, 3_600_000);
  assert.equal(HEALTH_STALE_FACTOR, 3);
});

test("tsconfig.json enforces erasableSyntaxOnly and verbatimModuleSyntax", () => {
  const tsconfig = JSON.parse(readFileSync(new URL("../../../tsconfig.json", import.meta.url), "utf8"));
  assert.equal(tsconfig.compilerOptions.erasableSyntaxOnly, true);
  assert.equal(tsconfig.compilerOptions.verbatimModuleSyntax, true);
});
