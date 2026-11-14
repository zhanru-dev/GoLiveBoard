import { Module } from "@nestjs/common";

import { PasswordHasherModule } from "../auth/password-hasher.js";
import { DatabaseModule } from "../database/database.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { DemoSeeder } from "./demo-seeder.js";

/** The shared demo workspace (FR-AUTH-5): its seed and its reset. */
@Module({
  imports: [DatabaseModule, PasswordHasherModule, StorageModule],
  providers: [DemoSeeder],
  exports: [DemoSeeder],
})
export class DemoModule {}
