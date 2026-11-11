import http from "node:http";
import type { AddressInfo, Socket } from "node:net";

/**
 * A stub forward proxy for the egress negative cases. It never tunnels: a CONNECT is logged as
 * "CONNECT host:port" and answered 502, an absolute-form request is logged as "METHOD url" and
 * answered 200 "proxied". Binds 127.0.0.1 on an ephemeral port. Factory only: the file has no
 * import-time side effects because `node --test` globs everything under test/ (Pitfall 16).
 */
export type StubProxy = { url: string; log: string[]; close(): Promise<void> };

export async function startStubProxy(): Promise<StubProxy> {
  const log: string[] = [];
  const sockets = new Set<Socket>();
  const server = http.createServer((req, res) => {
    log.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("proxied");
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("connect", (req, socket) => {
    log.push(`CONNECT ${req.url}`);
    socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    log,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
