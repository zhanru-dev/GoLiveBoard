import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";

import { ConfigError, loadConfig } from "../config/app-config.js";
import { WorkerModule } from "../worker/worker.module.js";
import { DemoSeeder } from "./demo-seeder.js";

/**
 * `npm run db:seed`: puts the demo workspace in the database, or back to its
 * seed if it is there already, at once rather than at 03:00. Uses the
 * worker's modules without consuming any queue.
 */
let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (error instanceof ConfigError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
const context = await NestFactory.createApplicationContext(
  WorkerModule.forRoot(config, { worker: { consume: false } }),
  { bufferLogs: true },
);
context.useLogger(context.get(Logger));
try {
  const removedEvents = await context.get(DemoSeeder).reset();
  context
    .get(Logger)
    .log(`Demo workspace seeded (${String(removedEvents)} events replaced)`);
} finally {
  await context.close();
}
