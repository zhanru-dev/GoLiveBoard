import { Inject, Injectable } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { PRISMA } from "../database/prisma.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { SecretBox } from "./secret-box.js";
import { SECRET_BOX } from "./secret-box.provider.js";

/** Endpoints read at a time. */
export interface ResealOutcome {
  readonly resealed: number;
  readonly unreadable: number;
  readonly lost: number;
}
const BATCH = 100;

/**
 * Seals signing secrets again with the current encryption key, after the
 * key was rotated (WEBHOOK_ENCRYPTION_KEY, with the old one as
 * WEBHOOK_ENCRYPTION_KEY_PREVIOUS): the secrets stay the same, so receivers
 * notice nothing, and once none is left under the old key it can be
 * removed. A secret rotated meanwhile is left alone: the update only
 * replaces the exact ciphertext it read. Without a previous key there is
 * nothing to do.
 */
@Injectable()
export class SecretResealer {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(SECRET_BOX) private readonly box: SecretBox | null,
    @InjectPinoLogger(SecretResealer.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Takes the previous key's secrets in ID order, a batch at a time, until
   * none is left: one it cannot open (altered) is skipped and never blocks
   * the rest.
   *
   * @returns how many it sealed again, could not open (altered), and found
   * under neither key (only rotating their secrets helps those)
   */
  async resealStale(): Promise<ResealOutcome> {
    const box = this.box;
    const previousKeyId = box?.previousKeyId;
    if (box === null || previousKeyId === undefined) {
      return { resealed: 0, unreadable: 0, lost: 0 };
    }
    let resealed = 0;
    let unreadable = 0;
    let after: string | undefined;
    for (;;) {
      const stale = await this.prisma.webhookEndpoint.findMany({
        where: {
          secretKeyId: previousKeyId,
          ...(after !== undefined && { id: { gt: after } }),
        },
        select: { id: true, secretCiphertext: true, secretKeyId: true },
        orderBy: { id: "asc" },
        take: BATCH,
      });
      for (const endpoint of stale) {
        const ciphertext = Buffer.from(endpoint.secretCiphertext);
        let secret: string;
        try {
          secret = box.open({ ciphertext, keyId: endpoint.secretKeyId });
        } catch {
          unreadable += 1;
          continue;
        }
        const sealed = box.seal(secret);
        resealed += await this.prisma.$executeRaw`
          UPDATE webhook_endpoints
          SET secret_ciphertext = ${new Uint8Array(sealed.ciphertext)},
              secret_key_id = ${sealed.keyId}
          WHERE id = ${endpoint.id}::uuid
            AND secret_key_id = ${endpoint.secretKeyId}
            AND secret_ciphertext = ${new Uint8Array(ciphertext)}`;
      }
      if (stale.length < BATCH) {
        break;
      }
      after = stale.at(-1)?.id;
    }
    // Sealed with neither key: only rotating their secrets helps.
    const lost = await this.prisma.webhookEndpoint.count({
      where: { secretKeyId: { notIn: [box.currentKeyId, previousKeyId] } },
    });
    if (unreadable > 0 || lost > 0) {
      this.logger.warn(
        { unreadable, lost },
        "Webhook secrets that cannot be sealed again",
      );
    }
    return { resealed, unreadable, lost };
  }
}
