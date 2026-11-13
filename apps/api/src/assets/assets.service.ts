import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
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
          storageKey: `events/${eventId}/holding-slates/${randomUUID()}`,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          createdAt: now,
          updatedAt: now,
        },
        select: ASSET_SELECT,
      });
    });
    const url = await this.storage.presignUpload(
      asset.storageKey,
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
   * @throws DomainError `UPLOAD_NOT_FOUND` (nothing uploaded yet; the asset
   * stays pending so the client can retry), `ASSET_REJECTED` (not the
   * declared image, or too large; the file is deleted)
   */
  async complete(actor: Actor, assetId: string): Promise<Asset> {
    const asset = await this.findAsset(actor, assetId);
    if (asset.status === "READY") {
      return toAsset(asset);
    }
    if (asset.status === "REJECTED") {
      throw new DomainError("ASSET_REJECTED");
    }
    // Storage is read before the transaction: no row lock is held while
    // waiting on the network.
    const problem = await this.verify(asset);
    if (problem !== undefined) {
      await this.reject(asset, problem);
    }
    return this.prisma.$transaction(async (tx) => {
      await lockWritableEvent(tx, actor.workspaceId, asset.eventId);
      const { count } = await tx.asset.updateMany({
        where: { id: asset.id, status: "PENDING" },
        data: { status: "READY", updatedAt: this.clock.now() },
      });
      if (count === 1) {
        await recordAudit(tx, actor, {
          action: "asset.ready",
          targetType: "asset",
          targetId: asset.id,
          eventId: asset.eventId,
          after: {
            kind: asset.kind,
            contentType: asset.contentType,
            sizeBytes: asset.sizeBytes,
          },
        });
      }
      return toAsset(
        await tx.asset.findUniqueOrThrow({
          where: { id: asset.id },
          select: ASSET_SELECT,
        }),
      );
    });
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

  /** @returns why the stored file is not acceptable, or `undefined` */
  private async verify(asset: AssetRow): Promise<string | undefined> {
    const stored = await this.storage.stat(asset.storageKey);
    if (stored === undefined) {
      throw new DomainError("UPLOAD_NOT_FOUND");
    }
    if (
      stored.sizeBytes > HOLDING_SLATE_MAX_BYTES ||
      stored.sizeBytes !== asset.sizeBytes
    ) {
      return "The file size does not match the upload.";
    }
    const detected = detectImageType(
      await this.storage.readStart(asset.storageKey, SIGNATURE_BYTES),
    );
    if (detected !== asset.contentType) {
      return "The file is not the declared JPEG, PNG or WebP image.";
    }
    return undefined;
  }

  /** Marks the asset rejected and deletes the file, which nothing may serve. */
  private async reject(asset: AssetRow, reason: string): Promise<never> {
    await this.prisma.asset.updateMany({
      where: { id: asset.id, status: "PENDING" },
      data: { status: "REJECTED", updatedAt: this.clock.now() },
    });
    await this.storage.remove(asset.storageKey);
    throw new DomainError("ASSET_REJECTED", { detail: reason });
  }

  private async findAsset(actor: Actor, assetId: string): Promise<AssetRow> {
    const row = await this.prisma.asset.findFirst({
      where: { id: assetId, event: { workspaceId: actor.workspaceId } },
      select: ASSET_SELECT,
    });
    if (row === null) {
      throw new DomainError("NOT_FOUND");
    }
    return row;
  }
}
