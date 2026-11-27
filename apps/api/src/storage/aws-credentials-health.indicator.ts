import { Injectable } from "@nestjs/common";

import type { HealthIndicator } from "../health/health-indicator.js";
import { ObjectStorage } from "./object-storage.js";

/**
 * The AWS credentials S3 signing and SES use can be obtained. In AWS they
 * come from the host's role through the instance metadata service; when a
 * container cannot reach it, every upload and every email fails while the
 * database and Valkey look fine. Readiness gates the deploy, so a release
 * without credentials is rolled back instead of going live.
 */
@Injectable()
export class AwsCredentialsHealthIndicator implements HealthIndicator {
  readonly name = "aws_credentials";

  constructor(private readonly storage: ObjectStorage) {}

  check(): Promise<void> {
    return this.storage.checkCredentials();
  }
}
