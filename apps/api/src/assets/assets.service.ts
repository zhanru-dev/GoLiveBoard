import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import {
  type Asset,
  type AssetUpload,
  type CreateHoldingSlateUploadRequest,
  HOLDING_SLATE_MAX_BYTES,
  type HoldingSlate,
  ImageContentType,
} from "@opspilot/contracts";

import { recordAudit } from "../audit/audit.js";
import type { Actor } from "../auth/actor.js";
import { PRISMA } from "../database/prisma.js";
import { lockWritableEvent } from "../events/event-lock.queries.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { DomainError } from "../shared/domain/domain-error.js";
import { ObjectStorage } from "../storage/object-storage.js";
import { detectImageType, SIGNATURE_BYTES } from "./domain/image-signature.js";

/** Long enough to upload 5 MB on a slow connection, short enough to be useless if leaked. */
export const UPLOAD_URL_TTL_SECONDS = 5 * 60;
/** How long a link to view the slate in Launch Control works. */
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

/**
 * All the storage work of one `complete` (stat, copy, stat, read) must end
 * within this, and each call also has its own, shorter limit. It is well
 * inside the transaction's timeout, so storage gives up first and the
 * transaction rolls back normally, instead of the database timing out and
 * releasing the locks while a storage call is still running.
 */
export const COMPLETE_STORAGE_BUDGET_MS = 20_000;
const COMPLETE_TRANSACTION_TIMEOUT_MS = 30_000;

/**
 * Where the browser uploads: a separate key from the one the slate is served
 * from. The presigned URL stays usable for a few minutes, so whatever is at
 * this key can change at any time; only a copy that the API made and then
 * verified ever becomes the slate.
 */
export function uploadKeyFor(storageKey: string): string {
  return `uploads/${storageKey}`;
}

/** Every file of one event's assets is stored under this prefix. */
export function eventFilesPrefix(eventId: string): string {
  return `events/${eventId}/`;
}

type Completion =
  | { readonly kind: "READY"; readonly changed: boolean }
  | { readonly kind: "REJECTED"; readonly reason: string };

const ASSET_SELECT = {
  id: true,
  eventId: true,
  kind: true,
  status: true,
  storageKey: true,
  contentType: true,
  sizeBytes: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.AssetSelect;

type AssetRow = Prisma.AssetGetPayload<{ select: typeof ASSET_SELECT }>;

function toAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    contentType: ImageContentType.parse(row.contentType),
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * FR-ST-3: the holding slate. The browser uploads straight to object storage
 * with a presigned URL, so the file never passes through the API; the API
 * then verifies what actually arrived before the slate counts.
 */
@Injectable()
export class AssetsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly storage: ObjectStorage,
    @InjectPinoLogger(AssetsService.name) private readonly logger: PinoLogger,
  ) {}

  async createHoldingSlateUpload(
    actor: Actor,
    eventId: string,
    input: CreateHoldingSlateUploadRequest,
  ): Promise<AssetUpload> {
    const now = this.clock.now();
    const asset = await this.prisma.$transaction(async (tx) => {
      await lockWritableEvent(tx, actor.workspaceId, eventId);
      return tx.asset.create({
        data: {
          eventId,
          kind: "HOLDING_SLATE",
          // A random key: never derived from anything the uploader chose.
          storageKey: `${eventFilesPrefix(eventId)}holding-slates/${randomUUID()}`,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          createdAt: now,
          updatedAt: now,
        },
        select: ASSET_SELECT,
      });
    });
    const url = await this.storage.presignUpload(
      uploadKeyFor(asset.storageKey),
      input.contentType,
      input.sizeBytes,
      UPLOAD_URL_TTL_SECONDS,
    );
    return {
      assetId: asset.id,
      url,
      method: "PUT",
      headers: { "Content-Type": input.contentType },
      expiresAt: new Date(
        now.getTime() + UPLOAD_URL_TTL_SECONDS * 1000,
      ).toISOString(),
    };
  }

  /**
   * Verifies an upload and makes it the event's holding slate. Calling it
   * again for a slate that is already ready returns it unchanged.
   *
   * In one transaction it locks the asset (so completions of one asset run
   * one at a time), then the event (so an archived event refuses it, and a
   * transition never sees a half-finished slate). It copies the upload to
   * the final key, which no presigned URL can write, and checks that copy:
   * what was verified is exactly what is served, even if the upload URL is
   * used again afterwards. Files are deleted only after this request has
   * itself committed the rejection.
   *
   * The transaction waits on storage while it holds the locks; one storage
   * budget (COMPLETE_STORAGE_BUDGET_MS) bounds that wait.
   *
   * @throws DomainError `UPLOAD_NOT_FOUND` (nothing uploaded yet; the asset
   * stays pending so the client can retry), `ASSET_REJECTED` (not the
   * declared image, or the wrong size), `EVENT_ARCHIVED`,
   * `SERVICE_UNAVAILABLE` (storage did not answer in time; the asset stays
   * pending)
   */
  async complete(actor: Actor, assetId: string): Promise<Asset> {
    const { asset, completion } = await this.prisma.$transaction(
      async (tx) => {
        const locked = await this.lockAsset(tx, actor, assetId);
        if (locked.status === "READY") {
          return {
            asset: locked,
            completion: { kind: "READY", changed: false } as const,
          };
        }
        if (locked.status === "REJECTED") {
          throw new DomainError("ASSET_REJECTED");
        }
        await lockWritableEvent(tx, actor.workspaceId, locked.eventId);
        const reason = await this.copyAndVerify(
          locked,
          AbortSignal.timeout(COMPLETE_STORAGE_BUDGET_MS),
        );
        const now = this.clock.now();
        if (reason !== undefined) {
          await tx.asset.update({
            where: { id: locked.id },
            data: { status: "REJECTED", updatedAt: now },
          });
          return {
            asset: locked,
            completion: { kind: "REJECTED", reason } as const,
          };
        }
        await tx.asset.update({
          where: { id: locked.id },
          data: { status: "READY", updatedAt: now },
        });
        await recordAudit(tx, actor, {
          action: "asset.ready",
          targetType: "asset",
          targetId: locked.id,
          eventId: locked.eventId,
          after: {
            kind: locked.kind,
            contentType: locked.contentType,
            sizeBytes: locked.sizeBytes,
          },
        });
        return {
          asset: locked,
          completion: { kind: "READY", changed: true } as const,
        };
      },
      { timeout: COMPLETE_TRANSACTION_TIMEOUT_MS },
    );
    return this.finish(asset, completion);
  }

  /** Clean-up after the transaction committed, then the answer. */
  private async finish(
    asset: AssetRow,
    completion: Completion,
  ): Promise<Asset> {
    if (completion.kind === "REJECTED") {
      // Nothing may serve these files; the asset is already REJECTED.
      await this.removeQuietly(asset.storageKey);
      await this.removeQuietly(uploadKeyFor(asset.storageKey));
      throw new DomainError("ASSET_REJECTED", { detail: completion.reason });
    }
    if (completion.changed) {
      await this.removeQuietly(uploadKeyFor(asset.storageKey));
    }
    return toAsset(
      await this.prisma.asset.findUniqueOrThrow({
        where: { id: asset.id },
        select: ASSET_SELECT,
      }),
    );
  }

  /** The most recently verified slate, with a short-lived link to view it. */
  async getHoldingSlate(actor: Actor, eventId: string): Promise<HoldingSlate> {
    const row = await this.prisma.asset.findFirst({
      where: {
        eventId,
        kind: "HOLDING_SLATE",
        status: "READY",
        event: { workspaceId: actor.workspaceId },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: ASSET_SELECT,
    });
    if (row === null) {
      throw new DomainError("NOT_FOUND", {
        detail: "No holding slate has been uploaded for this event.",
      });
    }
    const downloadUrl = await this.storage.presignDownload(
      row.storageKey,
      DOWNLOAD_URL_TTL_SECONDS,
    );
    return {
      ...toAsset(row),
      downloadUrl,
      downloadUrlExpiresAt: new Date(
        this.clock.now().getTime() + DOWNLOAD_URL_TTL_SECONDS * 1000,
      ).toISOString(),
    };
  }

  /**
   * Copies the upload to the final key and checks the copy.
   *
   * @returns why the file is not acceptable, or `undefined`
   */
  private async copyAndVerify(
    asset: AssetRow,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    const uploadKey = uploadKeyFor(asset.storageKey);
    if ((await this.storage.stat(uploadKey, signal)) === undefined) {
      throw new DomainError("UPLOAD_NOT_FOUND");
    }
    await this.storage.copy(uploadKey, asset.storageKey, signal);
    const stored = await this.storage.stat(asset.storageKey, signal);
    if (
      stored === undefined ||
      stored.sizeBytes > HOLDING_SLATE_MAX_BYTES ||
      stored.sizeBytes !== asset.sizeBytes
    ) {
      return "The file size does not match the upload.";
    }
    const detected = detectImageType(
      await this.storage.readStart(asset.storageKey, SIGNATURE_BYTES, signal),
    );
    if (detected !== asset.contentType) {
      return "The file is not the declared JPEG, PNG or WebP image.";
    }
    return undefined;
  }

  /**
   * Deletes a file that must not be served. A failure is logged, not thrown:
   * the asset's status already keeps the file from being used.
   */
  private async removeQuietly(key: string): Promise<void> {
    try {
      await this.storage.remove(key);
    } catch (error) {
      this.logger.warn({ err: error, key }, "Could not delete a stored file");
    }
  }

  /** Locks an asset of the actor's workspace; another workspace's is `404`. */
  private async lockAsset(
    tx: Prisma.TransactionClient,
    actor: Actor,
    assetId: string,
  ): Promise<AssetRow> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT asset.id
      FROM assets AS asset
      JOIN events AS event ON event.id = asset.event_id
      WHERE asset.id = ${assetId}::uuid AND event.workspace_id = ${actor.workspaceId}::uuid
      FOR UPDATE OF asset`;
    if (rows.length === 0) {
      throw new DomainError("NOT_FOUND");
    }
    return tx.asset.findUniqueOrThrow({
      where: { id: assetId },
      select: ASSET_SELECT,
    });
  }
}
