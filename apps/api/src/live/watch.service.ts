import { Inject, Injectable } from "@nestjs/common";
import {
  type RealtimeFailure,
  type WatchInfo,
  WatchHeartbeat,
} from "@opspilot/contracts";

import { AssetsService } from "../assets/assets.service.js";
import { publicStatusOf } from "../attendees/domain/admission.js";
import { PRISMA } from "../database/prisma.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { Participants } from "./participants.js";
import type { Sender } from "./chat.service.js";

const failure = (error: RealtimeFailure["error"]): RealtimeFailure => ({
  ok: false,
  error,
});

/** The watch page (FR-RN-1) and the attendance it records (FR-RN-7). */
@Injectable()
export class WatchService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly participants: Participants,
    private readonly assets: AssetsService,
  ) {}

  /** For an attendee the event admits (AttendeeGuard decided). */
  async info(eventId: string): Promise<WatchInfo> {
    const event = await this.prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { slug: true, title: true, status: true, streamUrl: true },
    });
    return {
      slug: event.slug,
      title: event.title,
      status: publicStatusOf(event.status),
      streamUrl: event.status === "LIVE" ? event.streamUrl : null,
      slate: await this.assets.slateLinkFor(eventId),
    };
  }

  /**
   * Records that an attendee watched during this minute. Several heartbeats
   * in one minute, from any number of tabs, make one row.
   */
  async heartbeat(
    sender: Sender,
    payload: unknown,
  ): Promise<{ ok: true } | RealtimeFailure> {
    const parsed = WatchHeartbeat.safeParse(payload);
    if (!parsed.success) {
      return failure("INVALID");
    }
    const access = await this.participants.authorize(
      sender.identity,
      { slug: parsed.data.slug },
      sender.connectionId,
    );
    if (!access.ok) {
      return failure(access.error);
    }
    const { participant } = access;
    if (participant.attendeeId === undefined) {
      // Staff watch to run the event; the audience is attendees.
      return { ok: true };
    }
    if (participant.status !== "LIVE") {
      return failure("CLOSED");
    }
    const now = this.clock.now();
    const minute = new Date(now.getTime() - (now.getTime() % 60_000));
    await this.prisma.$executeRaw`
      INSERT INTO attendance_minutes (event_id, attendee_id, minute)
      VALUES (${participant.eventId}::uuid, ${participant.attendeeId}::uuid, ${minute})
      ON CONFLICT DO NOTHING`;
    return { ok: true };
  }
}
