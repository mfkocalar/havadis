import { test } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { REDACTED, Secret } from "./secret.ts";

const CANARY = "canary-secret-value-7f3a";

test("a Secret prints [REDACTED] through String() and template literals", () => {
  const s = new Secret(CANARY);
  assert.equal(String(s), REDACTED);
  assert.equal(`${s}`, REDACTED);
  assert.equal(REDACTED, "[REDACTED]");
});

test("a Secret prints [REDACTED] through JSON.stringify", () => {
  const out = JSON.stringify({ s: new Secret(CANARY) });
  assert.equal(out, '{"s":"[REDACTED]"}');
  assert.ok(!out.includes(CANARY));
});

test("a Secret prints [REDACTED] through util.inspect, nested and top level", () => {
  const s = new Secret(CANARY);
  assert.equal(inspect(s), REDACTED);
  const nested = inspect({ a: { b: [s] } }, { depth: 10 });
  assert.ok(nested.includes(REDACTED));
  assert.ok(!nested.includes(CANARY));
});

test("only reveal() returns the value", () => {
  const s = new Secret(CANARY);
  assert.equal(s.reveal(), CANARY);
  assert.ok(!Object.keys(s).includes("value"));
  assert.ok(!JSON.stringify(Object.getOwnPropertyNames(s)).includes(CANARY));
});
