import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import type { Redis } from "ioredis";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { ValkeyHealthIndicator } from "./valkey-health.indicator.js";
import {
  closeValkeyClient,
  createValkeyClient,
  VALKEY_CLIENT,
} from "./valkey.js";

@Module({
  providers: [
    {
      provide: VALKEY_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createValkeyClient(config),
    },
    ValkeyHealthIndicator,
  ],
  exports: [VALKEY_CLIENT, ValkeyHealthIndicator],
})
export class ValkeyModule implements OnApplicationShutdown {
  constructor(
    @Inject(VALKEY_CLIENT) private readonly client: Redis,
    @InjectPinoLogger(ValkeyModule.name) logger: PinoLogger,
  ) {
    // While Valkey is down, ioredis retries every few seconds and emits an
    // "error" for each attempt. Log the first failure and the recovery, not
    // every retry, so an outage does not flood the logs.
    let available = true;
    client.on("error", (error) => {
      if (available) {
        available = false;
        logger.error({ err: error }, "Valkey connection failed");
      }
    });
    client.on("ready", () => {
      if (!available) {
        available = true;
        logger.info("Valkey connection restored");
      }
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await closeValkeyClient(this.client);
  }
}
