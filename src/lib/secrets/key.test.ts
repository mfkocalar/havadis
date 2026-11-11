import { test } from "node:test";
import assert from "node:assert/strict";
import { Secret } from "./secret.ts";
import { KEYGEN_COMMAND, generateKey, loadOperatorKey } from "./key.ts";

const GOOD = Buffer.alloc(32, 7).toString("base64");

function neverRead(): string {
  throw new Error("the real filesystem must not be used in this test");
}

test("neither variable set gives key_missing, naming the variables and the keygen command", () => {
  const r = loadOperatorKey({}, neverRead);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "key_missing");
  assert.ok(r.message.includes("HAVADIS_SECRET_KEY"));
  assert.ok(r.message.includes("HAVADIS_SECRET_KEY_FILE"));
  assert.ok(r.message.includes(KEYGEN_COMMAND));
});

test("empty and whitespace-only values count as unset", () => {
  const r = loadOperatorKey({ HAVADIS_SECRET_KEY: "", HAVADIS_SECRET_KEY_FILE: "  " }, neverRead);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "key_missing");
});

test("both variables set gives key_conflict", () => {
  const r = loadOperatorKey({ HAVADIS_SECRET_KEY: GOOD, HAVADIS_SECRET_KEY_FILE: "/run/secrets/k" }, neverRead);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "key_conflict");
});

test("a value that is not base64 gives key_malformed", () => {
  const r = loadOperatorKey({ HAVADIS_SECRET_KEY: "abc" }, neverRead);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "key_malformed");
});

test("base64 of 31 or 33 bytes gives key_malformed, 32 bytes gives ok with a Secret", () => {
  for (const n of [31, 33]) {
    const r = loadOperatorKey({ HAVADIS_SECRET_KEY: Buffer.alloc(n, 1).toString("base64") }, neverRead);
    assert.equal(r.ok, false, `${n} bytes`);
    if (!r.ok) assert.equal(r.code, "key_malformed");
  }
  const ok = loadOperatorKey({ HAVADIS_SECRET_KEY: GOOD }, neverRead);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.ok(ok.key instanceof Secret);
    assert.equal(ok.key.reveal(), GOOD);
  }
});

test("strict base64: bad alphabet, missing padding and embedded whitespace are malformed", () => {
  const bad = [
    GOOD.replace(/.$/, "!"),
    GOOD.slice(0, -1),
    `${GOOD.slice(0, 10)} ${GOOD.slice(10)}`,
    GOOD.replace(/\+/g, "-").replace(/\//g, "_") + "x",
    // url-safe alphabet is not accepted
    Buffer.from(Array.from({ length: 32 }, () => 0xfb)).toString("base64url"),
  ];
  for (const value of bad) {
    const r = loadOperatorKey({ HAVADIS_SECRET_KEY: value }, neverRead);
    assert.equal(r.ok, false, value);
    if (!r.ok) assert.equal(r.code, "key_malformed");
  }
});

test("HAVADIS_SECRET_KEY_FILE content with a trailing newline is accepted, via the injected readFile", () => {
  const seen: string[] = [];
  const r = loadOperatorKey({ HAVADIS_SECRET_KEY_FILE: "/run/secrets/havadis_key" }, (p) => {
    seen.push(p);
    return `${GOOD}\n`;
  });
  assert.equal(r.ok, true);
  assert.deepEqual(seen, ["/run/secrets/havadis_key"]);
  if (r.ok) assert.equal(r.key.reveal(), GOOD);
});

test("a missing or unreadable file gives key_file_unreadable", () => {
  const r = loadOperatorKey({ HAVADIS_SECRET_KEY_FILE: "/nope" }, () => {
    throw new Error("ENOENT: no such file");
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "key_file_unreadable");
});

test("a file with a malformed key gives key_malformed", () => {
  const r = loadOperatorKey({ HAVADIS_SECRET_KEY_FILE: "/k" }, () => "not-a-key\n");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "key_malformed");
});

test("canary: no message contains the supplied value, the file contents or the error text", () => {
  const canary = "CANARY-do-not-leak-0123456789";
  const results = [
    loadOperatorKey({ HAVADIS_SECRET_KEY: canary }, neverRead),
    loadOperatorKey({ HAVADIS_SECRET_KEY: canary, HAVADIS_SECRET_KEY_FILE: canary }, neverRead),
    loadOperatorKey({ HAVADIS_SECRET_KEY_FILE: "/k" }, () => canary),
    loadOperatorKey({ HAVADIS_SECRET_KEY_FILE: "/k" }, () => {
      throw new Error(canary);
    }),
    loadOperatorKey({ HAVADIS_SECRET_KEY: Buffer.from(canary).toString("base64") }, neverRead),
  ];
  for (const r of results) {
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(!r.message.includes(canary));
      assert.ok(!r.message.includes(Buffer.from(canary).toString("base64")));
      assert.ok(r.message.includes(KEYGEN_COMMAND) || r.code === "key_conflict" || r.code === "key_file_unreadable");
    }
  }
});

test("every refusal message is fixed text per code (no interpolation of input)", () => {
  const a = loadOperatorKey({ HAVADIS_SECRET_KEY: "aaa" }, neverRead);
  const b = loadOperatorKey({ HAVADIS_SECRET_KEY: "bbbbbbbb" }, neverRead);
  assert.equal(a.ok, false);
  assert.equal(b.ok, false);
  if (!a.ok && !b.ok) assert.equal(a.message, b.message);
});

test("generateKey() returns base64 that loadOperatorKey accepts, and two calls differ", () => {
  const a = generateKey();
  const b = generateKey();
  assert.notEqual(a, b);
  for (const k of [a, b]) {
    const r = loadOperatorKey({ HAVADIS_SECRET_KEY: k }, neverRead);
    assert.equal(r.ok, true);
  }
  assert.equal(Buffer.from(a, "base64").length, 32);
});

test("KEYGEN_COMMAND is the documented openssl one-liner", () => {
  assert.equal(KEYGEN_COMMAND, "openssl rand -base64 32");
});
