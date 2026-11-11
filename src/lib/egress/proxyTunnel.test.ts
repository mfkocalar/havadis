import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { AddressInfo, Socket } from "node:net";
import { startConnectProxy } from "../../../test/fixtures/connectProxy.ts";
import type { ConnectProxy } from "../../../test/fixtures/connectProxy.ts";

/**
 * PLAT-15 against a proxy that really tunnels. The client runs in a child process with the proxy
 * variables and a trust file in its environment, exactly as production reads them (no injected env),
 * and talks to a real TLS origin through a real CONNECT tunnel. The origin certificate is generated
 * per run with openssl, valid one day, kept in a temp dir that after() removes, and trusted only by
 * the child through NODE_EXTRA_CA_CERTS (T-14-51).
 */

type Case = { url: string; status?: number; body?: string; code?: string; name?: string };
type ChildReport = { cases: Case[]; lookups: string[] };

let tempDir = "";
let certFile = "";
let origin: https.Server;
let originPort = 0;
const originPaths: string[] = [];
const originSockets = new Set<Socket>();
let proxy: ConnectProxy;

before(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), "havadis-tunnel-"));
  certFile = path.join(tempDir, "origin-cert.pem");
  const keyFile = path.join(tempDir, "origin-key.pem");
  try {
    execFileSync(
      "openssl",
      [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
        "-keyout", keyFile, "-out", certFile,
        "-subj", "/CN=tunnel.test",
        "-addext", "subjectAltName=DNS:feeds.corp.test,DNS:tunnel.test,DNS:direct.test",
      ],
      { stdio: "pipe" },
    );
  } catch (e) {
    const missing = (e as NodeJS.ErrnoException).code === "ENOENT";
    throw new Error(
      missing
        ? "openssl is required to generate the throwaway TLS certificate for this test and was not found on PATH"
        : `openssl could not generate the throwaway TLS certificate: ${String(e)}`,
    );
  }
  origin = https.createServer({ key: readFileSync(keyFile), cert: readFileSync(certFile) }, (req, res) => {
    originPaths.push(req.url ?? "");
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(`origin:${req.url}`);
  });
  origin.on("connection", (socket) => {
    originSockets.add(socket);
    socket.on("close", () => originSockets.delete(socket));
  });
  await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", resolve));
  originPort = (origin.address() as AddressInfo).port;
  proxy = await startConnectProxy({ resolve: { "feeds.corp.test": "127.0.0.1", "tunnel.test": "127.0.0.1" } });
});

after(async () => {
  await proxy?.close();
  for (const socket of originSockets) socket.destroy();
  await new Promise<void>((resolve) => (origin ? origin.close(() => resolve()) : resolve()));
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

function runClient(): Promise<ChildReport> {
  const safeFetchUrl = pathToFileURL(path.resolve(import.meta.dirname, "safeFetch.ts")).href;
  const code = `
    import dns from "node:dns";
    import { createSafeFetch } from ${JSON.stringify(safeFetchUrl)};
    const lookups = [];
    const lookup = (host, options, cb) => {
      lookups.push(host);
      if (host === "direct.test") {
        return options.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4);
      }
      return dns.lookup(host, options, cb);
    };
    const f = createSafeFetch({ allowHosts: ["feeds.corp.test", "direct.test"], lookup });
    const port = ${originPort};
    const urls = [
      "https://feeds.corp.test:" + port + "/allowed",
      "https://tunnel.test:" + port + "/public",
      "https://direct.test:" + port + "/direct",
      "https://metadata.google.internal/",
    ];
    const cases = [];
    for (const url of urls) {
      try {
        const res = await f(url);
        cases.push({ url, status: res.status, body: await res.text() });
      } catch (e) {
        cases.push({ url, code: e && e.code, name: e && e.name });
      }
    }
    process.stdout.write(JSON.stringify({ cases, lookups }) + "\\n");
    process.exit(0);
  `;
  // Only these variables: lowercase proxy variables stay unset. The cast is for Next's ProcessEnv typing (NODE_ENV).
  const env = {
    PATH: process.env.PATH ?? "",
    NODE_EXTRA_CA_CERTS: certFile,
    HTTPS_PROXY: proxy.url,
    HTTP_PROXY: proxy.url,
    NO_PROXY: "direct.test",
  } as unknown as NodeJS.ProcessEnv;
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--input-type=module", "-e", code],
      { env, timeout: 30_000 },
      (error, stdout, stderr) => {
        if (error) return reject(new Error(`client process failed: ${String(error)}\n${stderr}`));
        try {
          resolve(JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as ChildReport);
        } catch {
          reject(new Error(`client process printed no report:\n${stdout}\n${stderr}`));
        }
      },
    );
  });
}

let report: ChildReport;

test("PLAT-15: the client process ran all four cases through the production environment path", async () => {
  report = await runClient();
  assert.equal(report.cases.length, 4);
  assert.ok(Array.isArray(report.lookups));
});

test("PLAT-15: an allow-listed host is tunnelled end to end (the TLS origin answers through CONNECT)", () => {
  const c = report.cases[0];
  assert.equal(c.status, 200);
  assert.equal(c.body, "origin:/allowed");
  assert.ok(proxy.log.includes(`CONNECT feeds.corp.test:${originPort}`), proxy.log.join("\n"));
});

test("PLAT-15: a policy-allowed public name that is not allow-listed is tunnelled end to end", () => {
  const c = report.cases[1];
  assert.equal(c.status, 200);
  assert.equal(c.body, "origin:/public");
  assert.ok(proxy.log.includes(`CONNECT tunnel.test:${originPort}`), proxy.log.join("\n"));
});

test("PLAT-15: a host in NO_PROXY goes direct through the lookup guard and never reaches the proxy", () => {
  const c = report.cases[2];
  assert.equal(c.status, 200);
  assert.equal(c.body, "origin:/direct");
  assert.ok(report.lookups.includes("direct.test"), "the guarded resolver was not consulted for direct.test");
  assert.ok(!proxy.log.some((line) => line.includes("direct.test")), proxy.log.join("\n"));
});

test("PLAT-15: a policy-denied URL is refused with egress_denied_private and never reaches the proxy", () => {
  const c = report.cases[3];
  assert.equal(c.code, "egress_denied_private");
  assert.ok(!proxy.log.some((line) => line.includes("metadata.google.internal")), proxy.log.join("\n"));
});

test("PLAT-15: undici used CONNECT for every proxied https case, and the origin saw exactly the three allowed paths", () => {
  assert.deepEqual(proxy.log, [`CONNECT feeds.corp.test:${originPort}`, `CONNECT tunnel.test:${originPort}`]);
  assert.deepEqual(originPaths, ["/allowed", "/public", "/direct"]);
});
