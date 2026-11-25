import type { BrowserTelemetryRequest } from "@opspilot/contracts";
import { Injectable } from "@nestjs/common";

import {
  countRealtimeFailure,
  recordWebVital,
} from "../observability/metrics.js";
import { RATE_LIMITS, RateLimiter } from "../rate-limit/rate-limiter.js";
import { DomainError } from "../shared/domain/domain-error.js";

@Injectable()
export class BrowserTelemetryService {
  constructor(private readonly rateLimiter: RateLimiter) {}

  /**
   * Records the measurements, unless this address has sent too many, or
   * Valkey cannot count (the rule fails closed): then they are dropped,
   * quietly, as telemetry can be.
   */
  async record(request: BrowserTelemetryRequest, ip: string): Promise<void> {
    const allowed = await this.rateLimiter
      .consume(RATE_LIMITS.browserTelemetryPerIp, ip)
      .catch((error: unknown) => {
        if (error instanceof DomainError) {
          return false;
        }
        throw error;
      });
    if (!allowed) {
      return;
    }
    for (const measurement of request.measurements) {
      if (measurement.kind === "web-vital") {
        recordWebVital(measurement.name, measurement.value, measurement.route);
      } else {
        countRealtimeFailure(measurement.reason, measurement.route);
      }
    }
  }
}
