import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A hermetic, local-only HTTP fixture used exclusively by the test suite to
 * prove the enrichment fetchers' failure isolation against real sockets
 * (Phase 7, ROADMAP SC2): EPSS routes here, and Plan 07-04 adds the KEV routes.
 * A sibling of `hostileRedirectServer.ts`, which is deliberately not grown.
 *
 * Binds to `127.0.0.1` only, on an OS-assigned ephemeral port (`0`), so it can
 * never be reached off-host and never collides with another process's port.
 * No file under `src/app`, `src/components`, or non-test `src/lib` may import
 * this module — it exists only for the test process (threat T-01-12
 * convention).
 *
 * Every route returns a REAL HTTP response over a real socket. Routes that
 * repeat (`/slow-body`, `/oversize`) use a timer; every such timer is tracked
 * in `activeTimers`, `unref()`-ed so it can never by itself keep the event
 * loop alive, cleared from the response's own `close` event, and cleared again
 * (for any survivor) inside the exported `close()` handle before
 * `closeAllConnections()` runs.
 *
 * EPSS routes read the `cve` query parameter (a comma-separated ID list, as
 * FIRST's API takes it) and every request's path plus query is appended to
 * `requests`, so a test can assert the request count and shape.
 */

/** IDs the consistent EPSS routes answer without a row (FIRST's "no EPSS yet"). */
export const EPSS_NO_ROW_IDS: ReadonlySet<string> = new Set(["CVE-2024-10003", "CVE-2024-10077"]);

/** IDs whose batch `/epss-partial` answers with a 500. */
export const EPSS_FAIL_IDS: ReadonlySet<string> = new Set(["CVE-2024-10100"]);

/**
 * A deterministic EPSS score string with nine decimals in [0, 1], derived from
 * the digits of the ID, in FIRST's own string format (e.g. "0.123456789").
 */
export function epssFixtureScore(id: string): string {
  const digits = Number(id.replace(/\D/g, "")) || 0;
  return ((digits % 999_983) / 999_983).toFixed(9);
}

export type EnrichmentServer = {
  /** e.g. "http://127.0.0.1:54321" — no trailing slash. */
  baseUrl: string;
  /** Every request's path plus query, in arrival order. */
  requests: string[];
  /** Closes the server and force-drops any still-open sockets. */
  close: () => Promise<void>;
};

const FIXTURE_DATE = "2026-10-09";

function epssRow(cve: string, epss: string = epssFixtureScore(cve)) {
  return { cve, epss, percentile: "0.5", date: FIXTURE_DATE };
}

function epssBody(data: unknown[], total: number = data.length): string {
  return JSON.stringify({
    status: "OK",
    "status-code": 200,
    version: "1.0",
    access: "public",
    total,
    offset: 0,
    limit: 100,
    data,
  });
}

function sendJson(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

export async function startEnrichmentServer(): Promise<EnrichmentServer> {
  const activeTimers = new Set<NodeJS.Timeout>();
  const requests: string[] = [];

  const track = (res: http.ServerResponse, timer: NodeJS.Timeout) => {
    timer.unref();
    activeTimers.add(timer);
    res.on("close", () => {
      clearInterval(timer);
      activeTimers.delete(timer);
    });
  };

  const server = http.createServer((req, res) => {
    requests.push(req.url ?? "/");
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "placeholder"}`);
    const requested = (url.searchParams.get("cve") ?? "").split(",").filter((c) => c !== "");
    const scoredRows = () =>
      requested.filter((c) => !EPSS_NO_ROW_IDS.has(c)).map((c) => epssRow(c));

    switch (url.pathname) {
      case "/epss-ok": {
        sendJson(res, 200, epssBody(scoredRows()));
        return;
      }

      case "/epss-partial": {
        // A 500 for the batch that contains a failing ID, a normal answer otherwise.
        if (requested.some((c) => EPSS_FAIL_IDS.has(c))) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("internal error");
          return;
        }
        sendJson(res, 200, epssBody(scoredRows()));
        return;
      }

      case "/epss-inconsistent": {
        // Claims one more row than it carries: FIRST's silent-truncation shape.
        const data = scoredRows();
        sendJson(res, 200, epssBody(data, data.length + 1));
        return;
      }

      case "/epss-hostile": {
        // A status OK, total-consistent answer whose rows are hostile. For
        // the requested IDs in order: [0] "NaN", [1] "1e999", [2] "-1",
        // [3] "2" (clamped), [4] a valid row followed by a later conflicting
        // one. Plus rows for an unrequested ID, "__proto__" and a markup-
        // wrapped ID. The row count stays within the request size, so the
        // batch is consistent and the per-row validation is what is tested.
        const data: unknown[] = [];
        const bad = ["NaN", "1e999", "-1", "2"];
        bad.forEach((epss, i) => {
          if (requested[i] !== undefined) data.push(epssRow(requested[i], epss));
        });
        if (requested[4] !== undefined) {
          data.push(epssRow(requested[4], "0.400000000"));
          data.push(epssRow(requested[4], "0.900000000"));
        }
        data.push(epssRow("CVE-2099-99999", "0.5"));
        data.push(epssRow("__proto__", "0.5"));
        data.push(epssRow(`<img src=x onerror=alert(1)>${requested[0] ?? "CVE-2024-0001"}`, "0.5"));
        sendJson(res, 200, epssBody(data));
        return;
      }

      case "/hang": {
        // Never responds and never ends the connection: proves the per-batch
        // time budget fires.
        return;
      }

      case "/slow-body": {
        // Headers arrive instantly, then one byte drips every ~50 ms forever:
        // the size cap can never rescue this case, only the time budget can.
        res.writeHead(200, { "Content-Type": "application/json" });
        res.write('{"status":');
        track(
          res,
          setInterval(() => {
            res.write(" ");
          }, 50)
        );
        return;
      }

      case "/oversize": {
        // A JSON-looking stream far past 1 MiB (it stops itself at 8 MiB), so
        // only the byte cap can stop it.
        res.writeHead(200, { "Content-Type": "application/json" });
        res.write('{"status":"OK","data":[');
        const chunk = `"${"x".repeat(65_534)}",`;
        let sent = 0;
        track(
          res,
          setInterval(() => {
            res.write(chunk);
            sent += chunk.length;
            if (sent > 8 * 1024 * 1024) res.end();
          }, 2)
        );
        return;
      }

      case "/status-500": {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end('{"status":"error"}');
        return;
      }

      case "/malformed": {
        // A 200 whose body is not JSON.
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"status":"OK","total":');
        return;
      }

      case "/html": {
        // A 200 HTML page, as a captive portal or an error page would send.
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<!doctype html><html><body><h1>Service notice</h1></body></html>");
        return;
      }

      default: {
        res.writeHead(404);
        res.end();
        return;
      }
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        for (const timer of activeTimers) {
          clearInterval(timer);
        }
        activeTimers.clear();
        // Forcibly drops the /hang, /slow-body and /oversize sockets, so
        // teardown can never block on a connection designed to never end.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
