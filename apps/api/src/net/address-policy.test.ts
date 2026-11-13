import { describe, expect, it } from "vitest";

import { isPublicAddress } from "./address-policy.js";

describe("isPublicAddress", () => {
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "151.101.1.69",
    "2a04:4e42::81",
    "2606:4700:4700::1111",
  ])("allows the public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    ["loopback", "127.0.0.1"],
    ["loopback, elsewhere in 127/8", "127.255.0.9"],
    ["private 10/8", "10.1.2.3"],
    ["private 172.16/12", "172.31.255.255"],
    ["private 192.168/16", "192.168.0.10"],
    ["cloud metadata", "169.254.169.254"],
    ["carrier-grade NAT", "100.64.0.1"],
    ["this network", "0.0.0.0"],
    ["documentation", "203.0.113.5"],
    ["multicast", "239.1.1.1"],
    ["broadcast", "255.255.255.255"],
    ["IPv6 loopback", "::1"],
    ["IPv6 unspecified", "::"],
    ["IPv4-mapped loopback", "::ffff:127.0.0.1"],
    ["IPv4-mapped private, hex form", "::ffff:a00:1"],
    ["NAT64", "64:ff9b::a00:1"],
    ["unique local", "fd12:3456::1"],
    ["link-local", "fe80::1"],
    ["Teredo", "2001:0:4136:e378::1"],
    ["6to4", "2002:c000:0204::1"],
    ["IPv6 documentation", "2001:db8::1"],
    ["multicast IPv6", "ff02::1"],
  ])("refuses %s (%s)", (_label, address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["localhost", "example.com", "", "1.2.3", "::gg"])(
    "refuses %j, which is not an IP literal",
    (value) => {
      expect(isPublicAddress(value)).toBe(false);
    },
  );
});
