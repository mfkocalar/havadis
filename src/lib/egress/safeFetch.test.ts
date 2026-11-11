import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import type dns from "node:dns";
import type { AddressInfo, Socket } from "node:net";
import { createSafeFetch, safeFetch } from "./safeFetch.ts";
import { isEgressDenied } from "./errors.ts";
import { startStubProxy } from "../../../test/fixtures/stubProxy.ts";
import type { StubProxy } from "../../../test/fixtures/stubProxy.ts";
import { makeLoopbackFetch } from "../../../test/fixtures/loopbackFetch.ts";
import type { EgressCode } from "../reasonCodes.ts";

// --- fixtures local to this file ---------------------------------------------

type Origin = { port: number; hits: string[]; close(): Promise<void> };

/** A real HTTP origin on 127.0.0.1. Every request path is recorded, so "no request reached it" is a hit count of 0. */
async function startOrigin(): Promise<Origin> {
  const hits: string[] = [];
  const sockets = new Set<Socket>();
  let port = 0;
  const server = http.createServer((req, res) => {
    const path = req.url ?? "/";
    hits.push(path);
    const redirect = (status: number, location?: string) => {
      res.writeHead(status, location === undefined ? {} : { location });
      res.end();
    };
    const chain = /^\/chain\/(\d+)$/.exec(path);
    if (chain) {
      const n = Number(chain[1]);
      if (n > 0) return redirect(302, `/chain/${n - 1}`);
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("end");
    }
    const echo = /^\/echo\/(\d+)$/.exec(path);
    if (echo) {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end(`echo:${echo[1]}`);
    }
    switch (path) {
      case "/ok":
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("ok");
      case "/redir":
        return redirect(302, "/ok");
      case "/redir-abs":
        return redirect(301, `http://${req.headers.host}/ok`);
      case "/redir-307":
        return redirect(307, "/ok");
      case "/redir-308":
        return redirect(308, "/ok");
      case "/redir-303":
        return redirect(303, "/ok");
      case "/to-other-host":
        return redirect(302, "http://other.example/ok");
      case "/to-other-port":
        return redirect(302, `http://${req.headers.host?.replace(/:\d+$/, "")}:${port + 1}/ok`);
      case "/to-metadata":
        return redirect(302, "http://169.254.169.254/latest/meta-data/");
      case "/to-https-same-host":
        return redirect(302, `https://${req.headers.host}/ok`);
      case "/not-modified":
        return redirect(304);
      case "/multiple":
        return redirect(300, "/ok");
      case "/no-location":
        return redirect(302);
      case "/hang":
        return; // never answered
      default:
        res.writeHead(404);
        return res.end();
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  return {
    port,
    hits,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

type LookupCall = { host: string; all: unknown };

/** A resolver answering from a table (every address of a name, in order); unknown names fail like ENOTFOUND. */
function fakeLookup(table: Record<string, readonly string[]>, calls: LookupCall[] = []): typeof dns.lookup {
  const fn = (host: string, options: { all?: boolean }, cb: (...args: unknown[]) => void) => {
    calls.push({ host, all: options?.all });
    const answers = table[host];
    if (!answers) {
      const err = Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
      return queueMicrotask(() => cb(err));
    }
    const list = answers.map((address) => ({ address, family: net.isIP(address) }));
    queueMicrotask(() => (options?.all ? cb(null, list) : cb(null, list[0].address, list[0].family)));
  };
  return fn as unknown as typeof dns.lookup;
}

async function denial(p: Promise<unknown>): Promise<EgressCode> {
  try {
    await p;
  } catch (e) {
    assert.ok(isEgressDenied(e), `expected an egress denial, got ${String(e)}`);
    return e.code;
  }
  return assert.fail("expected the call to be refused");
}

/** Awaits a call that must fail and returns what it threw. */
async function thrown(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  return assert.fail("expected the call to fail");
}

function codeOfError(e: unknown): unknown {
  return typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
}

let origin: Origin;
let proxy: StubProxy;

before(async () => {
  origin = await startOrigin();
  proxy = await startStubProxy();
});
after(async () => {
  await origin.close();
  await proxy.close();
});
beforeEach(() => {
  origin.hits.length = 0;
  proxy.log.length = 0;
});

const base = () => `127.0.0.1:${origin.port}`;

// --- direct mode: policy before any connection ---------------------------------

test("direct: an allow-listed loopback origin is reachable and a same-host relative redirect is followed", async () => {
  const f = makeLoopbackFetch();
  const res = await f(`http://${base()}/ok`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "ok");
  const redirected = await f(`http://${base()}/redir`);
  assert.equal(await redirected.text(), "ok");
  assert.deepEqual(origin.hits, ["/ok", "/redir", "/ok"]);
});

test("direct: literal, obfuscated and named private targets are refused before any request reaches the origin", async () => {
  const f = createSafeFetch({ env: {}, lookup: fakeLookup({}) });
  const p = origin.port;
  const cases: Array<[string, EgressCode]> = [
    [`http://127.0.0.1:${p}/ok`, "egress_denied_scheme"],
    [`https://127.0.0.1:${p}/ok`, "egress_denied_private"],
    [`https://2130706433:${p}/ok`, "egress_denied_private"],
    [`https://0x7f.1:${p}/ok`, "egress_denied_private"],
    [`https://017700000001:${p}/ok`, "egress_denied_private"],
    [`https://[::ffff:7f00:1]:${p}/ok`, "egress_denied_private"],
    [`https://[::1]:${p}/ok`, "egress_denied_private"],
    [`https://localhost:${p}/ok`, "egress_denied_private"],
    ["https://169.254.169.254/latest/meta-data/", "egress_denied_private"],
    ["https://[::ffff:169.254.169.254]/", "egress_denied_private"],
    ["https://metadata.google.internal/", "egress_denied_private"],
    ["https://172.16.0.1/", "egress_denied_private"],
    ["https://100.64.0.1/", "egress_denied_private"],
    [`https://user:secret@127.0.0.1:${p}/ok`, "egress_denied_credentials"],
  ];
  for (const [url, code] of cases) assert.equal(await denial(f(url)), code, url);
  assert.deepEqual(origin.hits, []);
});

test("direct: 10.1.2.3 is refused in under 1.5 s, so no connect was attempted", async () => {
  const f = createSafeFetch({ env: {} });
  const started = Date.now();
  assert.equal(await denial(f("https://10.1.2.3/")), "egress_denied_private");
  assert.ok(Date.now() - started < 1500);
});

test("direct: a name whose DNS answers include any denied address is refused, in every order", async () => {
  const calls: LookupCall[] = [];
  const lookup = fakeLookup(
    {
      "public-first.example.test": ["93.184.216.34", "10.0.0.5"],
      "private-first.example.test": ["10.0.0.5", "93.184.216.34"],
      "loopback.example.test": ["127.0.0.1"],
      "v6.example.test": ["2606:4700::1111", "::1"],
      "meta.example.test": ["169.254.169.254"],
    },
    calls,
  );
  const f = createSafeFetch({ env: {}, lookup });
  for (const host of ["public-first", "private-first", "loopback", "v6", "meta"]) {
    assert.equal(await denial(f(`https://${host}.example.test:${origin.port}/ok`)), "egress_denied_private", host);
  }
  assert.deepEqual(origin.hits, []);
  assert.ok(calls.length >= 5);
});

test("direct: resolve-and-pin: the resolver is asked with all: true and exactly once per connection", async () => {
  const calls: LookupCall[] = [];
  const f = createSafeFetch({
    allowHosts: ["feeds.corp.example"],
    env: {},
    lookup: fakeLookup({ "feeds.corp.example": ["127.0.0.1"] }, calls),
  });
  const res = await f(`http://feeds.corp.example:${origin.port}/ok`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "ok");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].host, "feeds.corp.example");
  assert.equal(calls[0].all, true);
});

test("direct: the same hostname that resolves to loopback is refused until it is allow-listed", async () => {
  const lookup = fakeLookup({ "feeds.corp.example": ["127.0.0.1"] });
  const denied = createSafeFetch({ env: {}, lookup });
  assert.equal(await denial(denied(`https://feeds.corp.example:${origin.port}/ok`)), "egress_denied_private");
  const allowed = createSafeFetch({ allowHosts: ["feeds.corp.example"], env: {}, lookup });
  assert.equal((await allowed(`http://feeds.corp.example:${origin.port}/ok`)).status, 200);
});

test("direct: SAFE-01/adjacency: the allow-list is exact, so lookalike hosts stay denied", async () => {
  const lookup = fakeLookup({
    "feeds.corp.example": ["127.0.0.1"],
    "x.feeds.corp.example": ["127.0.0.1"],
    "feeds.corp.example.evil": ["127.0.0.1"],
  });
  const f = createSafeFetch({ allowHosts: ["feeds.corp.example"], env: {}, lookup });
  assert.equal(await denial(f(`http://x.feeds.corp.example:${origin.port}/ok`)), "egress_denied_scheme");
  assert.equal(await denial(f(`https://x.feeds.corp.example:${origin.port}/ok`)), "egress_denied_private");
  assert.equal(await denial(f(`http://feeds.corp.example.evil:${origin.port}/ok`)), "egress_denied_scheme");
  assert.equal(await denial(f(`https://feeds.corp.example.evil:${origin.port}/ok`)), "egress_denied_private");
  assert.deepEqual(origin.hits, []);
});

test("direct: a denial carries only its fixed code: no address, URL or upstream text (D-14)", async () => {
  const f = createSafeFetch({ env: {}, lookup: fakeLookup({ "rebind.example.test": ["127.0.0.1"] }) });
  for (const url of [`https://rebind.example.test:${origin.port}/secret-path`, "https://169.254.169.254/secret-path"]) {
    try {
      await f(url);
      assert.fail("expected a denial");
    } catch (e) {
      assert.ok(isEgressDenied(e));
      assert.equal(e.message, "egress_denied_private");
      assert.equal(e.cause, undefined);
      const text = `${String(e)} ${JSON.stringify(e)} ${e.stack}`;
      assert.ok(!text.includes("127.0.0.1"));
      assert.ok(!text.includes("169.254"));
      assert.ok(!text.includes("secret-path"));
      assert.ok(!text.includes("rebind"));
    }
  }
});

// --- redirects ---------------------------------------------------------------------

test("redirects: 301, 302, 303, 307 and 308 are followed (absolute same-host Location too)", async () => {
  const f = makeLoopbackFetch();
  for (const path of ["/redir", "/redir-abs", "/redir-303", "/redir-307", "/redir-308"]) {
    const res = await f(`http://${base()}${path}`);
    assert.equal(res.status, 200, path);
    assert.equal(await res.text(), "ok", path);
  }
});

test("redirects: a 304 and any other 3xx are returned to the caller, not followed", async () => {
  const f = makeLoopbackFetch();
  assert.equal((await f(`http://${base()}/not-modified`)).status, 304);
  const multiple = await f(`http://${base()}/multiple`);
  assert.equal(multiple.status, 300);
  assert.deepEqual(origin.hits, ["/not-modified", "/multiple"]);
});

test("redirects: a cross-host hop and a same-name hop on another port are refused with egress_denied_redirect", async () => {
  const f = makeLoopbackFetch();
  assert.equal(await denial(f(`http://${base()}/to-other-host`)), "egress_denied_redirect");
  assert.equal(await denial(f(`http://${base()}/to-other-port`)), "egress_denied_redirect");
  assert.equal(await denial(f(`http://${base()}/to-metadata`)), "egress_denied_redirect");
  assert.deepEqual(origin.hits, ["/to-other-host", "/to-other-port", "/to-metadata"]);
});

test("redirects: SAFE-01/boundary: 5 redirects are followed and the 6th is refused with redirect_error", async () => {
  const f = makeLoopbackFetch();
  const ok = await f(`http://${base()}/chain/5`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "end");
  assert.equal(origin.hits.length, 6);
  origin.hits.length = 0;
  const err = await thrown(f(`http://${base()}/chain/6`));
  assert.equal(codeOfError(err), "redirect_error");
  assert.equal((err as Error).message, "redirect_error");
  assert.equal(origin.hits.length, 6);
});

test("redirects: maxRedirects is configurable", async () => {
  const f = createSafeFetch({ allowHosts: ["127.0.0.1"], env: {}, maxRedirects: 2 });
  assert.equal((await f(`http://${base()}/chain/2`)).status, 200);
  assert.equal(codeOfError(await thrown(f(`http://${base()}/chain/3`))), "redirect_error");
});

test("redirects: a 3xx without Location is a redirect_error", async () => {
  const f = makeLoopbackFetch();
  assert.equal(codeOfError(await thrown(f(`http://${base()}/no-location`))), "redirect_error");
});

test("redirects: an https upgrade on the same allow-listed host is re-checked and followed only when it passes the policy", async () => {
  const f = makeLoopbackFetch();
  // Same host name, different scheme and default port: the hop passes the host rule and the
  // loopback allow-list but there is no TLS listener, so it fails as a plain network error, not a denial.
  assert.equal(isEgressDenied(await thrown(f(`http://${base()}/to-https-same-host`))), false);
});

// --- timeouts ------------------------------------------------------------------------

test("timeout: a hanging origin aborts at the injected per-hop timeout", async () => {
  const f = createSafeFetch({ allowHosts: ["127.0.0.1"], env: {}, hopTimeoutMs: 150 });
  const started = Date.now();
  const err = await thrown(f(`http://${base()}/hang`));
  assert.equal((err as Error).name, "AbortError");
  assert.ok(Date.now() - started < 3000);
});

test("timeout: a caller signal is composed into every hop", async () => {
  const f = makeLoopbackFetch();
  const controller = new AbortController();
  const pending = f(`http://${base()}/hang`, { signal: controller.signal });
  setTimeout(() => controller.abort(new Error("caller gave up")), 100);
  await thrown(pending);
  const pre = new AbortController();
  pre.abort(new Error("pre-aborted"));
  await thrown(f(`http://${base()}/ok`, { signal: pre.signal }));
});

// --- transport seam (ported cases of the old hop loop) --------------------------------

function sequenceTransport(responses: Array<() => Response>) {
  const seen: Array<{ url: string; init: Record<string, unknown> }> = [];
  const transport = async (url: URL, init: Record<string, unknown>) => {
    seen.push({ url: url.toString(), init });
    return responses[Math.min(seen.length - 1, responses.length - 1)]();
  };
  return { transport, seen };
}

test("transport: lookalike redirect targets are refused (subdomain label prepended, longer domain)", async () => {
  for (const target of ["https://sub.original.test/", "https://original.test.evil.test/"]) {
    const { transport, seen } = sequenceTransport([() => new Response(null, { status: 302, headers: { location: target } })]);
    const f = createSafeFetch({ env: {}, transport });
    assert.equal(await denial(f("https://original.test/feed")), "egress_denied_redirect", target);
    assert.equal(seen.length, 1);
  }
});

test("transport: a same-host redirect to plain http is refused by the scheme rule", async () => {
  const { transport } = sequenceTransport([() => new Response(null, { status: 302, headers: { location: "http://original.test/" } })]);
  const f = createSafeFetch({ env: {}, transport });
  assert.equal(await denial(f("https://original.test/feed")), "egress_denied_scheme");
});

test("transport: exactly 5 same-host https redirects complete and the 6th is a redirect_error after 6 requests", async () => {
  const hop = () => new Response(null, { status: 302, headers: { location: "https://original.test/feed/" } });
  const five = sequenceTransport([hop, hop, hop, hop, hop, () => new Response("ok", { status: 200 })]);
  const ok = await createSafeFetch({ env: {}, transport: five.transport })("https://original.test/feed");
  assert.equal(ok.status, 200);
  assert.equal(five.seen.length, 6);
  const six = sequenceTransport([hop]);
  const err = await thrown(createSafeFetch({ env: {}, transport: six.transport })("https://original.test/feed"));
  assert.equal(codeOfError(err), "redirect_error");
  assert.equal(six.seen.length, 6);
});

test("transport: every hop is requested with redirect manual, a dispatcher and a signal", async () => {
  const { transport, seen } = sequenceTransport([() => new Response("ok", { status: 200 })]);
  await createSafeFetch({ env: {}, transport })("https://original.test/feed", { headers: { accept: "text/xml" } });
  assert.equal(seen[0].init.redirect, "manual");
  assert.ok(seen[0].init.dispatcher);
  assert.ok(seen[0].init.signal instanceof AbortSignal);
  assert.deepEqual(seen[0].init.headers, { accept: "text/xml" });
});

test("transport: a denied URL never reaches the transport", async () => {
  const { transport, seen } = sequenceTransport([() => new Response("ok")]);
  const f = createSafeFetch({ env: {}, transport });
  assert.equal(await denial(f("https://169.254.169.254/")), "egress_denied_private");
  assert.equal(await denial(f("http://example.com/")), "egress_denied_scheme");
  assert.equal(seen.length, 0);
});

// --- stub proxy: negative cases -------------------------------------------------------

const proxyEnv = (noProxy = "") => ({ HTTP_PROXY: proxy.url, HTTPS_PROXY: proxy.url, NO_PROXY: noProxy });

test("proxy: an allow-listed http host reaches the proxy as an absolute-form GET", async () => {
  const f = createSafeFetch({ allowHosts: ["feeds.corp.example"], env: proxyEnv() });
  const res = await f("http://feeds.corp.example/feed.xml");
  assert.equal(await res.text(), "proxied");
  assert.deepEqual(proxy.log, ["GET http://feeds.corp.example/feed.xml"]);
});

test("proxy: policy-denied URLs never reach the proxy", async () => {
  const f = createSafeFetch({ env: proxyEnv() });
  for (const url of [
    "https://169.254.169.254/latest/meta-data/",
    "https://localhost/",
    "https://metadata.google.internal/",
    "https://[::ffff:169.254.169.254]/",
    "https://2130706433/",
    "http://public.example.test/",
    "https://user:pw@public.example.test/",
  ]) {
    await denial(f(url));
  }
  assert.deepEqual(proxy.log, []);
});

test("proxy: a policy-allowed public name reaches the proxy as CONNECT host:443", async () => {
  const f = createSafeFetch({ env: proxyEnv() });
  assert.equal(isEgressDenied(await thrown(f("https://public.example.test/"))), false);
  assert.deepEqual(proxy.log, ["CONNECT public.example.test:443"]);
});

test("proxy: NO_PROXY=evil.example.test goes direct, so the lookup guard runs and refuses a name resolving to loopback", async () => {
  const calls: LookupCall[] = [];
  const f = createSafeFetch({
    env: proxyEnv("evil.example.test"),
    lookup: fakeLookup({ "evil.example.test": ["127.0.0.1"] }, calls),
  });
  assert.equal(await denial(f("https://evil.example.test/")), "egress_denied_private");
  assert.deepEqual(proxy.log, []);
  assert.equal(calls.length, 1);
});

test("proxy: PLAT-15/adjacency: NO_PROXY=example.test sends example.test direct while other.test goes to the proxy", async () => {
  const calls: LookupCall[] = [];
  const f = createSafeFetch({
    env: proxyEnv("example.test"),
    lookup: fakeLookup({ "example.test": ["127.0.0.1"], "other.test": ["127.0.0.1"] }, calls),
  });
  assert.equal(await denial(f("https://example.test/")), "egress_denied_private");
  assert.deepEqual(proxy.log, []);
  await thrown(f("https://other.test/"));
  assert.deepEqual(proxy.log, ["CONNECT other.test:443"]);
  assert.deepEqual(calls.map((c) => c.host), ["example.test"]);
});

test("proxy: PLAT-15/empty: HTTPS_PROXY unset or empty means direct mode with resolve-and-pin", async () => {
  for (const env of [{}, { HTTPS_PROXY: "", HTTP_PROXY: "" }, { https_proxy: "", http_proxy: "" }]) {
    const calls: LookupCall[] = [];
    const f = createSafeFetch({ env, lookup: fakeLookup({ "direct.example.test": ["127.0.0.1"] }, calls) });
    assert.equal(await denial(f("https://direct.example.test/")), "egress_denied_private", JSON.stringify(env));
    assert.equal(calls.length, 1);
  }
  assert.deepEqual(proxy.log, []);
});

test("proxy: PLAT-15/concurrency: changing process.env after construction does not change an existing instance's routing", async () => {
  const names = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "NO_PROXY", "no_proxy"] as const;
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  try {
    for (const n of names) delete process.env[n];
    // Injected env: direct at construction, proxy set afterwards.
    const direct = createSafeFetch({ env: {}, lookup: fakeLookup({ "late.example.test": ["127.0.0.1"] }) });
    process.env.HTTPS_PROXY = proxy.url;
    process.env.HTTP_PROXY = proxy.url;
    assert.equal(await denial(direct("https://late.example.test/")), "egress_denied_private");
    assert.deepEqual(proxy.log, []);
    // Production path (no injected env): proxy at construction, removed afterwards.
    process.env.NO_PROXY = "";
    const proxied = createSafeFetch({});
    delete process.env.HTTPS_PROXY;
    delete process.env.HTTP_PROXY;
    await thrown(proxied("https://still-proxied.example.test/"));
    assert.deepEqual(proxy.log, ["CONNECT still-proxied.example.test:443"]);
    // NO_PROXY set after construction does not exempt the host either.
    process.env.NO_PROXY = "still-proxied.example.test";
    proxy.log.length = 0;
    await thrown(proxied("https://still-proxied.example.test/"));
    assert.deepEqual(proxy.log, ["CONNECT still-proxied.example.test:443"]);
  } finally {
    for (const n of names) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
  }
});

// --- concurrency and shared state ------------------------------------------------------

test("concurrency: 50 parallel calls mixing allowed and denied URLs each get their own correct outcome", async () => {
  const f = makeLoopbackFetch();
  const denied: Array<[string, EgressCode]> = [
    ["https://169.254.169.254/", "egress_denied_private"],
    ["http://127.0.0.2/", "egress_denied_scheme"],
    ["https://localhost/", "egress_denied_private"],
    ["https://u:p@example.com/", "egress_denied_credentials"],
    [`http://${base()}/to-other-host`, "egress_denied_redirect"],
  ];
  const jobs = Array.from({ length: 50 }, (_, i) => {
    if (i % 2 === 0) {
      return f(`http://${base()}/echo/${i}`).then(async (res) => ({ i, kind: "ok" as const, body: await res.text() }));
    }
    const [url, code] = denied[i % denied.length];
    return f(url).then(
      () => ({ i, kind: "unexpected-success" as const }),
      (e: unknown) => ({ i, kind: "denied" as const, code: isEgressDenied(e) ? e.code : String(e), want: code }),
    );
  });
  for (const r of await Promise.all(jobs)) {
    if (r.i % 2 === 0) assert.deepEqual(r, { i: r.i, kind: "ok", body: `echo:${r.i}` });
    else assert.deepEqual({ kind: r.kind, code: "code" in r ? r.code : undefined }, { kind: "denied", code: "want" in r ? r.want : undefined }, `call ${r.i}`);
  }
});

test("concurrency: two instances with different allow-lists do not share state", async () => {
  const open = makeLoopbackFetch();
  const closed = createSafeFetch({ env: {} });
  const [a, b] = await Promise.all([
    open(`http://${base()}/ok`).then((r) => r.status),
    denial(closed(`http://${base()}/ok`)),
  ]);
  assert.equal(a, 200);
  assert.equal(b, "egress_denied_scheme");
  assert.equal((await open(`http://${base()}/ok`)).status, 200);
});

// --- the lazily built default ---------------------------------------------------------

test("default safeFetch: invalid configuration throws a plain Error naming the variable", async () => {
  const saved = process.env.HAVADIS_EGRESS_ALLOW_HOSTS;
  try {
    process.env.HAVADIS_EGRESS_ALLOW_HOSTS = "10.0.0.0/8";
    const err = await thrown(safeFetch("https://feeds.example.com/"));
    assert.ok(err instanceof Error);
    assert.equal(isEgressDenied(err), false);
    assert.equal(err.message.includes("HAVADIS_EGRESS_ALLOW_HOSTS"), true);
  } finally {
    if (saved === undefined) delete process.env.HAVADIS_EGRESS_ALLOW_HOSTS;
    else process.env.HAVADIS_EGRESS_ALLOW_HOSTS = saved;
  }
});

test("default safeFetch: with valid configuration it enforces the policy (no network needed)", async () => {
  const saved = process.env.HAVADIS_EGRESS_ALLOW_HOSTS;
  try {
    delete process.env.HAVADIS_EGRESS_ALLOW_HOSTS;
    assert.equal(await denial(safeFetch("http://127.0.0.1/")), "egress_denied_scheme");
    assert.equal(await denial(safeFetch("https://169.254.169.254/")), "egress_denied_private");
  } finally {
    if (saved === undefined) delete process.env.HAVADIS_EGRESS_ALLOW_HOSTS;
    else process.env.HAVADIS_EGRESS_ALLOW_HOSTS = saved;
  }
});
