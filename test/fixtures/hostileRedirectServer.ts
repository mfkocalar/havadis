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
        // closeAllConnections forcibly drops the /hang endpoint's still-open
        // socket, so teardown can never block on a connection that was
        // designed to never end itself.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
