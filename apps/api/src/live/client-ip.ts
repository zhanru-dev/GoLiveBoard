import type { IncomingMessage } from "node:http";

/**
 * The client's address for a request Express never saw (a real-time
 * handshake), with Express's `trust proxy = <hops>` rule: the socket's peer,
 * then X-Forwarded-For from right to left, trusting `hops` proxies.
 */
export function clientIp(request: IncomingMessage, hops: number): string {
  const header = request.headers["x-forwarded-for"];
  const forwarded = (Array.isArray(header) ? header.join(",") : (header ?? ""))
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .reverse();
  const addresses = [request.socket.remoteAddress ?? "", ...forwarded];
  return addresses[Math.min(hops, addresses.length - 1)] ?? "";
}
