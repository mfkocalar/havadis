import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

/**
 * Drives a real `next start` production server and asserts the public
 * no-authentication contract and the cold-cache render (UI-06, INGEST-05
 * empty edge). RESEARCH.md Pitfall P1-4: Next.js never caches pages in
 * `next dev` — this criterion is unverifiable there, so this test spawns
 * the actual production build's start script instead.
 */

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_INTERVAL_MS = 500;

let server: ChildProcess | null = null;
let stderrLog = "";

async function pollUntilReady(): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(2_000) });
      await res.body?.cancel();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
    }
  }
  throw new Error(
    `Production server never answered on ${BASE_URL} within ${READY_TIMEOUT_MS}ms.\n` +
      `Captured stderr:\n${stderrLog}`
  );
}

before(async () => {
  const nextBin = path.join(process.cwd(), "node_modules", ".bin", "next");
  server = spawn(nextBin, ["start", "-p", String(PORT)], {
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env },
  });
  server.stderr?.on("data", (chunk: Buffer) => {
    stderrLog += chunk.toString();
  });

  try {
    await pollUntilReady();
  } catch (err) {
    server.kill();
    server = null;
    throw err;
  }
});

after(async () => {
  if (server) {
    server.kill();
    server = null;
  }
});

test("GET / returns 200 with no authentication surface anywhere", async () => {
  const res = await fetch(BASE_URL);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("set-cookie"), null, "a public page must never set a cookie");
  assert.equal(
    res.headers.get("www-authenticate"),
    null,
    "a public page must never challenge for credentials"
  );
  assert.notEqual(res.status, 401);
  assert.notEqual(res.status, 403);
});

test("body contains the Havadis masthead", async () => {
  const res = await fetch(BASE_URL);
  const body = await res.text();
  assert.ok(body.includes("Havadis"), "expected the masthead string in the rendered HTML");
});

test("body contains exactly one of the two valid render states — never neither, never both", async () => {
  const res = await fetch(BASE_URL);
  const body = await res.text();

  const hasArticleAnchor = /href="https:\/\/krebsonsecurity\.com[^"]*"/.test(body);
  const hasEmptyState = body.includes("No articles in the last 24 hours");

  assert.notEqual(
    hasArticleAnchor,
    hasEmptyState,
    "exactly one of {a krebsonsecurity.com article anchor, the D-03 empty-state line} must be present — " +
      "neither means the blank-page failure this criterion exists to exclude, and both means the empty " +
      "state rendered alongside real articles"
  );
});

test("two consecutive requests return byte-identical HTML", async () => {
  // Necessary, not sufficient: two independently-uncached renders taken
  // within the same second could also happen to match. The sufficient
  // proof of the 900s stale-while-revalidate window is the human-observed
  // x-vercel-cache backstop truth on a deployed preview (this plan's own
  // must_haves), not this assertion — this only catches a gross regression
  // cheaply and automatically.
  const [res1, res2] = await Promise.all([fetch(BASE_URL), fetch(BASE_URL)]);
  const [body1, body2] = await Promise.all([res1.text(), res2.text()]);
  assert.equal(body1, body2);
});
