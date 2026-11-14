import { randomBytes } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import {
  eventFilesPrefix,
  UPLOAD_URL_TTL_SECONDS,
  uploadKeyFor,
} from "../assets/assets.service.js";
import { PasswordHasher } from "../auth/password-hasher.js";
import { PRISMA } from "../database/prisma.js";
import { eventSlug } from "../events/domain/slug.js";
import { randomSlugSuffix } from "../events/slug-suffix.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { CLOCK, type Clock } from "../shared/clock.js";
import { ObjectStorage } from "../storage/object-storage.js";
import { DEMO_PEOPLE, DEMO_WORKSPACE } from "./demo-accounts.js";
import { lockDemoWorkspace } from "./demo-workspace.js";
import { demoSeed } from "./domain/demo-seed.js";

/**
 * A deleted event's files are deleted again once every upload link handed
 * out before the reset has expired, with a margin for clocks that differ.
 */
export const PURGE_DELAY_MS = UPLOAD_URL_TTL_SECONDS * 1000 + 5 * 60 * 1000;

/** How many prefixes one sweep empties at most; the next sweep goes on. */
const PURGE_BATCH = 200;

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
    // Nearly always it exists: no hashing, no lock.
    const existing = await this.prisma.workspace.findUnique({
      where: { id: DEMO_WORKSPACE.id },
      select: { id: true },
    });
    if (existing !== null) {
      return;
    }
    // Hashing is slow, so it happens before the lock is taken.
    const passwordHash = await this.unusablePasswordHash();
    await this.prisma.$transaction(
      async (tx) => {
        await lockDemoWorkspace(tx);
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
   * Visitors stay signed in.
   *
   * Once the deletion has committed, every stored file of the deleted events
   * goes too: everything under their storage prefixes, so a slate uploaded
   * while the reset ran is not left behind. An upload link handed out before
   * the reset still works for a few minutes, though, and storage may be
   * down, so the same transaction also records the deleted events' prefixes
   * in `pending_file_purges`: the worker's sweep empties them once every such
   * link has expired, and keeps trying for as long as storage fails
   * (purgeDueFiles).
   *
   * @returns how many events were replaced
   */
  async reset(): Promise<number> {
    const passwordHash = await this.unusablePasswordHash();
    const deletedEventIds = await this.prisma.$transaction(
      async (tx) => {
        await lockDemoWorkspace(tx);
        // Runbooks, policies, checks, incidents and assets go with their
        // events (ON DELETE CASCADE).
        const deleted = await tx.$queryRaw<{ id: string }[]>`
          DELETE FROM events WHERE workspace_id = ${DEMO_WORKSPACE.id}::uuid
          RETURNING id`;
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
        const eventIds = deleted.map(({ id }) => id);
        const notBefore = new Date(this.clock.now().getTime() + PURGE_DELAY_MS);
        await tx.pendingFilePurge.createMany({
          data: eventIds.flatMap((eventId) =>
            filePrefixesOf(eventId).map((prefix) => ({ prefix, notBefore })),
          ),
          skipDuplicates: true,
        });
        return eventIds;
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
    for (const prefix of deletedEventIds.flatMap(filePrefixesOf)) {
      await this.removeAllQuietly(prefix);
    }
    return deletedEventIds.length;
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

  /**
   * Empties every recorded prefix whose upload links have all expired, and
   * forgets it. When storage fails, the sweep stops and logs the failure;
   * what is left stays recorded, and the next sweep tries again, however
   * long storage stays down.
   *
   * @returns how many prefixes were emptied, and whether any are left due
   */
  async purgeDueFiles(): Promise<{ purged: number; failed: boolean }> {
    const due = await this.prisma.pendingFilePurge.findMany({
      where: { notBefore: { lte: this.clock.now() } },
      orderBy: { notBefore: "asc" },
      take: PURGE_BATCH,
      select: { prefix: true },
    });
    let purged = 0;
    for (const { prefix } of due) {
      try {
        await this.removeAll(prefix);
      } catch (error) {
        this.logger.error(
          { err: error, prefix },
          "Could not delete stored files; the next sweep tries again",
        );
        return { purged, failed: true };
      }
      await this.prisma.pendingFilePurge.deleteMany({ where: { prefix } });
      purged += 1;
    }
    return { purged, failed: false };
  }

  private async removeAll(prefix: string): Promise<void> {
    for (const key of await this.storage.listKeys(prefix)) {
      await this.storage.remove(key);
    }
  }

  /**
   * At once, best effort: the recorded purge runs later and retries, while
   * failing the reset here would leave the demo as visitors left it.
   */
  private async removeAllQuietly(prefix: string): Promise<void> {
    try {
      await this.removeAll(prefix);
    } catch (error) {
      this.logger.warn(
        { err: error, prefix },
        "Could not delete the demo's files",
      );
    }
  }
}

/** Where an event's files are: its slates, and whatever was uploaded for them. */
function filePrefixesOf(eventId: string): string[] {
  const prefix = eventFilesPrefix(eventId);
  return [prefix, uploadKeyFor(prefix)];
}
