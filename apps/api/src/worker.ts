import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";

import { ConfigError, loadConfig } from "./config/app-config.js";
import { initErrorReporting } from "./observability/error-reporting.js";
import { WorkerModule } from "./worker/worker.module.js";

function loadConfigOrExit() {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

const config = loadConfigOrExit();
// Before the application starts, so errors during start-up are reported too.
initErrorReporting(config, "worker");
const worker = await NestFactory.createApplicationContext(
  WorkerModule.forRoot(config),
  { bufferLogs: true },
);
worker.useLogger(worker.get(Logger));
// On SIGTERM, stop taking jobs, let running ones finish and close
// connections before exiting.
worker.enableShutdownHooks();
await worker.init();
worker.get(Logger).log("Worker started");
