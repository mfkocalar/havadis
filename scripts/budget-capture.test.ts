import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * T-21-05 canary: the capture is run as a child process with a random canary in
 * VERCEL_TOKEN and a stub CLI named by VERCEL_BIN that echoes the token on its
 * stdout and stderr and carries it in an extra field of the runtime record. The
 * test fails if the canary reaches the stub's argv, the capture's stdout or
 * stderr, or any row it writes. Hermetic: no network, no real CLI.
 */

const CAPTURE = new URL("./budget-capture.ts", import.meta.url).pathname;
const RUNTIME_FIXTURE = readFileSync(
  new URL("./fixtures/budget-runtime-record.jsonl", import.meta.url),
  "utf8",
).trim();
const REQUEST_FIXTURE = readFileSync(
  new URL("./fixtures/budget-request-record.jsonl", import.meta.url),
  "utf8",
).trim();

const STUB = `#!/bin/sh
echo "$@" >> "$STUB_ARGV"
if [ "$1" = "--version" ]; then
  echo "65.15.0"
  exit 0
fi
echo "$VERCEL_TOKEN" >&2
cat "$STUB_DATA"
echo "$VERCEL_TOKEN"
exit "\${STUB_EXIT:-0}"
`;

function runCapture(exitCode: number) {
  const dir = mkdtempSync(path.join(tmpdir(), "budget-capture-"));
  const canary = `canary-${randomBytes(16).toString("hex")}`;
  const record = JSON.parse(RUNTIME_FIXTURE) as { data: Record<string, unknown> };
  record.data.extraField = canary;
  const dataFile = path.join(dir, "data.jsonl");
  writeFileSync(dataFile, `${JSON.stringify(record)}\n${REQUEST_FIXTURE}\n`);
  const stub = path.join(dir, "vercel-stub.sh");
  writeFileSync(stub, STUB);
  chmodSync(stub, 0o755);
  const argvFile = path.join(dir, "argv.txt");
  const out = path.join(dir, "out.jsonl");
  const child = spawnSync(
    process.execPath,
    ["--experimental-strip-types", CAPTURE, "--once", "--out", out],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        VERCEL_TOKEN: canary,
        VERCEL_BIN: stub,
        STUB_DATA: dataFile,
        STUB_ARGV: argvFile,
        STUB_EXIT: String(exitCode),
      },
    },
  );
  const read = (file: string) => {
    try {
      return readFileSync(file, "utf8");
    } catch {
      return "";
    }
  };
  return { canary, child, argv: read(argvFile), rows: read(out) };
}

test("T-21-05: the canary token never reaches argv, stdout, stderr or a row (success)", () => {
  const { canary, child, argv, rows } = runCapture(0);
  assert.equal(child.status, 0);
  assert.ok(argv.length > 0, "the stub must have run");
  assert.ok(!argv.includes(canary), "canary on argv");
  assert.ok(!child.stdout.includes(canary), "canary on stdout");
  assert.ok(!child.stderr.includes(canary), "canary on stderr");
  assert.ok(!rows.includes(canary), "canary in a row");
  assert.equal((rows.match(/"k":"budget"/g) ?? []).length, 1);
});

test("T-21-05: on a CLI failure only the exit code is printed and the canary stays out", () => {
  const { canary, child, argv, rows } = runCapture(1);
  assert.equal(child.status, 1);
  assert.ok(argv.length > 0, "the stub must have run");
  assert.ok(!argv.includes(canary), "canary on argv");
  assert.ok(!child.stdout.includes(canary), "canary on stdout");
  assert.ok(!child.stderr.includes(canary), "canary on stderr");
  assert.ok(!rows.includes(canary), "canary in a row");
  assert.match(`${child.stdout}${child.stderr}`, /exit code 1/);
  assert.match(rows, /"k":"poll"[^\n]*"ok":false/);
});
