import {
  CreateBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  s3EndpointOf,
  startSeaweedFs,
  TEST_S3_CREDENTIALS,
} from "../testing/containers.js";

/**
 * The object store on a small disk, as on a CI runner. SeaweedFS's default
 * 1 GB volumes let the first bucket take every slot such a disk allows, and
 * the first upload to the next bucket failed with 500 ("No writable
 * volumes"): the stack's browser test on GitHub's amd64 runner.
 */
describe("SeaweedFS on a small disk", () => {
  let container: StartedTestContainer;
  let s3: S3Client;

  beforeAll(async () => {
    container = await startSeaweedFs("1g");
    s3 = new S3Client({
      endpoint: s3EndpointOf(container),
      region: "eu-west-2",
      forcePathStyle: true,
      credentials: TEST_S3_CREDENTIALS,
    });
  }, 60_000);

  afterAll(async () => {
    s3.destroy();
    await container.stop();
  });

  it(
    "stores objects in a second bucket after the first",
    { timeout: 60_000 },
    async () => {
      for (const bucket of ["first-bucket", "opspilot-assets"]) {
        await s3.send(new CreateBucketCommand({ Bucket: bucket }));
        await expect(
          s3.send(
            new PutObjectCommand({ Bucket: bucket, Key: "slate", Body: "x" }),
          ),
          bucket,
        ).resolves.toBeDefined();
      }
    },
  );
});
