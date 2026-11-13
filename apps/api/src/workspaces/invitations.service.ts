import { Inject, Injectable } from "@nestjs/common";
import type {
  AcceptInvitationRequest,
  CreateInvitationRequest,
  Invitation,
  InvitationPreview,
} from "@opspilot/contracts";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import type { Actor } from "../auth/actor.js";
import { invitationEmail } from "../auth/emails.js";
import { PasswordHasher } from "../auth/password-hasher.js";
import { generateToken, hashToken } from "../auth/tokens.js";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { PRISMA } from "../database/prisma.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { Mailer } from "../mail/mailer.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { DomainError } from "../shared/domain/domain-error.js";

/** FR-WS-2: an invitation link is valid for 7 days. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class InvitationsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly mailer: Mailer,
    private readonly passwords: PasswordHasher,
    @InjectPinoLogger(InvitationsService.name)
    private readonly logger: PinoLogger,
  ) {}

  /** Open invitations: not accepted, not revoked, not expired. */
  async list(actor: Actor): Promise<Invitation[]> {
    const invitations = await this.prisma.teamInvitation.findMany({
      where: this.openWhere(actor.workspaceId),
      orderBy: { createdAt: "desc" },
    });
    return invitations.map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    }));
  }

  /**
   * Sends a new link. A previous open invitation for the same address is
   * revoked, so only the newest link works. Two of these for the same address
   * at once are serialised by a transaction-scoped advisory lock on the
   * workspace and address: the second waits, then revokes the first one's
   * invitation. A partial unique index backs this up in the database.
   */
  async create(
    actor: Actor,
    input: CreateInvitationRequest,
  ): Promise<Invitation> {
    const alreadyMember = await this.prisma.membership.findFirst({
      where: { workspaceId: actor.workspaceId, user: { email: input.email } },
      select: { id: true },
    });
    if (alreadyMember !== null) {
      throw new DomainError("MEMBERSHIP_EXISTS");
    }
    const now = this.clock.now();
    const token = generateToken();
    const invitation = await this.prisma.$transaction(async (tx) => {
      const lockKey = `team-invitation:${actor.workspaceId}:${input.email.toLowerCase()}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      // Expired ones too: the unique index covers every unanswered invitation.
      await tx.teamInvitation.updateMany({
        where: {
          workspaceId: actor.workspaceId,
          email: input.email,
          acceptedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
      return tx.teamInvitation.create({
        data: {
          workspaceId: actor.workspaceId,
          email: input.email,
          role: input.role,
          tokenHash: hashToken(token),
          invitedById: actor.userId,
          expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        },
        include: {
          workspace: { select: { name: true } },
          invitedBy: { select: { name: true } },
        },
      });
    });
    this.mailer
      .send(
        invitationEmail({
          to: invitation.email,
          workspaceName: invitation.workspace.name,
          inviterName: invitation.invitedBy?.name ?? "A colleague",
          role: invitation.role,
          token,
          appOrigin: this.config.app.origin,
        }),
      )
      .catch((error: unknown) => {
        this.logger.error({ err: error }, "Sending invitation email failed");
      });
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    };
  }

  async revoke(actor: Actor, invitationId: string): Promise<void> {
    const { count } = await this.prisma.teamInvitation.updateMany({
      where: { id: invitationId, ...this.openWhere(actor.workspaceId) },
      data: { revokedAt: this.clock.now() },
    });
    if (count === 0) {
      throw new DomainError("NOT_FOUND");
    }
  }

  /** What the accept page shows; the token itself proves the link was received. */
  async preview(token: string): Promise<InvitationPreview> {
    const invitation = await this.findOpenByToken(token);
    const account = await this.prisma.user.findUnique({
      where: { email: invitation.email },
      select: { id: true },
    });
    return {
      workspaceName: invitation.workspace.name,
      email: invitation.email,
      role: invitation.role,
      accountExists: account !== null,
    };
  }

  /**
   * FR-WS-2: creates the user if needed, then the membership. The invitation
   * is marked accepted by a conditional update inside the same transaction,
   * so a link works exactly once even under concurrent requests.
   */
  async accept(input: AcceptInvitationRequest): Promise<void> {
    const invitation = await this.findOpenByToken(input.token);
    const existing = await this.prisma.user.findUnique({
      where: { email: invitation.email },
      select: { id: true },
    });
    const account = existing ?? (await this.newAccountFrom(input));
    const now = this.clock.now();

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.teamInvitation.updateMany({
        where: {
          id: invitation.id,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { acceptedAt: now },
      });
      if (count === 0) {
        throw new DomainError("TOKEN_INVALID");
      }
      const userId =
        "id" in account
          ? account.id
          : (
              await tx.user.create({
                data: { email: invitation.email, ...account },
                select: { id: true },
              })
            ).id;
      await tx.membership.upsert({
        where: {
          workspaceId_userId: { workspaceId: invitation.workspaceId, userId },
        },
        create: {
          workspaceId: invitation.workspaceId,
          userId,
          role: invitation.role,
        },
        update: {},
      });
    });
  }

  /** A new invitee must choose a name and a password. */
  private async newAccountFrom(
    input: AcceptInvitationRequest,
  ): Promise<{ name: string; passwordHash: string }> {
    if (input.name === undefined || input.password === undefined) {
      throw new DomainError("VALIDATION_FAILED", {
        detail: "Choose a name and a password to create your account.",
      });
    }
    return {
      name: input.name,
      passwordHash: await this.passwords.hash(input.password),
    };
  }

  private openWhere(workspaceId: string) {
    return {
      workspaceId,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: this.clock.now() },
    };
  }

  private async findOpenByToken(token: string) {
    const invitation = await this.prisma.teamInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { workspace: { select: { name: true } } },
    });
    if (invitation === null) {
      throw new DomainError("TOKEN_INVALID");
    }
    const usable =
      invitation.acceptedAt === null &&
      invitation.revokedAt === null &&
      invitation.expiresAt > this.clock.now();
    if (!usable) {
      throw new DomainError("TOKEN_INVALID");
    }
    return invitation;
  }
}
