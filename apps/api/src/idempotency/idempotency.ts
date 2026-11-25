import {
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import type { Prisma } from "../generated/prisma/client.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { DomainError } from "../shared/domain/domain-error.js";
import { hashRequestBody } from "./request-hash.js";

/** docs/04 section 2: keys expire after 24 hours. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const IdempotencyKeyHeader = z.uuid();

/**
 * Injects the `Idempotency-Key` header, or `undefined` when the client sent
 * none. A key that is not a UUID is a validation error, because a malformed
 * key would silently stop protecting the client's retries.
 */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined => {
    const value = context
      .switchToHttp()
      .getRequest<Request>()
      .get("idempotency-key");
    if (value === undefined) {
      return undefined;
    }
    const result = IdempotencyKeyHeader.safeParse(value);
    if (!result.success) {
      throw new DomainError("VALIDATION_FAILED", {
        errors: [
          {
            path: "Idempotency-Key",
            code: "invalid_format",
            message: "The Idempotency-Key header must be a UUID.",
          },
        ],
      });
    }
    return result.data.toLowerCase();
  },
);

export interface IdempotentRequest {
  /**
   * Who and what the key belongs to. Including the user means a key can never
   * replay someone else's response.
   */
  readonly scope: string;
  readonly key: string;
  /** The validated body, compared on retries. */
  readonly body: unknown;
}

export interface StoredResponse {
  readonly status: number;
  readonly body: Prisma.InputJsonValue;
}

export interface IdempotentOutcome {
  readonly status: number;
  /** Either the new response or, on a retry, the stored one. */
  readonly body: unknown;
  readonly replayed: boolean;
}

/**
 * Makes a create safe to retry (NFR-5). Must run inside the transaction that
 * performs the create, so the stored response commits with the change.
 */
@Injectable()
export class Idempotency {
  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  /**
   * Runs `work` once per key. Two requests with the same key at the same
   * moment are serialised by a transaction-scoped advisory lock on the key:
   * the second waits until the first commits, then finds its stored response
   * and returns that instead of creating a second record.
   *
   * @throws DomainError `IDEMPOTENCY_KEY_REUSED` when the key was used with a
   * different body in the last 24 hours
   */
  async run(
    tx: Prisma.TransactionClient,
    request: IdempotentRequest,
    work: () => Promise<StoredResponse>,
  ): Promise<IdempotentOutcome> {
    const lockKey = `idempotency:${request.scope}:${request.key}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

    const now = this.clock.now();
    const requestHash = hashRequestBody(request.body);
    const where = { scope_key: { scope: request.scope, key: request.key } };
    const existing = await tx.idempotencyRecord.findUnique({ where });
    if (existing !== null && existing.expiresAt > now) {
      if (existing.requestHash !== requestHash) {
        throw new DomainError("IDEMPOTENCY_KEY_REUSED");
      }
      return {
        status: existing.responseStatus,
        body: existing.responseBody,
        replayed: true,
      };
    }

    const response = await work();
    const record = {
      requestHash,
      responseStatus: response.status,
      responseBody: response.body,
      expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
    };
    // An expired record for the key may still exist until the retention job
    // deletes it; the key is free again, so it is overwritten.
    await tx.idempotencyRecord.upsert({
      where,
      create: { scope: request.scope, key: request.key, ...record },
      update: { ...record, createdAt: now },
    });
    return { ...response, replayed: false };
  }
}
