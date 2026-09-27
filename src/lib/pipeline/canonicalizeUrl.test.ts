import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalizeUrl } from "./canonicalizeUrl.ts";

/**
 * Hermetic edge-case tests pinning canonicalizeUrl's comparison-key
 * construction (D-01). One test() per behavior bullet in 03-02-PLAN.md's
 * Task 3 <behavior> block. `.test` hostnames only, no clock, no network.
 */

test("http vs https compare equal", () => {
  assert.equal(canonicalizeUrl("http://a.test/x"), canonicalizeUrl("https://a.test/x"));
});

test("host letter case compares equal", () => {
  assert.equal(canonicalizeUrl("https://A.Test/x"), canonicalizeUrl("https://a.test/x"));
});

test("a fragment is dropped and compares equal to the same URL without one", () => {
  assert.equal(canonicalizeUrl("https://a.test/x#section"), canonicalizeUrl("https://a.test/x"));
});

test("a trailing slash compares equal to the same URL without one", () => {
  assert.equal(canonicalizeUrl("https://a.test/x/"), canonicalizeUrl("https://a.test/x"));
});

test("https://a.test/ compares equal to https://a.test (root path, trailing slash)", () => {
  assert.equal(canonicalizeUrl("https://a.test/"), canonicalizeUrl("https://a.test"));
});

test("utm_source and case-varied UTM_Campaign are stripped, comparing equal to the bare URL", () => {
  const bare = canonicalizeUrl("https://a.test/x");
  assert.equal(canonicalizeUrl("https://a.test/x?utm_source=rss"), bare);
  assert.equal(canonicalizeUrl("https://a.test/x?UTM_Campaign=spring"), bare);
});

test("fbclid and gclid are stripped, comparing equal to the bare URL", () => {
  const bare = canonicalizeUrl("https://a.test/x");
  assert.equal(canonicalizeUrl("https://a.test/x?fbclid=abc"), bare);
  assert.equal(canonicalizeUrl("https://a.test/x?gclid=xyz"), bare);
});

test("different non-tracking query values produce different keys", () => {
  assert.notEqual(canonicalizeUrl("https://a.test/x?id=1"), canonicalizeUrl("https://a.test/x?id=2"));
});

test("query parameter order does not matter", () => {
  assert.equal(canonicalizeUrl("https://a.test/x?b=2&a=1"), canonicalizeUrl("https://a.test/x?a=1&b=2"));
});

test("path letter case is preserved and produces a different key", () => {
  assert.notEqual(canonicalizeUrl("https://a.test/Foo"), canonicalizeUrl("https://a.test/foo"));
});

test("a non-default port produces a different key than no port", () => {
  assert.notEqual(canonicalizeUrl("https://a.test:8443/x"), canonicalizeUrl("https://a.test/x"));
});

test("a malformed URL returns the trimmed raw string without throwing", () => {
  assert.equal(canonicalizeUrl("not a url"), "not a url");
});

test("no canonical key starts with a URL scheme", () => {
  const key = canonicalizeUrl("https://a.test/x?utm_source=rss");
  assert.ok(!key.startsWith("http://") && !key.startsWith("https://"));
});
