import {
  Inject,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";

import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { AwsCredentialsHealthIndicator } from "./aws-credentials-health.indicator.js";
import { ObjectStorage } from "./object-storage.js";

@Module({
  providers: [
    {
      provide: ObjectStorage,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new ObjectStorage(config),
    },
    AwsCredentialsHealthIndicator,
  ],
  exports: [ObjectStorage, AwsCredentialsHealthIndicator],
})
export class StorageModule
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(
    private readonly storage: ObjectStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.storage.createBucket) {
      await this.storage.ensureBucket(this.config.app.origin);
    }
  }

  onApplicationShutdown(): void {
    this.storage.destroy();
  }
}
