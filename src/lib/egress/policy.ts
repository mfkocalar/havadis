import net from "node:net";
import { EgressDenied } from "./errors.ts";

/**
 * Deny list for every address the instance must never connect to: private, loopback,
 * link-local, CGNAT, multicast, reserved and the cloud metadata endpoints (SAFE-01).
 * BlockList also judges IPv4-mapped IPv6 addresses by their embedded IPv4 address.
 */
export const DENY_LIST = new net.BlockList();

for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
  // Azure wire server: routable-looking, so BlockList would not catch it by itself.
  ["168.63.129.16", 32],
] as const) {
  DENY_LIST.addSubnet(address, prefix, "ipv4");
}

for (const [address, prefix] of [
  // ::/96 covers the unspecified address, ::1 and the deprecated IPv4-compatible form (::127.0.0.1).
  ["::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  // NAT64, local-use NAT64, 6to4, Teredo and the discard prefix embed or tunnel IPv4 addresses.
  // They are denied whole, which also refuses every embedded loopback, private or metadata IPv4.
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["2002::", 16],
  ["2001::", 32],
  ["100::", 64],
  // AWS IPv6 instance metadata (RESEARCH A11, accepted).
  ["fd00:ec2::254", 128],
] as const) {
  DENY_LIST.addSubnet(address, prefix, "ipv6");
}

/** True when the address is denied. Anything that is not an IP address counts as denied. */
export function ipDenied(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 0) return true;
  return DENY_LIST.check(ip, family === 4 ? "ipv4" : "ipv6");
}

/**
 * Names that resolve inside the host or the local network. The name is lowercased, one trailing root
 * dot is allowed (FQDN form), and any empty label (leading dot, "..", or several trailing dots) is
 * refused outright: resolvers differ on such names, so none of them is trusted.
 */
export function nameDenied(host: string): boolean {
  const lower = host.toLowerCase();
  const h = lower.endsWith(".") ? lower.slice(0, -1) : lower;
  if (h.split(".").some((label) => label === "")) return true;
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".home.arpa") ||
    !h.includes(".")
  );
}

/**
 * URL-level policy for a start URL or a redirect hop, in this order: userinfo, scheme,
 * allow-list, literal IP, name. Literal IPs never reach a connect-time lookup, so this
 * check runs in every mode. The allow-list holds exact hostnames or literal IPs only.
 */
export function checkUrl(url: URL, allow: ReadonlySet<string>): void {
  if (url.username || url.password) throw new EgressDenied("egress_denied_credentials");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const allowed = allow.has(host);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && allowed)) {
    throw new EgressDenied("egress_denied_scheme");
  }
  if (allowed) return;
  if (net.isIP(host)) {
    if (ipDenied(host)) throw new EgressDenied("egress_denied_private");
    return;
  }
  if (nameDenied(host)) throw new EgressDenied("egress_denied_private");
}
