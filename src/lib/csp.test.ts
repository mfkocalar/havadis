import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCsp, newNonce } from "./csp.ts";

/** PLAT-14, T-14-29: the pure Content-Security-Policy builder behind src/proxy.ts. */

const PROD =
  "default-src 'self'; " +
  "script-src 'self' 'nonce-abc' 'strict-dynamic'; " +
  "style-src 'self' 'nonce-abc'; " +
  "img-src 'self' data:; " +
  "font-src 'self'; " +
  "connect-src 'self'; " +
  "object-src 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'; " +
  "frame-ancestors 'none'";

test("the production policy lists the directives in the documented order", () => {
  assert.equal(buildCsp("abc", false), PROD);
});

test("the policy never upgrades requests, never uses a wildcard and never allows a scheme source", () => {
  for (const dev of [false, true]) {
    const csp = buildCsp("abc", dev);
    assert.ok(!csp.includes("upgrade-insecure-requests"), "the instance serves plain HTTP on loopback until Phase 15");
    assert.ok(!csp.includes("*"));
    assert.ok(!csp.includes("https:"));
    assert.ok(!csp.includes("http:"));
  }
});

test("the production policy has no unsafe-eval and no unsafe-inline", () => {
  const csp = buildCsp("abc", false);
  assert.ok(!csp.includes("unsafe-eval"));
  assert.ok(!csp.includes("unsafe-inline"));
});

test("the dev policy adds unsafe-eval to script-src and swaps the style nonce for unsafe-inline", () => {
  const csp = buildCsp("abc", true);
  assert.ok(csp.includes("script-src 'self' 'nonce-abc' 'strict-dynamic' 'unsafe-eval';"));
  assert.ok(csp.includes("style-src 'self' 'unsafe-inline';"));
  assert.ok(!csp.includes("style-src 'self' 'nonce-abc'"));
});

test("the nonce appears in script-src and in the production style-src only", () => {
  const csp = buildCsp("n0nce", false);
  assert.equal(csp.split("'nonce-n0nce'").length - 1, 2);
});

test("newNonce is base64 of a random UUID and 100 calls are all distinct", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const nonce = newNonce();
    assert.match(nonce, /^[A-Za-z0-9+/]+={0,2}$/);
    const decoded = Buffer.from(nonce, "base64").toString();
    assert.match(decoded, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    seen.add(nonce);
  }
  assert.equal(seen.size, 100);
});

test("a nonce never contains a character that would end a CSP source expression", () => {
  for (let i = 0; i < 20; i++) {
    assert.doesNotMatch(newNonce(), /['";\s,]/);
  }
});
