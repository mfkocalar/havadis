import http from "node:http";

/**
 * The container healthcheck's one HTTP request: GET http://127.0.0.1:<port>/api/health.
 *
 * Loopback only by construction: the function takes a port and nothing else, so the host and the path
 * are fixed here and it cannot become a general egress path (T-14-41). It uses node:http with a fresh
 * http.Agent rather than global fetch, because with NODE_USE_ENV_PROXY=1 and HTTP_PROXY set but no
 * loopback entry in NO_PROXY, global fetch sends loopback requests to the proxy and fails. Redirects
 * are never followed: a 3xx answer is simply not a 200.
 */
export function probeLoopbackHealth(port: number, timeoutMs: number): Promise<{ ok: boolean; status: number | null }> {
  const unreachable = { ok: false, status: null };
  if (!Number.isInteger(port) || port < 1 || port > 65535) return Promise.resolve(unreachable);

  return new Promise((resolve) => {
    const agent = new http.Agent();
    let settled = false;
    const finish = (result: { ok: boolean; status: number | null }): void => {
      if (settled) return;
      settled = true;
      agent.destroy();
      resolve(result);
    };
    const req = http.get({ host: "127.0.0.1", port, path: "/api/health", agent, timeout: timeoutMs }, (res) => {
      res.resume();
      const status = res.statusCode ?? null;
      finish({ ok: status === 200, status });
    });
    req.on("timeout", () => {
      req.destroy();
      finish(unreachable);
    });
    req.on("error", () => finish(unreachable));
  });
}
