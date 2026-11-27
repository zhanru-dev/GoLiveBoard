import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { AppConfig } from "../config/app-config.js";
import { DomainError } from "../shared/domain/domain-error.js";

export interface StoredObject {
  readonly sizeBytes: number;
  readonly contentType: string | undefined;
}

/**
 * No storage call may hold a request (or a database transaction) for long.
 * The request timeout ends one attempt; the operation timeout ends the whole
 * call, retries included.
 */
export interface StorageTimeouts {
  readonly connectMs: number;
  readonly requestMs: number;
  readonly operationMs: number;
}

export const DEFAULT_STORAGE_TIMEOUTS: StorageTimeouts = {
  connectMs: 3_000,
  requestMs: 5_000,
  operationMs: 6_000,
};

/** How long a browser may cache the answer to a CORS preflight. */
const CORS_MAX_AGE_SECONDS = 600;

function createClient(
  config: AppConfig,
  endpoint: string | undefined,
  timeouts: StorageTimeouts,
): S3Client {
  return new S3Client({
    region: config.storage.region,
    ...(endpoint !== undefined && { endpoint }),
    ...(config.storage.credentials !== undefined && {
      credentials: config.storage.credentials,
    }),
    forcePathStyle: config.storage.forcePathStyle,
    requestHandler: {
      connectionTimeout: timeouts.connectMs,
      requestTimeout: timeouts.requestMs,
      // Without this the SDK only logs a warning when the request timeout
      // passes, and keeps waiting (the milestone 3 re-review).
      throwOnRequestTimeout: true,
    },
    // By default the SDK adds a checksum of the (still empty) body to
    // presigned URLs, so every real upload would be refused as corrupt, and
    // asks for response checksums that presigned downloads cannot use.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

/**
 * The object store (S3; SeaweedFS locally), reduced to what the app needs.
 * Two clients: one reaches storage from the server, the other only signs
 * URLs for the address browsers use, because a signature covers the host.
 */
export class ObjectStorage {
  private readonly client: S3Client;
  private readonly signer: S3Client;
  private readonly bucket: string;
  private readonly timeouts: StorageTimeouts;

  constructor(
    config: AppConfig,
    timeouts: StorageTimeouts = DEFAULT_STORAGE_TIMEOUTS,
  ) {
    this.client = createClient(config, config.storage.endpoint, timeouts);
    this.signer = createClient(config, config.storage.publicEndpoint, timeouts);
    this.bucket = config.storage.bucket;
    this.timeouts = timeouts;
  }

  /**
   * Runs one storage call, abandoned when the operation timeout passes or
   * the caller's signal aborts, whichever comes first.
   *
   * @throws DomainError `SERVICE_UNAVAILABLE` when storage did not answer in
   * time
   */
  private async bounded<Output>(
    signal: AbortSignal | undefined,
    call: (options: { abortSignal: AbortSignal }) => Promise<Output>,
  ): Promise<Output> {
    const deadline = AbortSignal.timeout(this.timeouts.operationMs);
    const abortSignal =
      signal === undefined ? deadline : AbortSignal.any([deadline, signal]);
    try {
      return await call({ abortSignal });
    } catch (error) {
      if (abortSignal.aborted || isTimeout(error)) {
        throw new DomainError("SERVICE_UNAVAILABLE", {
          detail: "File storage did not answer in time. Try again shortly.",
          cause: error,
        });
      }
      throw error;
    }
  }

  /**
   * A URL the browser can `PUT` exactly this file to. The content type and
   * length are signed, so storage itself refuses a different type or size.
   */
  /**
   * Resolves the credentials URLs are signed with: in AWS, the host role's,
   * from the instance metadata service. Signing makes no request to S3, so
   * without this check missing credentials show only when someone uploads,
   * and SES, on the same default chain, only when mail goes out. Readiness
   * runs it (AwsCredentialsHealthIndicator).
   */
  async checkCredentials(): Promise<void> {
    await this.signer.config.credentials();
  }

  presignUpload(
    key: string,
    contentType: string,
    sizeBytes: number,
    expiresInSeconds: number,
  ): Promise<string> {
    return getSignedUrl(
      this.signer,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: sizeBytes,
      }),
      {
        expiresIn: expiresInSeconds,
        signableHeaders: new Set(["content-type", "content-length"]),
      },
    );
  }

  presignDownload(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  /** The object's size and type, or `undefined` when it does not exist. */
  async stat(
    key: string,
    signal?: AbortSignal,
  ): Promise<StoredObject | undefined> {
    try {
      const head = await this.bounded(signal, (options) =>
        this.client.send(
          new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
          options,
        ),
      );
      return {
        sizeBytes: head.ContentLength ?? 0,
        contentType: head.ContentType,
      };
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * The first `byteCount` bytes, without downloading the rest. Reading the
   * body is inside the time limit too: storage can send headers and stall.
   */
  readStart(
    key: string,
    byteCount: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    return this.bounded(signal, async (options) => {
      const object = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: `bytes=0-${String(byteCount - 1)}`,
        }),
        options,
      );
      return (await object.Body?.transformToByteArray()) ?? new Uint8Array();
    });
  }

  /** Copies an object inside the bucket, on the storage side. */
  async copy(
    fromKey: string,
    toKey: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.bounded(signal, (options) =>
      this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          CopySource: `${this.bucket}/${encodeURIComponent(fromKey).replaceAll("%2F", "/")}`,
          Key: toKey,
        }),
        options,
      ),
    );
  }

  /**
   * Every key that starts with `prefix`, a page (up to 1,000 keys) per call,
   * each call bounded like any other.
   */
  async listKeys(prefix: string, signal?: AbortSignal): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const page = await this.bounded(signal, (options) =>
        this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
          options,
        ),
      );
      for (const object of page.Contents ?? []) {
        if (object.Key !== undefined) {
          keys.push(object.Key);
        }
      }
      continuationToken = page.IsTruncated
        ? page.NextContinuationToken
        : undefined;
    } while (continuationToken !== undefined);
    return keys;
  }

  async remove(key: string, signal?: AbortSignal): Promise<void> {
    await this.bounded(signal, (options) =>
      this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
        options,
      ),
    );
  }

  /**
   * Creates the bucket and lets the app's origin upload to it from the
   * browser (local development and tests; Terraform does this in AWS). It
   * also writes and deletes one object: SeaweedFS allocates a bucket's
   * storage on its first write, which takes seconds, and that wait belongs
   * at start-up rather than in someone's first upload.
   */
  async ensureBucket(appOrigin: string): Promise<void> {
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      const exists =
        error instanceof S3ServiceException &&
        ["BucketAlreadyOwnedByYou", "BucketAlreadyExists"].includes(error.name);
      if (!exists) {
        throw error;
      }
    }
    await this.client.send(
      new PutBucketCorsCommand({
        Bucket: this.bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: [appOrigin],
              AllowedMethods: ["PUT", "GET"],
              AllowedHeaders: ["content-type"],
              MaxAgeSeconds: CORS_MAX_AGE_SECONDS,
            },
          ],
        },
      }),
    );
    const marker = ".goliveboard-ready";
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: marker, Body: "" }),
    );
    await this.remove(marker);
  }

  destroy(): void {
    this.client.destroy();
    this.signer.destroy();
  }
}

/** The SDK's own timeouts (connection or request), as opposed to an S3 error. */
function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    ["TimeoutError", "AbortError", "RequestTimeout"].includes(error.name)
  );
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    (error.name === "NotFound" || error.$metadata.httpStatusCode === 404)
  );
}
