import { Inject, Injectable } from "@nestjs/common";
import type {
  EventStatus,
  PublicEvent,
  PublicEventStatus,
  RegistrationRequest,
} from "@opspilot/contracts";

import { generateToken, hashToken } from "../auth/tokens.js";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { PRISMA } from "../database/prisma.js";
import {
  demoHasRoomForAttendee,
  isDemoWorkspace,
} from "../demo/demo-workspace.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { RATE_LIMITS, RateLimiter } from "../rate-limit/rate-limiter.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { DomainError } from "../shared/domain/domain-error.js";
import { signInLinkEmail, verificationEmail } from "./attendee-emails.js";
import { AttendeeMail } from "./attendee-mail.js";
import {
  admitsAttendance,
  admitsRegistration,
  isPublic,
  isRegistrationOpen,
} from "./domain/admission.js";
import {
  attendeeSessionExpiresAt,
  VERIFICATION_TTL_MS,
} from "./domain/privacy.js";
import { hasLiveInvitation } from "./invitation.queries.js";

const PUBLIC_STATUS: Readonly<Record<EventStatus, PublicEventStatus>> = {
  DRAFT: "UPCOMING",
  CONFIGURING: "UPCOMING",
  READY: "UPCOMING",
  LIVE: "LIVE",
  COMPLETED: "ENDED",
  ARCHIVED: "ENDED",
  CANCELLED: "CANCELLED",
};

const PUBLIC_EVENT_SELECT = {
  id: true,
  workspaceId: true,
  slug: true,
  title: true,
  description: true,
  startsAt: true,
  endsAt: true,
  timeZone: true,
  status: true,
  accessPolicy: {
    select: { mode: true, allowedDomains: true, privacyNoticeVersion: true },
  },
  workspace: { select: { retentionDays: true } },
} as const satisfies Prisma.EventSelect;

type PublicEventRow = Prisma.EventGetPayload<{
  select: typeof PUBLIC_EVENT_SELECT;
}>;

/** A new attendee session: the token for the cookie, and when it ends. */
export interface AttendeeSessionGrant {
  readonly slug: string;
  readonly token: string;
  readonly expiresAt: Date;
}

/**
 * The public side of admission (FR-AD-1 to FR-AD-3): the event page's data,
 * registration and verification.
 */
@Injectable()
export class RegistrationService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly rateLimiter: RateLimiter,
    private readonly mail: AttendeeMail,
  ) {}

  /**
   * @throws DomainError `NOT_FOUND` for a draft, an archived event or a slug
   * that does not exist: they look the same
   */
  async publicEvent(slug: string): Promise<PublicEvent> {
    return toPublicEvent(await this.findPublic(this.prisma, slug));
  }

  /**
   * Registers an address for the event, or does nothing, and answers the
   * same either way (FR-AD-3): whether the address is eligible, new,
   * pending, verified or revoked is never revealed to the requester. Only
   * the mailbox learns anything: a pending or new attendee gets a
   * verification link, a verified one a link to sign in.
   *
   * @param demoInboxKey this browser's demo inbox key; called only for an
   * event of the demo workspace, whose mail goes to that inbox
   * @throws DomainError `NOT_FOUND` (no such public event),
   * `VALIDATION_FAILED` (the privacy notice changed since the form was
   * shown), `RATE_LIMITED`
   */
  async register(
    slug: string,
    input: RegistrationRequest,
    ip: string,
    demoInboxKey: () => string,
  ): Promise<void> {
    await this.rateLimiter.consumeOrThrow(RATE_LIMITS.registrationsPerIp, ip);
    const event = await this.findPublic(this.prisma, slug);
    const notice = event.accessPolicy?.privacyNoticeVersion;
    if (notice !== undefined && input.privacyNoticeVersion !== notice) {
      throw new DomainError("VALIDATION_FAILED", {
        errors: [
          {
            path: "privacyNoticeVersion",
            code: "notice_changed",
            message:
              "The privacy notice has changed. Reload the page and read it again.",
          },
        ],
      });
    }
    const demoInboxKeyHash = isDemoWorkspace(event.workspaceId)
      ? hashToken(demoInboxKey())
      : null;
    const send = await this.prisma.$transaction(async (tx) =>
      this.registerIn(tx, event, input, demoInboxKeyHash),
    );
    send();
  }

  private async registerIn(
    tx: Prisma.TransactionClient,
    event: PublicEventRow,
    input: RegistrationRequest,
    demoInboxKeyHash: string | null,
  ): Promise<() => void> {
    const nothing = () => undefined;
    const admission = admitsRegistration({
      eventStatus: event.status,
      policy: event.accessPolicy,
      email: input.email,
      invited: await hasLiveInvitation(tx, event.id, input.email),
    });
    if (!admission.admitted) {
      return nothing;
    }
    const now = this.clock.now();
    // Two registrations of one address at once: one inserts, the other
    // finds that row, and the lock makes them take turns.
    const [existing] = await tx.$queryRaw<{ id: string; status: string }[]>`
      SELECT id, status::text AS status FROM attendees
      WHERE event_id = ${event.id}::uuid AND email = ${input.email}::citext
      FOR UPDATE`;
    let attendeeId: string;
    let alreadyVerified = false;
    if (existing === undefined) {
      if (!(await demoHasRoomForAttendee(tx, event.workspaceId))) {
        return nothing;
      }
      const inserted = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO attendees
          (event_id, email, name, consent_notice_version, consented_at,
           reminders_opt_in, demo_inbox_key_hash)
        VALUES (${event.id}::uuid, ${input.email}::citext, ${input.name},
                ${input.privacyNoticeVersion}, ${now},
                ${input.remindersOptIn}, ${demoInboxKeyHash})
        ON CONFLICT (event_id, email) DO NOTHING
        RETURNING id`;
      if (inserted[0] === undefined) {
        // Another registration inserted it a moment ago: answer as if this
        // one had arrived first. Its own email is on the way.
        return nothing;
      }
      attendeeId = inserted[0].id;
    } else if (existing.status === "PENDING") {
      attendeeId = existing.id;
      await tx.attendee.update({
        where: { id: attendeeId },
        data: {
          name: input.name,
          consentNoticeVersion: input.privacyNoticeVersion,
          consentedAt: now,
          remindersOptIn: input.remindersOptIn,
          demoInboxKeyHash,
          updatedAt: now,
        },
      });
      // Only the newest link works.
      await tx.attendeeVerificationToken.deleteMany({
        where: { attendeeId, usedAt: null },
      });
    } else if (existing.status === "VERIFIED") {
      attendeeId = existing.id;
      alreadyVerified = true;
      // A verified attendee's data stays as they confirmed it; the inbox
      // follows the browser asking, which is where the link is wanted.
      await tx.attendee.update({
        where: { id: attendeeId },
        data: { demoInboxKeyHash, updatedAt: now },
      });
    } else {
      // Revoked: nothing. (An erased attendee's address is gone, so a new
      // registration never finds their row.)
      return nothing;
    }
    const token = generateToken();
    await tx.attendeeVerificationToken.create({
      data: {
        attendeeId,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + VERIFICATION_TTL_MS),
      },
    });
    const origin = this.config.app.origin;
    return this.mail.prepare(
      tx,
      { attendeeId, workspaceId: event.workspaceId, demoInboxKeyHash },
      alreadyVerified
        ? signInLinkEmail(input.email, event, token, origin)
        : verificationEmail(input.email, event, token, origin),
    );
  }

  /**
   * Uses a verification link: once, within 15 minutes. Verifies the address
   * if it was pending and starts an attendee session, provided the event
   * still admits the attendee under its current policy.
   *
   * @throws DomainError `TOKEN_INVALID` (unknown, used or expired, or the
   * attendee was revoked or erased meanwhile), `FORBIDDEN` (the event no
   * longer admits them), `RATE_LIMITED`
   */
  async verify(token: string, ip: string): Promise<AttendeeSessionGrant> {
    await this.rateLimiter.consumeOrThrow(
      RATE_LIMITS.attendeeVerificationsPerIp,
      ip,
    );
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      // The attendee first, then the link: the order of every other path
      // that touches both (registering again, revoking, erasing). The other
      // way round, using a link while a Manager revokes its attendee
      // deadlocked.
      const [link] = await tx.$queryRaw<{ attendee_id: string }[]>`
        SELECT attendee_id FROM attendee_verification_tokens
        WHERE token_hash = ${hashToken(token)}`;
      if (link === undefined) {
        throw new DomainError("TOKEN_INVALID");
      }
      const [attendee] = await tx.$queryRaw<
        { id: string; status: string; email: string; event_id: string }[]
      >`
        SELECT id, status::text AS status, email::text AS email, event_id
        FROM attendees WHERE id = ${link.attendee_id}::uuid
        FOR UPDATE`;
      // Spent in the statement that checks it: of two requests with the
      // same link, exactly one gets a row back.
      const [used] = await tx.$queryRaw<{ id: string }[]>`
        UPDATE attendee_verification_tokens SET used_at = ${now}
        WHERE token_hash = ${hashToken(token)} AND used_at IS NULL
          AND expires_at > ${now}
        RETURNING id`;
      if (
        used === undefined ||
        attendee === undefined ||
        (attendee.status !== "PENDING" && attendee.status !== "VERIFIED")
      ) {
        throw new DomainError("TOKEN_INVALID");
      }
      const event = await tx.event.findUniqueOrThrow({
        where: { id: attendee.event_id },
        select: PUBLIC_EVENT_SELECT,
      });
      const admission = admitsAttendance({
        attendeeStatus: "VERIFIED",
        eventStatus: event.status,
        policy: event.accessPolicy,
        email: attendee.email,
        invited: await hasLiveInvitation(tx, event.id, attendee.email),
      });
      if (!admission.admitted) {
        throw new DomainError("FORBIDDEN", {
          detail: "This event no longer admits you.",
        });
      }
      if (attendee.status === "PENDING") {
        await tx.attendee.update({
          where: { id: attendee.id },
          data: { status: "VERIFIED", verifiedAt: now, updatedAt: now },
        });
      }
      const sessionToken = generateToken();
      const expiresAt = attendeeSessionExpiresAt(event.endsAt, now);
      await tx.attendeeSession.create({
        data: {
          attendeeId: attendee.id,
          tokenHash: hashToken(sessionToken),
          expiresAt,
        },
      });
      return { slug: event.slug, token: sessionToken, expiresAt };
    });
  }

  private async findPublic(
    client: Prisma.TransactionClient,
    slug: string,
  ): Promise<PublicEventRow> {
    const event = await client.event.findUnique({
      where: { slug },
      select: PUBLIC_EVENT_SELECT,
    });
    if (event === null || !isPublic(event.status)) {
      throw new DomainError("NOT_FOUND");
    }
    return event;
  }
}

function toPublicEvent(event: PublicEventRow): PublicEvent {
  const policy = event.accessPolicy;
  const open = policy !== null && isRegistrationOpen(event.status);
  return {
    slug: event.slug,
    title: event.title,
    description: event.description,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    timeZone: event.timeZone,
    status: PUBLIC_STATUS[event.status],
    registration: {
      open,
      mode: open ? policy.mode : null,
      allowedDomains:
        open && policy.mode === "EMAIL_DOMAIN"
          ? [...policy.allowedDomains]
          : [],
      privacyNoticeVersion: open ? policy.privacyNoticeVersion : null,
      retentionDays: event.workspace.retentionDays,
    },
  };
}
