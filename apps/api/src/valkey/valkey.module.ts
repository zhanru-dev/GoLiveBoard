import { Module } from "@nestjs/common";

import { ValkeyHealthIndicator } from "./valkey-health.indicator.js";

/**
 * Valkey integration. For now only the readiness check; the shared client for
 * queues and rate limits arrives with them in milestone 2.
 */
@Module({
  providers: [ValkeyHealthIndicator],
  exports: [ValkeyHealthIndicator],
})
export class ValkeyModule {}
