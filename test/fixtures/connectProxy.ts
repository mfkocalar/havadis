import http from "node:http";
import net from "node:net";
import type { AddressInfo, Socket } from "node:net";

/**
 * A real CONNECT-tunnelling forward proxy for tests, on 127.0.0.1 and an ephemeral port. It tunnels
 * only the hosts named in `resolve` (host -> IPv4 address it connects to itself, like a corporate
 * proxy that resolves names), logs every request, and refuses everything else with 403. Plan 13 reuses it
 * with an empty map to prove the worker sends its requests to HTTPS_PROXY. Factory only: nothing runs at
 * import time because `node --test` globs everything under test/ (Pitfall 16).
 */
export type ConnectProxy = { url: string; log: string[]; close(): Promise<void> };

export async function startConnectProxy(opts: { resolve: Record<string, string> }): Promise<ConnectProxy> {
  const log: string[] = [];
  const open = new Set<Socket>();
  const track = (socket: Socket) => {
    open.add(socket);
    socket.on("close", () => open.delete(socket));
    return socket;
  };

  // Absolute-form (plain http) requests are logged and refused.
  const server = http.createServer((req, res) => {
    log.push(`${req.method} ${req.url}`);
    res.writeHead(403, { connection: "close" });
    res.end("Forbidden");
  });
  server.on("connection", (socket) => track(socket));

  server.on("connect", (req, client, head) => {
    const target = req.url ?? "";
    log.push(`CONNECT ${target}`);
    const split = target.lastIndexOf(":");
    const host = split === -1 ? target : target.slice(0, split);
    const port = split === -1 ? 443 : Number(target.slice(split + 1));
    const address = Object.hasOwn(opts.resolve, host) ? opts.resolve[host] : undefined;
    if (address === undefined) {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const upstream = track(net.connect(port, address));
    upstream.once("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    const teardown = () => {
      upstream.destroy();
      client.destroy();
    };
    upstream.on("error", teardown);
    client.on("error", teardown);
    upstream.on("close", () => client.destroy());
    client.on("close", () => upstream.destroy());
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    log,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of open) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
