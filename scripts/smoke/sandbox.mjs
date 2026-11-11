// Smoke-only helper, run by the image's node inside an internal Docker network (never by operators).
//   node sandbox.mjs proxy   an HTTP forward proxy on :3128 that tunnels CONNECT and logs each target
//   node sandbox.mjs feed    an HTTPS server on :443 that answers every path with a small RSS document
// Plain ESM with no project imports. The feed uses /sandbox/key.pem and /sandbox/cert.pem, a throwaway
// pair the smoke script generates per run for www.bleepingcomputer.com.
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const mode = process.argv[2];

function proxy() {
  // A plain absolute-form request is not tunnelled: the worker only uses HTTPS.
  const server = http.createServer((req, res) => {
    console.log(`REFUSED ${req.method}`);
    res.writeHead(403, { connection: "close" });
    res.end("Forbidden");
  });

  server.on("connect", (req, client, head) => {
    const target = req.url ?? "";
    console.log(`CONNECT ${target}`);
    const split = target.lastIndexOf(":");
    const host = split === -1 ? target : target.slice(0, split);
    const port = split === -1 ? 443 : Number(target.slice(split + 1));
    // The proxy resolves names itself, like an operator's proxy; on the sandbox network Docker DNS knows only the feed alias.
    const upstream = net.connect(port, host);
    upstream.once("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.once("error", () => {
      if (!client.destroyed) client.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
      upstream.destroy();
    });
    upstream.on("close", () => client.destroy());
    client.on("error", () => upstream.destroy());
    client.on("close", () => upstream.destroy());
  });

  server.listen(3128, "0.0.0.0", () => console.log("proxy listening"));
}

function rss() {
  const now = Date.now();
  const items = [1, 2, 3, 4, 5]
    .map((n) => {
      const published = new Date(now - n * 5 * 60_000).toUTCString();
      return [
        "<item>",
        `<title>Havadis smoke fixture story ${n}</title>`,
        `<link>https://www.bleepingcomputer.com/smoke/${n}</link>`,
        `<guid isPermaLink="true">https://www.bleepingcomputer.com/smoke/${n}</guid>`,
        `<pubDate>${published}</pubDate>`,
        `<description>Fixture story ${n} served by the smoke sandbox.</description>`,
        "</item>",
      ].join("");
    })
    .join("");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0"><channel>',
    "<title>BleepingComputer smoke fixture</title>",
    "<link>https://www.bleepingcomputer.com/</link>",
    "<description>Smoke fixture feed</description>",
    items,
    "</channel></rss>",
  ].join("");
}

function feed() {
  const options = { key: fs.readFileSync("/sandbox/key.pem"), cert: fs.readFileSync("/sandbox/cert.pem") };
  const server = https.createServer(options, (req, res) => {
    console.log(`FEED ${req.method}`);
    res.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "no-store" });
    res.end(rss());
  });
  server.listen(443, "0.0.0.0", () => console.log("feed listening"));
}

if (mode === "proxy") proxy();
else if (mode === "feed") feed();
else {
  console.error("usage: sandbox.mjs proxy | feed");
  process.exit(2);
}
