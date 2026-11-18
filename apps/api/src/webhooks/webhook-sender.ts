import { Inject, Injectable } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { PRISMA } from "../database/prisma.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { SafeHttpClient, SafeHttpError } from "../net/safe-http.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { isSuccess, nextAttemptAt } from "./domain/retries.js";
import type { SecretBox } from "./secret-box.js";
import { SECRET_BOX } from "./secret-box.provider.js";
import { signatureHeader } from "./signing.js";
import { describeSpan, inSpan } from "../observability/spans.js";

/** docs/04 section 6.1: success is a 2xx within 10 seconds. */
export const DELIVERY_TIMEOUT_MS = 10_000;
/** Deliveries sent at once by one worker, and taken per round. */
const BATCH = 20;
/**
 * A taken delivery is not taken again for this long: longer than a send
 * can last. If the worker dies mid-send, another sends it after this.
 */
export const CLAIM_LEASE_MS = 60_000;

interface Claimed {
  readonly id: string;
  readonly endpoint_id: string;
  readonly event_id: string;
  readonly event_type: string;
  readonly data: Prisma.JsonObject;
  readonly occurred_at: Date;
  readonly attempts: number;
}

/**
 * Sends the webhook deliveries that are due (FR-RC-2), at least once each:
 * receivers de-duplicate by the webhook's `id`.
 *
 * - Taking a delivery moves its next attempt past the lease, in one
 *   statement that skips rows another worker is taking: two workers never
 *   send the same attempt.
 * - The request is signed with the endpoint's secret (docs/04 section 6.1)
 *   and goes through SafeHttpClient: https, public addresses only, checked
 *   again at every send, no redirect followed.
 * - Each attempt is recorded. A failure is retried on the schedule in
 *   domain/retries.ts; after the fifth the delivery is FAILED.
 */
@Injectable()
export class WebhookSender {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SECRET_BOX) private readonly box: SecretBox | null,
    private readonly http: SafeHttpClient,
    @InjectPinoLogger(WebhookSender.name) private readonly logger: PinoLogger,
  ) {}

  /** @returns how many deliveries it tried */
  async sendDue(): Promise<number> {
    const now = this.clock.now();
    const claimed = await this.prisma.$queryRaw<Claimed[]>`
      UPDATE webhook_deliveries
      SET next_attempt_at = ${new Date(now.getTime() + CLAIM_LEASE_MS)}
      WHERE id IN (
        SELECT delivery.id
        FROM webhook_deliveries AS delivery
        JOIN webhook_endpoints AS endpoint ON endpoint.id = delivery.endpoint_id
        WHERE delivery.status = 'PENDING'
          AND delivery.next_attempt_at <= ${now}
          AND endpoint.active
        ORDER BY delivery.next_attempt_at
        LIMIT ${BATCH}
        FOR UPDATE OF delivery SKIP LOCKED
      )
      RETURNING id, endpoint_id, event_id, event_type, data, occurred_at, attempts`;
    await Promise.all(claimed.map((delivery) => this.send(delivery)));
    return claimed.length;
  }

  private send(delivery: Claimed): Promise<void> {
    return inSpan(
      "webhook.send",
      {
        "opspilot.webhook.delivery_id": delivery.id,
        "opspilot.webhook.endpoint_id": delivery.endpoint_id,
        "opspilot.webhook.event_type": delivery.event_type,
        "opspilot.webhook.attempt": delivery.attempts + 1,
      },
      () => this.attempt(delivery),
    );
  }

  private async attempt(delivery: Claimed): Promise<void> {
    const startedAt = this.clock.now();
    const started = performance.now();
    let statusCode: number | null = null;
    let error: string | null = null;
    try {
      const request = await this.request(delivery);
      const response = await this.http.post(
        request.url,
        request.body,
        request.headers,
        DELIVERY_TIMEOUT_MS,
      );
      statusCode = response.status;
      if (!isSuccess(response.status)) {
        error = `The receiver answered ${String(response.status)}`;
      }
    } catch (failure) {
      error =
        failure instanceof SafeHttpError || failure instanceof DeliveryError
          ? failure.message
          : "The delivery failed";
      if (!(
        failure instanceof SafeHttpError || failure instanceof DeliveryError
      )) {
        this.logger.error(
          { err: failure, deliveryId: delivery.id },
          "Webhook delivery failed",
        );
      }
    }
    describeSpan({
      "opspilot.webhook.status_code": statusCode ?? 0,
      "opspilot.webhook.delivered": error === null,
    });
    await this.record(delivery, {
      attemptedAt: startedAt,
      statusCode,
      durationMs: Math.round(performance.now() - started),
      error,
    });
  }

  /** The signed request, built at the time of sending. */
  private async request(delivery: Claimed) {
    const endpoint = await this.prisma.webhookEndpoint.findUnique({
      where: { id: delivery.endpoint_id },
      select: {
        url: true,
        workspaceId: true,
        secretCiphertext: true,
        secretKeyId: true,
        workspace: { select: { webhooksIncludePersonalData: true } },
      },
    });
    if (endpoint === null) {
      throw new DeliveryError("The endpoint no longer exists");
    }
    if (this.box === null) {
      throw new DeliveryError("Webhooks are not configured (encryption key)");
    }
    let secret: string;
    try {
      secret = this.box.open({
        ciphertext: Buffer.from(endpoint.secretCiphertext),
        keyId: endpoint.secretKeyId,
      });
    } catch {
      throw new DeliveryError(
        "The signing secret cannot be opened with the configured keys",
      );
    }
    const data = await this.withPersonalData(
      delivery,
      endpoint.workspace.webhooksIncludePersonalData,
    );
    const body = JSON.stringify({
      id: delivery.event_id,
      type: delivery.event_type,
      occurredAt: delivery.occurred_at.toISOString(),
      workspaceId: endpoint.workspaceId,
      data,
    });
    const timestamp = Math.floor(this.clock.now().getTime() / 1000);
    return {
      url: endpoint.url,
      body,
      headers: {
        "content-type": "application/json",
        "opspilot-event-id": delivery.event_id,
        "opspilot-event-type": delivery.event_type,
        "opspilot-signature": signatureHeader(secret, timestamp, body),
      },
    };
  }

  /**
   * docs/04 section 6.2: attendee.registered carries the attendee's name
   * and address only if the workspace allows it, read now: never an erased
   * attendee's.
   */
  private async withPersonalData(
    delivery: Claimed,
    allowed: boolean,
  ): Promise<Prisma.JsonObject> {
    const attendeeId = delivery.data.attendeeId;
    if (
      !allowed ||
      delivery.event_type !== "attendee.registered" ||
      typeof attendeeId !== "string"
    ) {
      return delivery.data;
    }
    const attendee = await this.prisma.attendee.findUnique({
      where: { id: attendeeId },
      select: { name: true, email: true, status: true },
    });
    if (attendee === null || attendee.status === "ERASED") {
      return delivery.data;
    }
    return { ...delivery.data, name: attendee.name, email: attendee.email };
  }

  private async record(
    delivery: Claimed,
    attempt: {
      attemptedAt: Date;
      statusCode: number | null;
      durationMs: number;
      error: string | null;
    },
  ): Promise<void> {
    const attempts = delivery.attempts + 1;
    const succeeded = attempt.error === null;
    const next = succeeded
      ? null
      : nextAttemptAt(attempts, attempt.attemptedAt);
    await this.prisma.$transaction(async (tx) => {
      // Gone if its endpoint was deleted meanwhile.
      const { count } = await tx.webhookDelivery.updateMany({
        where: { id: delivery.id, status: "PENDING" },
        data: {
          attempts,
          status: statusAfter(succeeded, next),
          nextAttemptAt: next,
        },
      });
      if (count > 0) {
        await tx.webhookAttempt.create({
          data: { deliveryId: delivery.id, ...attempt },
        });
      }
    });
  }
}

function statusAfter(succeeded: boolean, next: Date | null) {
  if (succeeded) {
    return "SUCCEEDED" as const;
  }
  return next === null ? ("FAILED" as const) : ("PENDING" as const);
}

/** A delivery that could not be sent, in words fit for the Owner. */
class DeliveryError extends Error {}
