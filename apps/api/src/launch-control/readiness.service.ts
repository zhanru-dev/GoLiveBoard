import { Inject, Injectable } from "@nestjs/common";
import type { Readiness } from "@goliveboard/contracts";

import type { Actor } from "../auth/actor.js";
import { PRISMA } from "../database/prisma.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { DomainError } from "../shared/domain/domain-error.js";
import { assessReadiness } from "./domain/readiness.js";
import { loadReadinessInput } from "./readiness-input.js";

/** FR-LC-2 to FR-LC-4: the readiness score as staff see it. */
@Injectable()
export class ReadinessService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async assess(actor: Actor, eventId: string): Promise<Readiness> {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, workspaceId: actor.workspaceId },
      select: { id: true },
    });
    if (event === null) {
      throw new DomainError("NOT_FOUND");
    }
    const now = this.clock.now();
    const assessment = assessReadiness(
      await loadReadinessInput(this.prisma, eventId, now),
    );
    return { ...assessment, assessedAt: now.toISOString() };
  }
}
