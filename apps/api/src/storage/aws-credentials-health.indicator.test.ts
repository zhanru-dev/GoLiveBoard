import { afterEach, describe, expect, it, vi } from "vitest";

import { loadTestConfig } from "../testing/config.js";
import { AwsCredentialsHealthIndicator } from "./aws-credentials-health.indicator.js";
import { ObjectStorage } from "./object-storage.js";

/**
 * Production signed S3 URLs (and sent mail) with credentials no container
 * could obtain, and readiness said nothing (the 27 November acceptance).
 */
describe("the AWS credentials readiness check", () => {
  const storages: ObjectStorage[] = [];
  const indicator = (credentials: "configured" | "none") => {
    const config = loadTestConfig();
    const storage = new ObjectStorage(
      credentials === "configured"
        ? config
        : // As in AWS: no keys, so the SDK's default chain decides.
          { ...config, storage: { ...config.storage, credentials: undefined } },
    );
    storages.push(storage);
    return new AwsCredentialsHealthIndicator(storage);
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const storage of storages.splice(0)) {
      storage.destroy();
    }
  });

  it("fails when no provider has credentials, as in a container cut off from the instance's", async () => {
    // Nothing in the environment, no files, no instance metadata service.
    for (const key of [
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "AWS_PROFILE",
      "AWS_WEB_IDENTITY_TOKEN_FILE",
      "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
      "AWS_CONTAINER_CREDENTIALS_FULL_URI",
    ]) {
      vi.stubEnv(key, undefined);
    }
    vi.stubEnv("AWS_CONFIG_FILE", "/nonexistent/aws-config");
    vi.stubEnv("AWS_SHARED_CREDENTIALS_FILE", "/nonexistent/aws-credentials");
    vi.stubEnv("AWS_EC2_METADATA_DISABLED", "true");

    const check = indicator("none");

    expect(check.name).toBe("aws_credentials");
    await expect(check.check()).rejects.toThrow(/credentials/i);
  });

  it("passes with the credentials the configuration gives", async () => {
    const check = indicator("configured");

    await expect(check.check()).resolves.toBeUndefined();
  });
});
