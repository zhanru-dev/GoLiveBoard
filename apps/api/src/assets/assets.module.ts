import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { AssetsController } from "./assets.controller.js";
import { AssetsService } from "./assets.service.js";

@Module({
  imports: [DatabaseModule, StorageModule],
  controllers: [AssetsController],
  providers: [AssetsService],
})
export class AssetsModule {}
