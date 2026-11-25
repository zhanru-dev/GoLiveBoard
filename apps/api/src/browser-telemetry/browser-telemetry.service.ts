import type { BrowserTelemetryRequest } from "@opspilot/contracts";
import { isIPv6 } from "node:net";

import { Injectable } from "@nestjs/common";

import {
  countRealtimeFailure,
  recordWebVital,
} from "../observability/metrics.js";
import {
  RATE_LIMITS,
  RateLimiter,
  type RateLimitRule,
} from "../rate-limit/rate-limiter.js";
import { DomainError } from "../shared/domain/domain-error.js";

/**
 * Who sent a measurement, as far as the limits are concerned: the address,
 * or for IPv6 its /64, which one connection usually gets whole (so a
 * script cannot become thousands of visitors by changing the last bits).
 */
export function visitorOf(ip: string): string {
  if (!isIPv6(ip) || ip.toLowerCase().startsWith("::ffff:")) {
    return ip;
  }
  const [head = "", tail = ""] = ip.toLowerCase().split("::");
  const front = head === "" ? [] : head.split(":");
  const back = tail === "" ? [] : tail.split(":");
  const groups = ip.includes("::")
    ? [
        ...front,
        ...Array<string>(8 - front.length - back.length).fill("0"),
        ...back,
      ]
    : front;
  return `${groups
    .slice(0, 4)
    .map((group) => Number.parseInt(group, 16).toString(16))
    .join(":")}::/64`;
}

@Injectable()
export class BrowserTelemetryService {
  constructor(private readonly rateLimiter: RateLimiter) {}

  /**
   * Records the measurements a visitor may still add (RATE_LIMITS: requests
   * per address, then each measurement per visitor), dropping the rest
   * quietly, as telemetry can be; and all of them while Valkey cannot count
   * (the rules fail closed). The endpoint has no session, so anyone can
   * send anything that fits the contract: the limits are what keep one
   * sender from moving the alerts.
   */
  async record(request: BrowserTelemetryRequest, ip: string): Promise<void> {
    if (!(await this.allowed(RATE_LIMITS.browserTelemetryPerIp, ip))) {
      return;
    }
    const visitor = visitorOf(ip);
    for (const measurement of request.measurements) {
      if (measurement.kind === "web-vital") {
        const key = `${visitor}|${measurement.name}|${measurement.route}`;
        if (await this.allowed(RATE_LIMITS.browserVitalPerVisitor, key)) {
          recordWebVital(
            measurement.name,
            measurement.value,
            measurement.route,
          );
        }
      } else {
        const key = `${visitor}|${measurement.reason}`;
        if (await this.allowed(RATE_LIMITS.browserFailurePerVisitor, key)) {
          countRealtimeFailure(measurement.reason, measurement.route);
        }
      }
    }
  }

  private allowed(rule: RateLimitRule, subject: string): Promise<boolean> {
    return this.rateLimiter.consume(rule, subject).catch((error: unknown) => {
      if (error instanceof DomainError) {
        return false;
      }
      throw error;
    });
  }
}
