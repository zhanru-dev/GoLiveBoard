import { randomBytes } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import type {
  CreateWebhookEndpointRequest,
  UpdateWebhookEndpointRequest,
  WebhookEndpoint,
  WebhookEndpointCreated,
  WebhookSecret,
} from "@goliveboard/contracts";

import { recordAudit } from "../audit/audit.js";
import { auditableUrl } from "../audit/redact.js";
import type { Actor } from "../auth/actor.js";
import { PRISMA } from "../database/prisma.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { SafeHttpClient, SafeHttpError } from "../net/safe-http.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { DomainError } from "../shared/domain/domain-error.js";
import type { SecretBox } from "./secret-box.js";
import { SECRET_BOX } from "./secret-box.provider.js";

const ENDPOINT_SELECT = {
  id: true,
  url: true,
  eventTypes: true,
  description: true,
  active: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.WebhookEndpointSelect;

type EndpointRow = Prisma.WebhookEndpointGetPayload<{
  select: typeof ENDPOINT_SELECT;
}>;

/** Webhook endpoints (FR-RC-2, docs/04 section 3.7): Owners only. */
@Injectable()
export class WebhookEndpointsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SECRET_BOX) private readonly box: SecretBox | null,
    private readonly http: SafeHttpClient,
  ) {}

  async list(actor: Actor): Promise<WebhookEndpoint[]> {
    const rows = await this.prisma.webhookEndpoint.findMany({
      where: { workspaceId: actor.workspaceId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: ENDPOINT_SELECT,
    });
    return rows.map(toWebhookEndpoint);
  }

  /**
   * Creates an endpoint and its signing secret, which is returned this once
   * and stored only sealed.
   *
   * @throws DomainError `VALIDATION_FAILED` when the URL does not resolve to
   * public addresses only; `SERVICE_UNAVAILABLE` without an encryption key
   */
  async create(
    actor: Actor,
    input: CreateWebhookEndpointRequest,
  ): Promise<WebhookEndpointCreated> {
    const box = this.requireBox();
    await this.assertDeliverable(input.url);
    const secret = newSecret();
    const sealed = box.seal(secret);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.webhookEndpoint.create({
        data: {
          workspaceId: actor.workspaceId,
          url: input.url,
          eventTypes: input.eventTypes,
          description: input.description,
          secretCiphertext: new Uint8Array(sealed.ciphertext),
          secretKeyId: sealed.keyId,
        },
        select: ENDPOINT_SELECT,
      });
      await recordAudit(tx, actor, {
        action: "webhook_endpoint.created",
        targetType: "webhook_endpoint",
        targetId: row.id,
        after: auditable(row),
      });
      return { endpoint: toWebhookEndpoint(row), secret };
    });
  }

  /**
   * Applies a change made from `expectedVersion`; of two edits from the
   * same version, one gets `412`.
   *
   * @throws DomainError `NOT_FOUND`, `VERSION_CONFLICT`, `VALIDATION_FAILED`
   */
  async update(
    actor: Actor,
    endpointId: string,
    expectedVersion: number,
    changes: UpdateWebhookEndpointRequest,
  ): Promise<WebhookEndpoint> {
    if (changes.url !== undefined) {
      await this.assertDeliverable(changes.url);
    }
    return this.prisma.$transaction(async (tx) => {
      const before = await this.lockOwn(tx, actor, endpointId);
      const { count } = await tx.webhookEndpoint.updateMany({
        where: {
          id: endpointId,
          workspaceId: actor.workspaceId,
          version: expectedVersion,
        },
        data: {
          ...changes,
          version: { increment: 1 },
          updatedAt: this.clock.now(),
        },
      });
      if (count === 0) {
        throw new DomainError("VERSION_CONFLICT");
      }
      const after = await this.find(tx, actor, endpointId);
      await recordAudit(tx, actor, {
        action: "webhook_endpoint.updated",
        targetType: "webhook_endpoint",
        targetId: endpointId,
        before: auditable(before),
        after: auditable(after),
      });
      return toWebhookEndpoint(after);
    });
  }

  /** @throws DomainError `NOT_FOUND` */
  async remove(actor: Actor, endpointId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // FOR UPDATE: a resend, which holds the endpoint against deletion,
      // waits behind the delete instead of slipping in before it.
      const before = await this.lockOwn(tx, actor, endpointId, "delete");
      // Its deliveries and attempts go with it.
      await tx.webhookEndpoint.delete({ where: { id: endpointId } });
      await recordAudit(tx, actor, {
        action: "webhook_endpoint.deleted",
        targetType: "webhook_endpoint",
        targetId: endpointId,
        before: auditable(before),
      });
    });
  }

  /**
   * Replaces the signing secret; the new one is returned this once.
   * Deliveries signed from now on use it.
   *
   * @throws DomainError `NOT_FOUND`, `SERVICE_UNAVAILABLE`
   */
  async rotateSecret(actor: Actor, endpointId: string): Promise<WebhookSecret> {
    const box = this.requireBox();
    const secret = newSecret();
    const sealed = box.seal(secret);
    await this.prisma.$transaction(async (tx) => {
      await this.lockOwn(tx, actor, endpointId);
      await tx.webhookEndpoint.update({
        where: { id: endpointId },
        data: {
          secretCiphertext: new Uint8Array(sealed.ciphertext),
          secretKeyId: sealed.keyId,
          updatedAt: this.clock.now(),
        },
      });
      // That it changed, never what it is.
      await recordAudit(tx, actor, {
        action: "webhook_endpoint.secret_rotated",
        targetType: "webhook_endpoint",
        targetId: endpointId,
      });
    });
    return { secret };
  }

  private requireBox(): SecretBox {
    if (this.box === null) {
      throw new DomainError("SERVICE_UNAVAILABLE", {
        detail:
          "Webhooks are not configured on this server (WEBHOOK_ENCRYPTION_KEY).",
      });
    }
    return this.box;
  }

  /**
   * Locks the endpoint's row, then reads it: every change does, so a change
   * that waited for a delete finds nothing (`404`), not a vanished row. An
   * edit takes NO KEY UPDATE, so deliveries pointing at it are still written
   * meanwhile; a delete takes the full lock.
   *
   * @throws DomainError `NOT_FOUND`
   */
  private async lockOwn(
    tx: Prisma.TransactionClient,
    actor: Actor,
    endpointId: string,
    purpose: "edit" | "delete" = "edit",
  ): Promise<EndpointRow> {
    if (purpose === "delete") {
      await tx.$queryRaw`
        SELECT id FROM webhook_endpoints
        WHERE id = ${endpointId}::uuid AND workspace_id = ${actor.workspaceId}::uuid
        FOR UPDATE`;
    } else {
      await tx.$queryRaw`
        SELECT id FROM webhook_endpoints
        WHERE id = ${endpointId}::uuid AND workspace_id = ${actor.workspaceId}::uuid
        FOR NO KEY UPDATE`;
    }
    return this.find(tx, actor, endpointId);
  }

  private async find(
    tx: Prisma.TransactionClient,
    actor: Actor,
    endpointId: string,
  ): Promise<EndpointRow> {
    const row = await tx.webhookEndpoint.findFirst({
      where: { id: endpointId, workspaceId: actor.workspaceId },
      select: ENDPOINT_SELECT,
    });
    if (row === null) {
      throw new DomainError("NOT_FOUND");
    }
    return row;
  }

  /** docs/04 section 6.1: targets resolve to public addresses only. */
  private async assertDeliverable(url: string): Promise<void> {
    try {
      await this.http.assertFetchable(url);
    } catch (error) {
      if (!(error instanceof SafeHttpError)) {
        throw error;
      }
      throw new DomainError("VALIDATION_FAILED", {
        errors: [
          {
            path: "url",
            code: error.reason.toLowerCase(),
            message: error.message,
          },
        ],
      });
    }
  }
}

/** `whsec_` and 32 random bytes. */
function newSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

function toWebhookEndpoint(row: EndpointRow): WebhookEndpoint {
  return {
    id: row.id,
    url: row.url,
    eventTypes: row.eventTypes as WebhookEndpoint["eventTypes"],
    description: row.description,
    active: row.active,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** What the audit trail keeps of an endpoint: no secret, no URL query. */
function auditable(row: EndpointRow): Prisma.InputJsonObject {
  return {
    url: auditableUrl(row.url),
    eventTypes: row.eventTypes,
    description: row.description,
    active: row.active,
  };
}
