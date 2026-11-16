import { Inject, Injectable } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { PRISMA } from "../database/prisma.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { SecretBox } from "./secret-box.js";
import { SECRET_BOX } from "./secret-box.provider.js";

/** Endpoints sealed again per run; the next run takes the rest. */
const BATCH = 100;

/**
 * Seals signing secrets again with the current encryption key, after the
 * key was rotated (WEBHOOK_ENCRYPTION_KEY, with the old one as
 * WEBHOOK_ENCRYPTION_KEY_PREVIOUS): the secrets stay the same, so receivers
 * notice nothing, and once none is left under the old key it can be
 * removed. A secret rotated meanwhile is left alone: the update only
 * replaces the exact ciphertext it read.
 */
@Injectable()
export class SecretResealer {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(SECRET_BOX) private readonly box: SecretBox | null,
    @InjectPinoLogger(SecretResealer.name) private readonly logger: PinoLogger,
  ) {}

  /** @returns how many it sealed again */
  async resealStale(): Promise<number> {
    const box = this.box;
    if (box === null) {
      return 0;
    }
    const stale = await this.prisma.webhookEndpoint.findMany({
      where: { secretKeyId: { not: box.currentKeyId } },
      select: { id: true, secretCiphertext: true, secretKeyId: true },
      take: BATCH,
    });
    let resealed = 0;
    let unreadable = 0;
    for (const endpoint of stale) {
      const ciphertext = Buffer.from(endpoint.secretCiphertext);
      let secret: string;
      try {
        secret = box.open({ ciphertext, keyId: endpoint.secretKeyId });
      } catch {
        // Sealed with a key no longer configured: only rotating the
        // endpoint's secret helps, which the sender's errors say.
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
    if (unreadable > 0) {
      this.logger.warn(
        { unreadable },
        "Webhook secrets sealed with a key that is not configured",
      );
    }
    return resealed;
  }
}
