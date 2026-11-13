import { Module } from "@nestjs/common";

import { ValkeyModule } from "../valkey/valkey.module.js";
import { RateLimiter } from "./rate-limiter.js";

@Module({
  imports: [ValkeyModule],
  providers: [RateLimiter],
  exports: [RateLimiter],
})
export class RateLimitModule {}
