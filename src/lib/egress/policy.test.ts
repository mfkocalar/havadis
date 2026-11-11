import { test } from "node:test";
import assert from "node:assert/strict";
import { checkUrl, ipDenied, nameDenied } from "./policy.ts";
import { EgressDenied, RedirectError, isEgressDenied } from "./errors.ts";
import type { EgressCode } from "../reasonCodes.ts";

const NO_ALLOW: ReadonlySet<string> = new Set();

function codeOf(url: string, allow: ReadonlySet<string> = NO_ALLOW): EgressCode | "allowed" {
  try {
    checkUrl(new URL(url), allow);
    return "allowed";
  } catch (e) {
    assert.ok(isEgressDenied(e), `unexpected error for ${url}`);
    return e.code;
  }
}

// --- SAFE-01/boundary: ipDenied -------------------------------------------

test("ipDenied: the RFC 1918 172.16/12 edges are denied and their neighbours pass", () => {
  assert.equal(ipDenied("172.15.255.255"), false);
  assert.equal(ipDenied("172.16.0.0"), true);
  assert.equal(ipDenied("172.31.255.255"), true);
  assert.equal(ipDenied("172.32.0.0"), false);
});

test("ipDenied: the CGNAT 100.64/10 edges are denied and their neighbours pass", () => {
  assert.equal(ipDenied("100.63.255.255"), false);
  assert.equal(ipDenied("100.64.0.0"), true);
  assert.equal(ipDenied("100.127.255.255"), true);
  assert.equal(ipDenied("100.128.0.0"), false);
});

test("ipDenied: every private, loopback, link-local, multicast and reserved IPv4 range is denied", () => {
  for (const ip of [
    "0.0.0.0",
    "0.255.255.255",
    "10.0.0.1",
    "127.0.0.1",
    "127.255.255.254",
    "169.254.169.254",
    "192.0.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.19.255.255",
    "224.0.0.1",
    "239.255.255.255",
    "240.0.0.1",
    "255.255.255.255",
  ]) {
    assert.equal(ipDenied(ip), true, ip);
  }
});

test("ipDenied: cloud metadata addresses are denied (AWS, Azure wire server, AWS IPv6, Alibaba via CGNAT)", () => {
  assert.equal(ipDenied("169.254.169.254"), true);
  assert.equal(ipDenied("168.63.129.16"), true);
  assert.equal(ipDenied("fd00:ec2::254"), true);
  assert.equal(ipDenied("100.100.100.200"), true);
});

test("ipDenied: the Azure wire server entry is a single address, not a range", () => {
  assert.equal(ipDenied("168.63.129.15"), false);
  assert.equal(ipDenied("168.63.129.17"), false);
});

test("ipDenied: every non-routable IPv6 range is denied", () => {
  for (const ip of ["::", "::1", "fc00::1", "fdff::1", "fe80::1", "ff02::1", "64:ff9b::1", "2002::1"]) {
    assert.equal(ipDenied(ip), true, ip);
  }
});

test("ipDenied: IPv4-mapped IPv6 addresses are judged by their embedded IPv4 address", () => {
  assert.equal(ipDenied("::ffff:169.254.169.254"), true);
  assert.equal(ipDenied("::ffff:a9fe:a9fe"), true);
  assert.equal(ipDenied("::ffff:127.0.0.1"), true);
  assert.equal(ipDenied("::ffff:7f00:1"), true);
  assert.equal(ipDenied("::ffff:8.8.8.8"), false);
});

test("ipDenied: public addresses are allowed", () => {
  for (const ip of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:4700::1111", "2001:4860:4860::8888"]) {
    assert.equal(ipDenied(ip), false, ip);
  }
});

test("ipDenied: anything that is not an IP address counts as denied", () => {
  for (const s of ["", "not an ip", "example.com", "1.2.3", "999.1.1.1", "::g"]) {
    assert.equal(ipDenied(s), true, JSON.stringify(s));
  }
});

// --- name rules -------------------------------------------------------------

test("nameDenied: local, internal and single-label names are denied", () => {
  for (const h of [
    "localhost",
    "a.localhost",
    "printer.local",
    "metadata.google.internal",
    "router.home.arpa",
    "intranet",
  ]) {
    assert.equal(nameDenied(h), true, h);
  }
});

test("nameDenied: a fully qualified trailing dot does not bypass the name rules", () => {
  for (const h of ["localhost.", "intranet.", "metadata.google.internal.", "printer.local."]) {
    assert.equal(nameDenied(h), true, h);
  }
});

test("nameDenied: ordinary public names are allowed", () => {
  for (const h of ["feeds.example.com", "krebsonsecurity.com", "x.feeds.corp.example", "feeds.corp.example.evil"]) {
    assert.equal(nameDenied(h), false, h);
  }
});

test("nameDenied: case and repeated or leading dots do not bypass the name rules", () => {
  for (const h of ["LOCALHOST.", "LocalHost", "localhost..", "foo.localhost..", "x.localhost..", "a..localhost", "a..example.com", ".localhost", ".example.com", "example.com..", ".", ".."]) {
    assert.equal(nameDenied(h), true, h);
  }
});

test("ipDenied: IPv4-embedding IPv6 ranges are denied whole (IPv4-compatible, NAT64, local-use NAT64, 6to4, Teredo, discard)", () => {
  for (const ip of [
    "::127.0.0.1",
    "::7f00:1",
    "::a9fe:a9fe",
    "::8.8.8.8",
    "64:ff9b::a9fe:a9fe",
    "64:ff9b::127.0.0.1",
    "64:ff9b:1::7f00:1",
    "64:ff9b:1:ffff::1",
    "2002:7f00:1::",
    "2002:a9fe:a9fe::1",
    "2001::1",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2",
    "100::1",
    "100::ffff:ffff:ffff:ffff",
  ]) {
    assert.equal(ipDenied(ip), true, ip);
  }
});

test("ipDenied: neighbours of the new IPv6 ranges stay allowed", () => {
  for (const ip of ["2001:1::1", "2001:4860:4860::8888", "100:0:0:1::1", "64:ff9b:2::1", "64:ff9c::1", "2003::1"]) {
    assert.equal(ipDenied(ip), false, ip);
  }
});

// --- checkUrl ----------------------------------------------------------------

test("checkUrl: userinfo is refused with egress_denied_credentials, before anything else", () => {
  assert.equal(codeOf("https://user:secret@feeds.example.com/"), "egress_denied_credentials");
  assert.equal(codeOf("https://user@feeds.example.com/"), "egress_denied_credentials");
  assert.equal(codeOf("https://example.com@127.0.0.1/"), "egress_denied_credentials");
  assert.equal(codeOf("http://user:pw@feeds.corp.example/", new Set(["feeds.corp.example"])), "egress_denied_credentials");
});

test("checkUrl: http on a host that is not allow-listed is refused with egress_denied_scheme", () => {
  assert.equal(codeOf("http://feeds.example.com/"), "egress_denied_scheme");
  assert.equal(codeOf("http://127.0.0.1/"), "egress_denied_scheme");
  assert.equal(codeOf("http://169.254.169.254/latest/meta-data/"), "egress_denied_scheme");
  assert.equal(codeOf("ftp://feeds.example.com/"), "egress_denied_scheme");
  assert.equal(codeOf("file:///etc/passwd"), "egress_denied_scheme");
});

test("checkUrl: https to an ordinary public name is allowed", () => {
  assert.equal(codeOf("https://feeds.example.com/rss.xml"), "allowed");
  assert.equal(codeOf("https://1.1.1.1/"), "allowed");
  assert.equal(codeOf("https://[2606:4700::1111]/"), "allowed");
});

test("checkUrl: literal metadata, private and loopback addresses are refused with egress_denied_private", () => {
  for (const url of [
    "https://169.254.169.254/",
    "https://[::ffff:169.254.169.254]/",
    "https://10.1.2.3/",
    "https://172.16.0.1/",
    "https://192.168.0.1/",
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://[fd00:ec2::254]/",
    "https://100.64.0.1/",
  ]) {
    assert.equal(codeOf(url), "egress_denied_private", url);
  }
});

test("checkUrl: SAFE-01/precision: obfuscated loopback forms normalize to a denied address and are refused", () => {
  for (const url of ["https://2130706433/", "https://0x7f.1/", "https://017700000001/", "https://[::ffff:7f00:1]/"]) {
    assert.equal(codeOf(url), "egress_denied_private", url);
  }
});

test("checkUrl: denied names are refused with egress_denied_private", () => {
  for (const url of [
    "https://localhost/",
    "https://a.localhost/",
    "https://printer.local/",
    "https://metadata.google.internal/",
    "https://router.home.arpa/",
    "https://intranet/",
    "https://localhost./",
    "https://intranet./",
  ]) {
    assert.equal(codeOf(url), "egress_denied_private", url);
  }
});

test("checkUrl: dotted and cased localhost variants and IPv4-embedding IPv6 literals are refused with egress_denied_private", () => {
  for (const url of [
    "https://LOCALHOST./",
    "https://localhost../",
    "https://foo.localhost../",
    "https://a..localhost/",
    "https://x.localhost../",
    "https://[::127.0.0.1]/",
    "https://[::7f00:1]/",
    "https://[64:ff9b::a9fe:a9fe]/",
    "https://[64:ff9b:1::7f00:1]/",
    "https://[2002:7f00:1::]/",
    "https://[2001::1]/",
    "https://[100::1]/",
  ]) {
    assert.equal(codeOf(url), "egress_denied_private", url);
  }
});

test("checkUrl: an allow-listed exact host passes over http and https, whatever its name or address", () => {
  const allow = new Set(["feeds.corp.example", "127.0.0.1", "::1", "intranet"]);
  assert.equal(codeOf("http://feeds.corp.example/feed", allow), "allowed");
  assert.equal(codeOf("https://feeds.corp.example/feed", allow), "allowed");
  assert.equal(codeOf("http://127.0.0.1:8080/", allow), "allowed");
  assert.equal(codeOf("https://127.0.0.1/", allow), "allowed");
  assert.equal(codeOf("http://[::1]:8080/", allow), "allowed");
  assert.equal(codeOf("http://intranet/", allow), "allowed");
});

test("checkUrl: SAFE-01/adjacency: the allow-list is exact, so lookalike hosts keep the normal rules", () => {
  const allow = new Set(["feeds.corp.example"]);
  assert.equal(codeOf("http://x.feeds.corp.example/", allow), "egress_denied_scheme");
  assert.equal(codeOf("http://feeds.corp.example.evil/", allow), "egress_denied_scheme");
  assert.equal(codeOf("https://x.localhost/", new Set(["localhost"])), "egress_denied_private");
  assert.equal(codeOf("http://127.0.0.2/", new Set(["127.0.0.1"])), "egress_denied_scheme");
  assert.equal(codeOf("https://127.0.0.2/", new Set(["127.0.0.1"])), "egress_denied_private");
});

test("checkUrl: an allow-listed host does not need to have an allowed name or address", () => {
  assert.equal(codeOf("https://10.0.0.5/", new Set(["10.0.0.5"])), "allowed");
});

// --- errors -----------------------------------------------------------------

test("EgressDenied: the message is exactly its code and carries nothing else", () => {
  for (const code of [
    "egress_denied_scheme",
    "egress_denied_private",
    "egress_denied_redirect",
    "egress_denied_credentials",
  ] as const) {
    const e = new EgressDenied(code);
    assert.equal(e.message, code);
    assert.equal(e.code, code);
    assert.ok(e instanceof Error);
    assert.ok(isEgressDenied(e));
  }
});

test("EgressDenied: refusals thrown by checkUrl never name the host or address in the message", () => {
  for (const url of ["https://169.254.169.254/", "https://localhost/", "http://feeds.example.com/", "https://u:p@a.example/"]) {
    try {
      checkUrl(new URL(url), NO_ALLOW);
      assert.fail(`${url} should have been refused`);
    } catch (e) {
      assert.ok(isEgressDenied(e));
      assert.match(e.message, /^egress_denied_[a-z]+$/);
      assert.ok(!e.message.includes("169"));
      assert.ok(!e.message.includes("localhost"));
    }
  }
});

test("RedirectError: has the redirect_error code and the code as its message", () => {
  const e = new RedirectError();
  assert.equal(e.code, "redirect_error");
  assert.equal(e.message, "redirect_error");
  assert.ok(e instanceof Error);
  assert.ok(!isEgressDenied(e));
});
