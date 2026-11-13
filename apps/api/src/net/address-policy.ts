import { BlockList, isIP } from "node:net";

/**
 * Address ranges an outbound request to a customer-supplied URL must never
 * reach (SSRF protection, docs/02 section 7.10): this host, the private
 * network, cloud metadata endpoints (169.254.169.254), and ranges that are
 * reserved, shared or used only for documentation or tunnelling.
 */
const BLOCKED_IPV4: readonly [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, including cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, including broadcast
];

const BLOCKED_IPV6: readonly [string, number][] = [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  // NAT64 addresses carry an IPv4 address that could be private; no public
  // stream host needs them.
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64], // discard
  ["2001::", 32], // Teredo
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
];

const blocked = new BlockList();
for (const [network, prefix] of BLOCKED_IPV4) {
  blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of BLOCKED_IPV6) {
  blocked.addSubnet(network, prefix, "ipv6");
}

/**
 * IPv4-mapped IPv6 addresses (`::ffff:10.0.0.1`) reach the IPv4 address they
 * carry. Kept apart because BlockList also matches plain IPv4 addresses
 * against this range, which would block every IPv4 address.
 */
const ipv4Mapped = new BlockList();
ipv4Mapped.addSubnet("::ffff:0:0", 96, "ipv6");

/**
 * True when `address` (an IPv4 or IPv6 literal) is a public unicast address
 * that outbound requests may reach. Anything that is not an IP literal is
 * refused.
 */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 0) {
    return false;
  }
  if (version === 4) {
    return !blocked.check(address, "ipv4");
  }
  return !blocked.check(address, "ipv6") && !ipv4Mapped.check(address, "ipv6");
}
