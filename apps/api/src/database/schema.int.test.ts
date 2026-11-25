import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import type { PrismaClient } from "../generated/prisma/client.js";
import { Prisma } from "../generated/prisma/client.js";
import {
  createTestDatabase,
  diffDatabaseAgainstSchema,
  type TestDatabase,
} from "../testing/database.js";
import { createPrismaClient } from "./prisma.js";

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Prisma's error code for a violated unique constraint. */
const UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_VIOLATION
  );
}

describe("database schema", () => {
  let database: TestDatabase;
  let pool: Pool;
  let prisma: PrismaClient;

  beforeAll(async () => {
    database = await createTestDatabase();
    pool = new Pool({ connectionString: database.url });
    prisma = createPrismaClient(pool);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
    await database.drop();
  });

  let emailCounter = 0;
  const uniqueEmail = () => `person${String((emailCounter += 1))}@example.com`;

  async function createUser(email = uniqueEmail()) {
    return prisma.user.create({
      data: { email, name: "Ada", passwordHash: "not-a-real-hash" },
    });
  }

  // Runs the Prisma CLI in a process of its own: seconds, not milliseconds.
  it(
    "matches schema.prisma exactly after the migrations run",
    { timeout: 15_000 },
    async () => {
      await expect(
        diffDatabaseAgainstSchema(database.url),
      ).resolves.not.toMatch(/CREATE|ALTER|DROP/);
    },
  );

  it("generates time-ordered UUID v7 identifiers in the database", async () => {
    const first = await createUser();
    const second = await createUser();

    expect(first.id).toMatch(UUID_V7);
    expect(second.id > first.id).toBe(true);
  });

  it("treats email addresses that differ only in case as the same", async () => {
    await createUser("Grace.Hopper@Example.com");

    const duplicate = createUser("grace.hopper@example.com");

    await expect(duplicate).rejects.toSatisfy(isUniqueViolation);
    await expect(
      prisma.user.findUnique({ where: { email: "GRACE.HOPPER@example.COM" } }),
    ).resolves.toMatchObject({ email: "Grace.Hopper@Example.com" });
  });

  it("lets a user join a workspace only once", async () => {
    const user = await createUser();
    const workspace = await prisma.workspace.create({ data: { name: "Acme" } });
    const membership = {
      workspaceId: workspace.id,
      userId: user.id,
      role: "OWNER" as const,
    };
    await prisma.membership.create({ data: membership });

    await expect(
      prisma.membership.create({ data: { ...membership, role: "ANALYST" } }),
    ).rejects.toSatisfy(isUniqueViolation);
  });

  it("allows one unanswered invitation per address, and any number of answered ones", async () => {
    const workspace = await prisma.workspace.create({ data: { name: "Acme" } });
    const invitation = (tokenHash: string) => ({
      workspaceId: workspace.id,
      email: "grace@example.com",
      role: "ANALYST" as const,
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const first = await prisma.teamInvitation.create({
      data: invitation("first"),
    });

    await expect(
      prisma.teamInvitation.create({
        data: { ...invitation("second"), email: "GRACE@example.com" },
      }),
    ).rejects.toSatisfy(isUniqueViolation);

    await prisma.teamInvitation.update({
      where: { id: first.id },
      data: { revokedAt: new Date() },
    });
    await expect(
      prisma.teamInvitation.create({ data: invitation("third") }),
    ).resolves.toBeDefined();
  });

  it("removes memberships and sessions with their workspace", async () => {
    const user = await createUser();
    const workspace = await prisma.workspace.create({ data: { name: "Gone" } });
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: user.id, role: "OWNER" },
    });
    await prisma.session.create({
      data: {
        userId: user.id,
        activeWorkspaceId: workspace.id,
        refreshTokenHash: `hash-${user.id}`,
        refreshExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    await prisma.workspace.delete({ where: { id: workspace.id } });

    await expect(
      prisma.membership.count({ where: { workspaceId: workspace.id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.session.count({ where: { activeWorkspaceId: workspace.id } }),
    ).resolves.toBe(0);
  });

  it("applies defaults for a new workspace", async () => {
    const workspace = await prisma.workspace.create({
      data: { name: "Defaults" },
    });

    expect(workspace).toMatchObject({ retentionDays: 90, isDemo: false });
    expect(workspace.createdAt).toBeInstanceOf(Date);
  });
});
