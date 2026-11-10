import { Writable } from "node:stream";

import type { Type } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { z } from "zod";

import { AppModule } from "../app.module.js";
import { APP_OPTIONS, configureApp } from "../app.setup.js";
import { loadConfig } from "../config/app-config.js";
import {
  HEALTH_INDICATORS,
  type HealthIndicator,
} from "../health/health-indicator.js";

export interface TestAppOptions {
  /** Environment variables on top of the test defaults. */
  readonly env?: Readonly<Record<string, string>>;
  /** Extra controllers, for routes that exist only in a test. */
  readonly controllers?: Type[];
  readonly healthIndicators?: readonly HealthIndicator[];
  readonly logs?: LogCapture;
}

/**
 * Starts the real application in memory, configured exactly like `main.ts`,
 * for tests that send HTTP requests with supertest.
 */
export async function createTestApp(
  options: TestAppOptions = {},
): Promise<NestExpressApplication> {
  const config = loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: options.logs === undefined ? "silent" : "info",
    // Nothing listens on port 1. Clients connect lazily, so tests that never
    // touch the database or Valkey need neither.
    DATABASE_URL: "postgres://test:test@127.0.0.1:1/test",
    VALKEY_URL: "redis://127.0.0.1:1",
    ...options.env,
  });
  const builder = Test.createTestingModule({
    imports: [AppModule.forRoot(config, { logDestination: options.logs })],
    controllers: options.controllers ?? [],
  });
  if (options.healthIndicators !== undefined) {
    builder
      .overrideProvider(HEALTH_INDICATORS)
      .useValue(options.healthIndicators);
  }
  const moduleRef = await builder.compile();
  const app =
    moduleRef.createNestApplication<NestExpressApplication>(APP_OPTIONS);
  configureApp(app);
  await app.init();
  return app;
}

const LogEntry = z.looseObject({
  level: z.number(),
  msg: z.string().optional(),
  req: z
    .looseObject({ id: z.string().optional(), path: z.string().optional() })
    .optional(),
  res: z.looseObject({ statusCode: z.number() }).optional(),
  err: z.looseObject({ message: z.string(), stack: z.string() }).optional(),
});
export type LogEntry = z.infer<typeof LogEntry>;

/** Pino level numbers. */
export const LOG_LEVEL = { info: 30, warn: 40, error: 50 } as const;

/** A log destination that keeps every line, so tests can assert on logs. */
export class LogCapture extends Writable {
  readonly lines: string[] = [];

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.lines.push(chunk.toString("utf8"));
    callback();
  }

  entries(): LogEntry[] {
    return this.lines.map((line) => LogEntry.parse(JSON.parse(line)));
  }

  forRequest(requestId: string): LogEntry[] {
    return this.entries().filter((entry) => entry.req?.id === requestId);
  }
}
