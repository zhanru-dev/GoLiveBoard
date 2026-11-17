import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { TriageRunner } from "./triage-runner.js";
import { triageModelProvider } from "./triage-model.provider.js";

/** AI question triage, the worker's side (FR-RN-6). */
@Module({
  imports: [DatabaseModule],
  providers: [TriageRunner, triageModelProvider],
  exports: [TriageRunner],
})
export class TriageWorkerModule {}
