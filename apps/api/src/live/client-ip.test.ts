import type { IncomingMessage } from "node:http";

import { describe, expect, it } from "vitest";

import { clientIp } from "./client-ip.js";

const request = (remoteAddress: string, forwardedFor?: string) =>
  ({
    headers:
      forwardedFor === undefined ? {} : { "x-forwarded-for": forwardedFor },
    socket: { remoteAddress },
  }) as unknown as IncomingMessage;

describe("clientIp", () => {
  it("is the peer when no proxy is trusted, whatever the header says", () => {
    expect(clientIp(request("10.0.0.2", "198.51.100.7"), 0)).toBe("10.0.0.2");
  });

  it("takes the address the trusted proxy saw", () => {
    expect(clientIp(request("10.0.0.2", "198.51.100.7"), 1)).toBe(
      "198.51.100.7",
    );
  });

  it("ignores what the client itself put in front of the header", () => {
    expect(clientIp(request("10.0.0.2", "203.0.113.9, 198.51.100.7"), 1)).toBe(
      "198.51.100.7",
    );
  });

  it("falls back to the furthest address it has", () => {
    expect(clientIp(request("10.0.0.2"), 1)).toBe("10.0.0.2");
    expect(clientIp(request("10.0.0.2", "198.51.100.7"), 3)).toBe(
      "198.51.100.7",
    );
  });
});
