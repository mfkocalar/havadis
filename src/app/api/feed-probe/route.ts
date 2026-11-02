// SCRATCH PROBE (Phase 7.1). Never staged or committed; deleted in Plan 07.1-06.
import Parser from "rss-parser";
import { SOURCES } from "../../../lib/config/sources.ts";
import { fetchSource } from "../../../lib/pipeline/fetchSource.ts";
import { applySourceWindow } from "../../../lib/pipeline/applySourceWindow.ts";
import { LOOKBACK_HOURS } from "../../../lib/config/sourceTypes.ts";
import { USER_AGENT } from "../../../lib/config/crawler.ts";
import { readBodyWithCap } from "../../../lib/pipeline/boundedFetch.ts";
import { parseFeedDate } from "../../../lib/pipeline/parseFeedDate.ts";
import type { SourceConfig } from "../../../lib/types.ts";

export const dynamic = "force-dynamic";

const ACCEPT_HEADER =
  "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.1";

const parser = new Parser();

const CANDIDATES: SourceConfig[] = [
  {
    id: "apple-security",
    name: "Apple Security Updates",
    tier: "Enterprise Security",
    sourceType: "advisory",
    lang: "en",
    family: "apple",
    url: "https://support.apple.com/en-us/rss/securityupdates.rss",
  },
  {
    id: "acsc-1",
    name: "ACSC Alerts and Advisories 1",
    tier: "Government",
    sourceType: "cert",
    lang: "en",
    family: "acsc",
    url: "https://www.cyber.gov.au/about-us/view-all-content/alerts-and-advisories/rss",
  },
  {
    id: "acsc-2",
    name: "ACSC Alerts and Advisories 2",
    tier: "Government",
    sourceType: "cert",
    lang: "en",
    family: "acsc",
    url: "https://www.cyber.gov.au/rss/advisories",
  },
  {
    id: "acsc-3",
    name: "ACSC Alerts and Advisories 3",
    tier: "Government",
    sourceType: "cert",
    lang: "en",
    family: "acsc",
    url: "https://www.cyber.gov.au/rss/alerts",
  },
];

type Raw = {
  httpStatus: number | null;
  location: string | null;
  contentType: string | null;
  bytes: number | null;
  rawItems: number | null;
  datedItems: number | null;
  ms: number;
  error?: string;
};

async function rawProbe(source: SourceConfig): Promise<Raw> {
  const t0 = performance.now();
  const out: Raw = {
    httpStatus: null,
    location: null,
    contentType: null,
    bytes: null,
    rawItems: null,
    datedItems: null,
    ms: 0,
  };
  try {
    const signal = AbortSignal.timeout(8000);
    const res = await fetch(source.url, {
      redirect: "manual",
      cache: "no-store",
      headers: { "User-Agent": USER_AGENT, Accept: ACCEPT_HEADER },
      signal,
    });
    out.httpStatus = res.status;
    out.contentType = res.headers.get("content-type");
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (loc) {
        try {
          out.location = new URL(loc, source.url).toString();
        } catch {
          out.location = loc;
        }
      }
      await res.body?.cancel().catch(() => {});
    } else if (res.status === 200) {
      const text = await readBodyWithCap(res, 12 * 1024 * 1024, signal);
      out.bytes = Buffer.byteLength(text, "utf-8");
      try {
        const feed = await parser.parseString(text);
        const items = feed.items ?? [];
        out.rawItems = items.length;
        out.datedItems = items.filter(
          (i) => !!i.isoDate || parseFeedDate(i.pubDate) !== null
        ).length;
      } catch {
        out.rawItems = -1;
      }
    } else {
      await res.body?.cancel().catch(() => {});
    }
  } catch (err) {
    out.error = err instanceof Error ? err.message : "fetch failed";
  }
  out.ms = Math.round(performance.now() - t0);
  return out;
}

function maxInSpan(times: number[], hours: number): number {
  const sorted = [...times].sort((a, b) => a - b);
  const span = hours * 3_600_000;
  let best = 0;
  let lo = 0;
  for (let hi = 0; hi < sorted.length; hi++) {
    while (sorted[hi] - sorted[lo] > span) lo++;
    best = Math.max(best, hi - lo + 1);
  }
  return best;
}

type Timing = {
  sources: number;
  candidates: number;
  timed: number;
  wallMs: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  errors: number;
  slowestId: string | null;
  slowestMs: number;
};

function timing(
  wallMs: number,
  cpu: NodeJS.CpuUsage,
  errors: number,
  rows: { id: string; ms: number }[]
): Timing {
  const slowest = rows.reduce<{ id: string; ms: number } | null>(
    (a, r) => (a === null || r.ms > a.ms ? r : a),
    null
  );
  return {
    sources: SOURCES.length,
    candidates: CANDIDATES.length,
    timed: rows.length,
    wallMs: Math.round(wallMs),
    cpuUserMs: Math.round(cpu.user / 1000),
    cpuSystemMs: Math.round(cpu.system / 1000),
    errors,
    slowestId: slowest?.id ?? null,
    slowestMs: slowest?.ms ?? 0,
  };
}

export async function GET() {
  const now = Date.now();
  const all = [...SOURCES, ...CANDIDATES];
  const configured = new Set(SOURCES.map((s) => s.id));

  // Pass A: uncached raw fetch plus parse, every source and candidate concurrently.
  const cpuA0 = process.cpuUsage();
  const tA0 = performance.now();
  const rawRows = await Promise.all(all.map(async (s) => ({ s, raw: await rawProbe(s) })));
  const wallA = performance.now() - tA0;
  const cpuA = process.cpuUsage(cpuA0);
  const rawById = new Map(rawRows.map((r) => [r.s.id, r.raw]));
  const errorsA = rawRows.filter((r) => r.raw.httpStatus !== 200 || r.raw.rawItems === -1).length;
  const fanOutA = timing(
    wallA,
    cpuA,
    errorsA,
    rawRows.map((r) => ({ id: r.s.id, ms: r.raw.ms }))
  );

  // Pass C: production fetchSource plus window, after Pass A has finished.
  const cpuC0 = process.cpuUsage();
  const tC0 = performance.now();
  const prodRows = await Promise.all(
    all.map(async (s) => {
      const t0 = performance.now();
      const result = await fetchSource(s);
      const ms = Math.round(performance.now() - t0);
      if (result.status !== "ok") {
        return {
          id: s.id,
          status: "error" as const,
          reason: result.reason,
          normalizedItems: 0,
          inWindow: 0,
          newestAgeHours: null as number | null,
          maxPerWindow: 0,
          ms,
        };
      }
      const times = result.articles
        .filter((a) => !s.titleInclude || s.titleInclude.test(a.title))
        .map((a) => Date.parse(a.publishedAt))
        .filter((t) => !Number.isNaN(t));
      const newest = times.length ? Math.max(...times) : null;
      return {
        id: s.id,
        status: "ok" as const,
        reason: undefined,
        normalizedItems: result.articles.length,
        inWindow: applySourceWindow(result.articles, s, now).length,
        newestAgeHours: newest === null ? null : Math.round(((now - newest) / 3_600_000) * 10) / 10,
        maxPerWindow: maxInSpan(times, LOOKBACK_HOURS[s.sourceType]),
        ms,
      };
    })
  );
  const wallC = performance.now() - tC0;
  const cpuC = process.cpuUsage(cpuC0);
  const errorsC = prodRows.filter((r) => r.status !== "ok").length;
  const hits = prodRows.filter((r) => {
    const rawMs = rawById.get(r.id)?.ms ?? 0;
    return r.ms < rawMs / 10;
  });
  const fanOutFetchSource = {
    ...timing(wallC, cpuC, errorsC, prodRows.map((r) => ({ id: r.id, ms: r.ms }))),
    likelyCacheHits: hits.length,
    likelyCacheHitIds: hits.map((r) => r.id).sort(),
  };

  const byId = new Map(all.map((s) => [s.id, s]));
  const feeds = prodRows
    .map((r) => {
      const s = byId.get(r.id)!;
      const rawMs = rawById.get(r.id)?.ms ?? 0;
      return {
        id: r.id,
        configured: configured.has(r.id),
        sourceType: s.sourceType,
        url: s.url,
        status: r.status,
        reason: r.reason,
        normalizedItems: r.normalizedItems,
        inWindow: r.inWindow,
        newestAgeHours: r.newestAgeHours,
        maxPerWindow: r.maxPerWindow,
        ms: r.ms,
        likelyCacheHit: r.ms < rawMs / 10,
        raw: rawById.get(r.id)!,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  return Response.json({
    sampledAt: new Date(now).toISOString(),
    fanOut: fanOutA,
    fanOutFetchSource,
    feeds,
  });
}
