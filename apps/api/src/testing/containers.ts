import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import {
  type StartedValkeyContainer,
  ValkeyContainer,
} from "@testcontainers/valkey";
import {
  CreateBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  GenericContainer,
  getContainerRuntimeClient,
  type StartedTestContainer,
  Wait,
} from "testcontainers";

/**
 * The images integration tests run against. They must match
 * docker-compose.yml (a unit test checks this), so tests and local development
 * use the same versions.
 */
export const POSTGRES_IMAGE = "postgres:18.6-alpine";
export const VALKEY_IMAGE = "valkey/valkey:9.1.3-alpine";
export const SEAWEEDFS_IMAGE = "chrislusf/seaweedfs:4.53";

/** S3 credentials of the test object store; only ever used in tests. */
export const TEST_S3_CREDENTIALS = {
  accessKeyId: "opspilot-test",
  secretAccessKey: "opspilot-test-secret",
} as const;
const S3_PORT = 8333;

/** Starts a throwaway PostgreSQL server for one test file. */
export function startPostgres(): Promise<StartedPostgreSqlContainer> {
  return new PostgreSqlContainer(POSTGRES_IMAGE).start();
}

/** Starts a throwaway Valkey server for one test file. */
export function startValkey(): Promise<StartedValkeyContainer> {
  return new ValkeyContainer(VALKEY_IMAGE).start();
}

/** Starts a throwaway SeaweedFS with S3 enabled and the test credentials. */
export function startSeaweedFs(): Promise<StartedTestContainer> {
  const identities = {
    identities: [
      {
        name: "opspilot-test",
        credentials: [
          {
            accessKey: TEST_S3_CREDENTIALS.accessKeyId,
            secretKey: TEST_S3_CREDENTIALS.secretAccessKey,
          },
        ],
        actions: ["Admin", "Read", "Write", "List", "Tagging"],
      },
    ],
  };
  return new GenericContainer(SEAWEEDFS_IMAGE)
    .withCommand([
      "server",
      "-s3",
      "-s3.config=/etc/seaweedfs/s3.json",
      "-dir=/data",
      "-ip.bind=0.0.0.0",
    ])
    .withCopyContentToContainer([
      { content: JSON.stringify(identities), target: "/etc/seaweedfs/s3.json" },
    ])
    .withExposedPorts(S3_PORT)
    .withWaitStrategy(Wait.forHttp("/healthz", S3_PORT))
    .start();
}

/** The bucket every integration test file shares; object keys are random. */
export const TEST_S3_BUCKET = "opspilot-test";

/**
 * Creates the shared test bucket and writes one object to it. SeaweedFS
 * allocates storage for a bucket on its first write, which takes seconds;
 * doing it here keeps that delay out of the tests.
 */
export async function prepareTestBucket(endpoint: string): Promise<void> {
  const s3 = new S3Client({
    endpoint,
    region: "eu-west-2",
    forcePathStyle: true,
    credentials: TEST_S3_CREDENTIALS,
  });
  try {
    await s3.send(new CreateBucketCommand({ Bucket: TEST_S3_BUCKET }));
    await s3.send(
      new PutObjectCommand({
        Bucket: TEST_S3_BUCKET,
        Key: "warm-up",
        Body: "x",
      }),
    );
  } finally {
    s3.destroy();
  }
}

/** The S3 endpoint of a started SeaweedFS container. */
export function s3EndpointOf(container: StartedTestContainer): string {
  return `http://${container.getHost()}:${String(container.getMappedPort(S3_PORT))}`;
}

/**
 * Freezes a container's processes, as a hung server would be: connections
 * are still accepted by the kernel, but nothing ever answers. Returns the
 * function that thaws it.
 */
export async function pauseContainer(id: string): Promise<() => Promise<void>> {
  const runtime = await getContainerRuntimeClient();
  const container = runtime.container.getById(id);
  await container.pause();
  return async () => {
    await container.unpause();
  };
}
