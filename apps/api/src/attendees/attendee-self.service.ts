import { Inject, Injectable } from "@nestjs/common";
import type { AttendeeMe, DemoInbox } from "@goliveboard/contracts";

import { hashToken } from "../auth/tokens.js";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { PRISMA } from "../database/prisma.js";
import { RealtimeSignals } from "../live/realtime-signals.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { DomainError } from "../shared/domain/domain-error.js";
import type { AttendeeActor } from "./attendee.guard.js";
import { attendeeOfUnsubscribeToken } from "./unsubscribe-token.js";

/** How many demo inbox messages are listed: the newest. */
const DEMO_INBOX_LIMIT = 50;

/** What an attendee can see and change about themselves. */
@Injectable()
export class AttendeeSelfService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly signals: RealtimeSignals,
  ) {}

  async me(attendee: AttendeeActor): Promise<AttendeeMe> {
    const row = await this.prisma.attendee.findUniqueOrThrow({
      where: { id: attendee.attendeeId },
      select: { name: true, remindersOptIn: true },
    });
    return { slug: attendee.slug, ...row };
  }

  /** Signs this browser out: the session stops working at once. */
  async signOut(attendee: AttendeeActor): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.attendeeSession.deleteMany({
        where: { id: attendee.sessionId },
      });
      await this.signals.recheck(tx, "attendee-session", [attendee.sessionId]);
    });
  }

  /**
   * Stops reminders for the attendee the token names (FR-AD-5). Doing it
   * twice, or for an attendee since erased, changes nothing and succeeds.
   *
   * @throws DomainError `TOKEN_INVALID` when the token is not genuine
   */
  async unsubscribe(token: string): Promise<void> {
    // Links signed before the server secret was rotated keep working.
    const attendeeId = [
      this.config.auth.jwtSecret,
      this.config.auth.jwtPreviousSecret,
    ]
      .filter((secret) => secret !== undefined)
      .map((secret) => attendeeOfUnsubscribeToken(secret, token))
      .find((id) => id !== undefined);
    if (attendeeId === undefined) {
      throw new DomainError("TOKEN_INVALID");
    }
    await this.prisma.attendee.updateMany({
      where: { id: attendeeId, remindersOptIn: true },
      data: { remindersOptIn: false, updatedAt: this.clock.now() },
    });
  }

  /**
   * The demo inbox of the browser holding `key` (FR-AUTH-5): only messages
   * written for that browser. Demo mode only.
   *
   * @throws DomainError `NOT_FOUND` with demo mode off
   */
  async demoInbox(key: string | undefined): Promise<DemoInbox> {
    if (!this.config.demo.enabled) {
      throw new DomainError("NOT_FOUND");
    }
    if (key === undefined) {
      return { messages: [] };
    }
    const messages = await this.prisma.demoInboxMessage.findMany({
      where: { inboxKeyHash: hashToken(key) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: DEMO_INBOX_LIMIT,
      select: { id: true, subject: true, text: true, createdAt: true },
    });
    return {
      messages: messages.map((message) => ({
        id: message.id,
        subject: message.subject,
        text: message.text,
        receivedAt: message.createdAt.toISOString(),
      })),
    };
  }
}
