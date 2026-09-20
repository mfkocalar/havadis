import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A hermetic, local-only HTTP fixture used exclusively by the test suite to
 * prove `fetchWithValidatedRedirect`'s reject and timeout branches — the
 * branches real Krebs on Security traffic never exercises, because Krebs's
 * own configured redirect is same-host and HTTPS (RESEARCH.md Pitfall P1-3).
 *
 * Binds to `127.0.0.1` only, on an OS-assigned ephemeral port (`0`), so it
 * can never be reached off-host and never collides with another process's
 * port. No file under `src/app`, `src/components`, or `src/lib` may import
 * this module — it exists only for the test process (threat T-01-12).
 *
 * Every route below returns a REAL HTTP response over a real socket; none
 * of the redirect targets these routes point to are ever actually
 * connected to by a correctly-behaving caller, because
 * `fetchWithValidatedRedirect` rejects an invalid target before issuing a
 * second request. That is exactly the property these routes exist to
 * prove.
 *
 * Two routes below (/slow-body, /drip-then-complete) exercise the branch
 * /hang does NOT cover: /hang withholds response headers entirely, so the
 * caller never gets past the connect/header phase. /slow-body and
 * /drip-then-complete instead send headers instantly and then either stall
 * or trickle the body that follows, proving the per-source time budget
 * spans the body-read phase too, not just the header phase. Both routes
 * use a repeating timer; every such timer is tracked in `activeTimers`
 * below, `unref()`-ed so it can never by itself keep the event loop alive,
 * cleared from the response's own `close` event, and cleared again (for
 * any survivor) inside the exported `close()` handle before
 * `closeAllConnections()` runs.
 */

const MINIMAL_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Hostile Fixture Feed</title>
    <item>
      <title>Fixture Item</title>
      <link>https://example.test/fixture-item</link>
      <pubDate>Mon, 01 Jan 2026 00:00:00 GMT</pubDate>
      <description>fixture item for the same-host follow branch</description>
    </item>
  </channel>
</rss>`;

export type HostileServer = {
  /** e.g. "http://127.0.0.1:54321" — no trailing slash. */
  baseUrl: string;
  /** Closes the server and force-drops any still-open sockets (the hang endpoint's). */
  close: () => Promise<void>;
};

export async function startHostileServer(): Promise<HostileServer> {
  // Every repeating timer the /slow-body and /drip-then-complete routes
  // create is tracked here so close() can clear any survivor before
  // closeAllConnections() runs, in addition to each route's own
  // response-"close"-event cleanup.
  const activeTimers = new Set<NodeJS.Timeout>();

  const server = http.createServer((req, res) => {
    const requestHost = req.headers.host ?? "";
    const hostnameOnly = requestHost.split(":")[0];
    const url = new URL(req.url ?? "/", `http://${requestHost || "placeholder"}`);

    switch (url.pathname) {
      case "/cross-host": {
        // A redirect to a wholly different host — the plain SSRF case.
        res.writeHead(302, { Location: "https://evil.example.com/" });
        res.end();
        return;
      }

      case "/non-https": {
        // Same host as the original request, but the target scheme is not
        // HTTPS — must be rejected on protocol before host is even checked.
        res.writeHead(302, { Location: `http://${requestHost}/feed-ok` });
        res.end();
        return;
      }

      case "/prefix-lookalike": {
        // The real hostname is a literal prefix of this longer one — proves
        // host comparison is exact string equality, not a substring/prefix
        // match.
        res.writeHead(302, {
          Location: `https://${hostnameOnly}.evil.net/`,
        });
        res.end();
        return;
      }

      case "/no-location": {
        // A 3xx with no Location header at all — the empty edge.
        res.writeHead(302);
        res.end();
        return;
      }

      case "/feed-ok": {
        // Same-host, valid minimal RSS — the target of the legitimate
        // (non-HTTPS-rejected) redirect above, never actually reached by a
        // correctly-behaving caller since that redirect is rejected first.
        res.writeHead(200, { "Content-Type": "application/rss+xml" });
        res.end(MINIMAL_RSS);
        return;
      }

      case "/hang": {
        // Deliberately never responds and never ends the connection — this
        // is what proves the per-hop AbortController timeout actually
        // fires, rather than being assumed from reading the code.
        return;
      }

      case "/slow-body": {
        // Headers arrive instantly (200, XML content-type), then a single
        // byte drips every ~250ms, forever. Over an 8s budget that is ~32
        // bytes — three orders of magnitude under the 2MB size cap, which
        // is the whole point: the size cap can never rescue this case,
        // only a time budget can.
        res.writeHead(200, { "Content-Type": "application/rss+xml" });
        // A short opening fragment so the client genuinely observes a
        // started-but-incomplete body, not just headers.
        res.write("<?xml");
        const timer: NodeJS.Timeout = setInterval(() => {
          res.write(".");
        }, 250);
        timer.unref();
        activeTimers.add(timer);
        res.on("close", () => {
          clearInterval(timer);
          activeTimers.delete(timer);
        });
        return;
      }

      case "/drip-then-complete": {
        // A legitimate slow-but-finishing body: the existing minimal RSS
        // document split across three chunks ~100ms apart, then ended —
        // total elapsed comfortably under half a second. The positive
        // control proving the time budget does not fire on a source that
        // is merely slow, not stalled.
        res.writeHead(200, { "Content-Type": "application/rss+xml" });
        const chunkSize = Math.ceil(MINIMAL_RSS.length / 3);
        const chunks = [
          MINIMAL_RSS.slice(0, chunkSize),
          MINIMAL_RSS.slice(chunkSize, chunkSize * 2),
          MINIMAL_RSS.slice(chunkSize * 2),
        ];
        let chunkIndex = 0;
        const timer: NodeJS.Timeout = setInterval(() => {
          res.write(chunks[chunkIndex]);
          chunkIndex++;
          if (chunkIndex >= chunks.length) {
            clearInterval(timer);
            activeTimers.delete(timer);
            res.end();
          }
        }, 100);
        timer.unref();
        activeTimers.add(timer);
        res.on("close", () => {
          clearInterval(timer);
          activeTimers.delete(timer);
        });
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
    close: () =>
      new Promise<void>((resolve) => {
        // Clear any repeating timer that survived past its response's own
        // "close" cleanup (e.g. if the client never read far enough to
        // trigger it), so a stray timer can never hold the test process
        // open after the suite finishes.
        for (const timer of activeTimers) {
          clearInterval(timer);
        }
        activeTimers.clear();
        // closeAllConnections forcibly drops the /hang and /slow-body
        // endpoints' still-open sockets, so teardown can never block on a
        // connection that was designed to never end itself.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
