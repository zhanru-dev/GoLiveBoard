import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { AppConfig } from "../config/app-config.js";

export interface StoredObject {
  readonly sizeBytes: number;
  readonly contentType: string | undefined;
}

/** No storage call may hold a request (or a database transaction) for long. */
const STORAGE_CONNECT_TIMEOUT_MS = 3_000;
const STORAGE_REQUEST_TIMEOUT_MS = 10_000;

/** How long a browser may cache the answer to a CORS preflight. */
const CORS_MAX_AGE_SECONDS = 600;

function createClient(
  config: AppConfig,
  endpoint: string | undefined,
): S3Client {
  return new S3Client({
    region: config.storage.region,
    ...(endpoint !== undefined && { endpoint }),
    ...(config.storage.credentials !== undefined && {
      credentials: config.storage.credentials,
    }),
    forcePathStyle: config.storage.forcePathStyle,
    requestHandler: {
      connectionTimeout: STORAGE_CONNECT_TIMEOUT_MS,
      requestTimeout: STORAGE_REQUEST_TIMEOUT_MS,
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

  constructor(config: AppConfig) {
    this.client = createClient(config, config.storage.endpoint);
    this.signer = createClient(config, config.storage.publicEndpoint);
    this.bucket = config.storage.bucket;
  }

  /**
   * A URL the browser can `PUT` exactly this file to. The content type and
   * length are signed, so storage itself refuses a different type or size.
   */
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
  async stat(key: string): Promise<StoredObject | undefined> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
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

  /** The first `byteCount` bytes, without downloading the rest. */
  async readStart(key: string, byteCount: number): Promise<Uint8Array> {
    const object = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Range: `bytes=0-${String(byteCount - 1)}`,
      }),
    );
    return (await object.Body?.transformToByteArray()) ?? new Uint8Array();
  }

  /** Copies an object inside the bucket, on the storage side. */
  async copy(fromKey: string, toKey: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${encodeURIComponent(fromKey).replaceAll("%2F", "/")}`,
        Key: toKey,
      }),
    );
  }

  async remove(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
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
    const marker = ".opspilot-ready";
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

function isNotFound(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    (error.name === "NotFound" || error.$metadata.httpStatusCode === 404)
  );
}
