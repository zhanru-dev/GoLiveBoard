import { Inject, Injectable } from "@nestjs/common";
import { Redis } from "ioredis";

import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import type { HealthIndicator } from "../health/health-indicator.js";

@Injectable()
export class ValkeyHealthIndicator implements HealthIndicator {
  readonly name = "valkey";

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /**
   * Opens a short-lived connection, sends PING and closes it. When the check
   * times out, aborting closes the connection too, so a stalled server never
   * collects unanswered commands from check after check.
   */
  async check(signal: AbortSignal): Promise<void> {
    const client = new Redis(this.config.valkey.url, {
      lazyConnect: true,
      // Shown by CLIENT LIST, so an operator can tell who is connected.
      connectionName: "opspilot-api-health",
      // Fail at once instead of retrying or queueing: the next check retries.
      retryStrategy: () => null,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
    });
    // Failures reach the caller through the rejected promises below; without a
    // listener, ioredis would also print every one of them to stderr.
    client.on("error", () => undefined);
    const close = () => {
      client.disconnect();
    };
    signal.addEventListener("abort", close, { once: true });
    try {
      await client.connect();
      await client.ping();
    } finally {
      signal.removeEventListener("abort", close);
      client.disconnect();
    }
  }
}
