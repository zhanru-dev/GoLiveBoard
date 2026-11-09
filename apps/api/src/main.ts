import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";

import { AppModule } from "./app.module.js";
import { APP_OPTIONS, configureApp } from "./app.setup.js";
import {
  type AppConfig,
  ConfigError,
  loadConfig,
} from "./config/app-config.js";

function loadConfigOrExit(): AppConfig {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      // The logger is not configured yet, so write the problems directly.
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

const config = loadConfigOrExit();
const app = await NestFactory.create<NestExpressApplication>(
  AppModule.forRoot(config),
  APP_OPTIONS,
);
configureApp(app);
// On SIGTERM (a deploy or `docker stop`), finish open requests and close
// connections before exiting.
app.enableShutdownHooks();
await app.listen(config.api.port, config.api.host);
