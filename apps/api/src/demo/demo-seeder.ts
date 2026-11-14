import { randomBytes } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import { uploadKeyFor } from "../assets/assets.service.js";
import { PasswordHasher } from "../auth/password-hasher.js";
import { PRISMA } from "../database/prisma.js";
import { eventSlug } from "../events/domain/slug.js";
import { randomSlugSuffix } from "../events/slug-suffix.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { ObjectStorage } from "../storage/object-storage.js";
import { DEMO_PEOPLE, DEMO_WORKSPACE } from "./demo-accounts.js";
import { demoSeed } from "./domain/demo-seed.js";

/** Seeding and resetting take turns, in every process. */
const DEMO_LOCK_KEY = "demo-workspace";

/** Generous: the reset deletes and writes a few hundred rows at most. */
const TRANSACTION_TIMEOUT_MS = 30_000;

/**
 * Creates the shared demo workspace and restores it to its seed (FR-AUTH-5).
 * Only the demo workspace and its three people are ever touched: every
 * statement is scoped by the demo workspace's ID.
 */
@Injectable()
export class DemoSeeder {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly passwords: PasswordHasher,
    private readonly storage: ObjectStorage,
    @InjectPinoLogger(DemoSeeder.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Creates the demo workspace, its people and its events, unless it exists.
   * Called before every demo sign-in, so a new environment needs no manual
   * step; concurrent calls create it once.
   */
  async ensure(): Promise<void> {
    // Hashing is slow, so it happens before the lock is taken.
    const passwordHash = await this.unusablePasswordHash();
    await this.prisma.$transaction(
      async (tx) => {
        await lockDemo(tx);
        const existing = await tx.workspace.findUnique({
          where: { id: DEMO_WORKSPACE.id },
          select: { id: true },
        });
        if (existing !== null) {
          return;
        }
        await this.restoreAccounts(tx, passwordHash);
        await this.writeEvents(tx);
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
  }

  /**
   * Puts the demo workspace back to its seed: everything visitors created or
   * changed is deleted and the seed events are written again, dated from now.
   * Visitors stay signed in. Files of deleted holding slates are removed
   * afterwards, once the deletion has committed.
   *
   * @returns how many events visitors had left behind
   */
  async reset(): Promise<number> {
    const passwordHash = await this.unusablePasswordHash();
    const { removedEvents, storageKeys } = await this.prisma.$transaction(
      async (tx) => {
        await lockDemo(tx);
        const assets = await tx.asset.findMany({
          where: { event: { workspaceId: DEMO_WORKSPACE.id } },
          select: { storageKey: true },
        });
        // Runbooks, policies, checks, incidents and assets go with their
        // events (ON DELETE CASCADE).
        const { count } = await tx.event.deleteMany({
          where: { workspaceId: DEMO_WORKSPACE.id },
        });
        await tx.teamInvitation.deleteMany({
          where: { workspaceId: DEMO_WORKSPACE.id },
        });
        await tx.auditEntry.deleteMany({
          where: { workspaceId: DEMO_WORKSPACE.id },
        });
        await tx.outboxMessage.deleteMany({
          where: { workspaceId: DEMO_WORKSPACE.id },
        });
        // Stored responses of creates, which would replay deleted events.
        await tx.idempotencyRecord.deleteMany({
          where: { scope: { startsWith: `${DEMO_WORKSPACE.id}:` } },
        });
        await this.restoreAccounts(tx, passwordHash);
        await this.writeEvents(tx);
        return {
          removedEvents: count,
          storageKeys: assets.map(({ storageKey }) => storageKey),
        };
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
    for (const key of storageKeys) {
      await this.removeQuietly(key);
      await this.removeQuietly(uploadKeyFor(key));
    }
    return removedEvents;
  }

  /**
   * The workspace, its three people and their memberships, as seeded. Nobody
   * else belongs to the demo workspace: invitations are Owner-only and the
   * Owner cannot sign in, but any other membership is removed all the same.
   */
  private async restoreAccounts(
    tx: Prisma.TransactionClient,
    passwordHash: string,
  ): Promise<void> {
    await tx.workspace.upsert({
      where: { id: DEMO_WORKSPACE.id },
      create: {
        id: DEMO_WORKSPACE.id,
        name: DEMO_WORKSPACE.name,
        isDemo: true,
      },
      update: { name: DEMO_WORKSPACE.name, isDemo: true },
    });
    const people = Object.values(DEMO_PEOPLE);
    for (const person of people) {
      await tx.user.upsert({
        where: { id: person.id },
        create: {
          id: person.id,
          email: person.email,
          name: person.name,
          passwordHash,
        },
        update: { email: person.email, name: person.name, disabledAt: null },
      });
      await tx.membership.upsert({
        where: {
          workspaceId_userId: {
            workspaceId: DEMO_WORKSPACE.id,
            userId: person.id,
          },
        },
        create: {
          workspaceId: DEMO_WORKSPACE.id,
          userId: person.id,
          role: person.role,
        },
        update: { role: person.role },
      });
    }
    await tx.membership.deleteMany({
      where: {
        workspaceId: DEMO_WORKSPACE.id,
        userId: { notIn: people.map(({ id }) => id) },
      },
    });
  }

  private async writeEvents(tx: Prisma.TransactionClient): Promise<void> {
    const userId = (key: keyof typeof DEMO_PEOPLE | null) =>
      key === null ? null : DEMO_PEOPLE[key].id;
    for (const event of demoSeed(this.clock.now())) {
      await tx.event.create({
        data: {
          workspaceId: DEMO_WORKSPACE.id,
          slug: eventSlug(event.title, randomSlugSuffix()),
          title: event.title,
          description: event.description,
          status: event.status,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          timeZone: event.timeZone,
          ownerUserId: userId(event.owner),
          expectedAttendance: event.expectedAttendance,
          runbookTasks: {
            create: event.tasks.map((task, index) => ({
              title: task.title,
              isCritical: task.isCritical,
              status: task.completedBy === null ? "TODO" : "DONE",
              position: index + 1,
              ownerUserId: userId(task.owner),
              dueAt: task.dueAt,
              completedAt: task.completedAt,
              completedById: userId(task.completedBy),
            })),
          },
          accessPolicy:
            event.accessPolicy === null
              ? undefined
              : {
                  create: {
                    mode: event.accessPolicy.mode,
                    allowedDomains: [...event.accessPolicy.allowedDomains],
                    privacyNoticeVersion:
                      event.accessPolicy.privacyNoticeVersion,
                  },
                },
        },
      });
    }
  }

  /**
   * A real Argon2 hash of a random secret that is thrown away: the demo
   * people have no password anyone knows, so a password sign-in to them
   * fails like any wrong password, and visitors use the demo sign-in only.
   */
  private async unusablePasswordHash(): Promise<string> {
    return this.passwords.hash(randomBytes(32).toString("base64url"));
  }

  private async removeQuietly(key: string): Promise<void> {
    try {
      await this.storage.remove(key);
    } catch (error) {
      this.logger.warn({ err: error, key }, "Could not delete a demo file");
    }
  }
}

async function lockDemo(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${DEMO_LOCK_KEY}, 0))`;
}
