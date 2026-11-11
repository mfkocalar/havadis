import { test } from "node:test";
import assert from "node:assert/strict";
import { EnvelopeError, open, seal } from "./envelope.ts";
import { Secret } from "./secret.ts";

const KEY_A = new Secret(Buffer.alloc(32, 1).toString("base64"));
const KEY_B = new Secret(Buffer.alloc(32, 2).toString("base64"));
const PLAINTEXT = "hunter2-oidc-client-secret";
const SHAPE = /^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]*$/;

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof EnvelopeError, "expected an EnvelopeError");
    return error.code;
  }
  assert.fail("expected the call to throw");
}

/** Replace the first character of one colon-separated part with a different valid base64url character. */
function corruptPart(envelope: string, index: number): string {
  const parts = envelope.split(":");
  const first = parts[index]![0] === "A" ? "B" : "A";
  parts[index] = first + parts[index]!.slice(1);
  return parts.join(":");
}

test("open(key, purpose, seal(key, purpose, text)) round-trips and the envelope has the v1 shape", () => {
  const envelope = seal(KEY_A, "oidc-client", PLAINTEXT);
  assert.match(envelope, SHAPE);
  assert.ok(!envelope.includes(PLAINTEXT));
  assert.equal(open(KEY_A, "oidc-client", envelope), PLAINTEXT);
});

test("sealing twice gives different envelopes (random IV) that both open", () => {
  const a = seal(KEY_A, "p", "hello");
  const b = seal(KEY_A, "p", "hello");
  assert.notEqual(a, b);
  assert.equal(open(KEY_A, "p", a), "hello");
  assert.equal(open(KEY_A, "p", b), "hello");
});

test("empty and non-ASCII plaintext round-trip", () => {
  assert.equal(open(KEY_A, "p", seal(KEY_A, "p", "")), "");
  assert.match(seal(KEY_A, "p", ""), SHAPE);
  const text = "Schlüssel \u{1F511} ключ";
  assert.equal(open(KEY_A, "p", seal(KEY_A, "p", text)), text);
});

test("a different key is rejected with envelope_auth", () => {
  assert.equal(codeOf(() => open(KEY_B, "p", seal(KEY_A, "p", "hello"))), "envelope_auth");
});

test("a different purpose is rejected with envelope_auth (purpose is the AAD)", () => {
  assert.equal(codeOf(() => open(KEY_A, "other", seal(KEY_A, "p", "hello"))), "envelope_auth");
});

test("a changed character in the ciphertext or the tag is rejected with envelope_auth", () => {
  const envelope = seal(KEY_A, "p", PLAINTEXT);
  assert.equal(codeOf(() => open(KEY_A, "p", corruptPart(envelope, 3))), "envelope_auth");
  assert.equal(codeOf(() => open(KEY_A, "p", corruptPart(envelope, 2))), "envelope_auth");
  assert.equal(codeOf(() => open(KEY_A, "p", corruptPart(envelope, 1))), "envelope_auth");
});

test("an unknown version is rejected with envelope_version", () => {
  const envelope = seal(KEY_A, "p", "hello");
  assert.equal(codeOf(() => open(KEY_A, "p", envelope.replace(/^v1:/, "v2:"))), "envelope_version");
});

test("wrong part count, an 11-byte IV or a 15-byte tag are rejected with envelope_format", () => {
  const [v, iv, tag, ct] = seal(KEY_A, "p", "hello").split(":") as [string, string, string, string];
  const b64 = (n: number) => Buffer.alloc(n, 9).toString("base64url");
  assert.equal(codeOf(() => open(KEY_A, "p", `${v}:${iv}:${tag}`)), "envelope_format");
  assert.equal(codeOf(() => open(KEY_A, "p", `${v}:${iv}:${tag}:${ct}:extra`)), "envelope_format");
  assert.equal(codeOf(() => open(KEY_A, "p", `${v}:${b64(11)}:${tag}:${ct}`)), "envelope_format");
  assert.equal(codeOf(() => open(KEY_A, "p", `${v}:${iv}:${b64(15)}:${ct}`)), "envelope_format");
  assert.equal(codeOf(() => open(KEY_A, "p", `${v}:${iv}:${tag}:not base64!`)), "envelope_format");
  assert.equal(codeOf(() => open(KEY_A, "p", "")), "envelope_format");
  assert.equal(codeOf(() => open(KEY_A, "p", "garbage")), "envelope_format");
});

test("error messages are fixed text and contain neither the plaintext nor the key", () => {
  const envelope = seal(KEY_A, "p", PLAINTEXT);
  const failures = [
    () => open(KEY_B, "p", envelope),
    () => open(KEY_A, "q", envelope),
    () => open(KEY_A, "p", envelope.replace(/^v1:/, "v9:")),
    () => open(KEY_A, "p", "v1:x"),
  ];
  for (const fail of failures) {
    try {
      fail();
      assert.fail("expected throw");
    } catch (error) {
      assert.ok(error instanceof EnvelopeError);
      assert.ok(!error.message.includes(PLAINTEXT));
      assert.ok(!error.message.includes(KEY_A.reveal()));
      assert.ok(!error.message.includes(envelope));
    }
  }
  const a = (() => {
    try {
      open(KEY_B, "p", seal(KEY_A, "p", "one"));
    } catch (e) {
      return (e as EnvelopeError).message;
    }
    return "";
  })();
  const b = (() => {
    try {
      open(KEY_B, "p", seal(KEY_A, "p", "two"));
    } catch (e) {
      return (e as EnvelopeError).message;
    }
    return "";
  })();
  assert.ok(a.length > 0);
  assert.equal(a, b);
});
