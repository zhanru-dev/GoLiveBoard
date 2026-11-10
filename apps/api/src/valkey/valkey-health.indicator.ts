import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";

import type { HealthIndicator } from "../health/health-indicator.js";
import { VALKEY_CLIENT } from "./valkey.js";

@Injectable()
export class ValkeyHealthIndicator implements HealthIndicator {
  readonly name = "valkey";

  constructor(@Inject(VALKEY_CLIENT) private readonly client: Redis) {}

  async check(): Promise<void> {
    await this.client.ping();
  }
}
