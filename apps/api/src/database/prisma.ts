import { PrismaPg } from "@prisma/adapter-pg";
import type { Pool } from "pg";

import { PrismaClient } from "../generated/prisma/client.js";

/** Injection token for the Prisma client. */
export const PRISMA = Symbol("PRISMA");

/**
 * Creates the Prisma client on top of the process's connection pool, so Prisma
 * queries and raw SQL share one set of connections, one set of timeouts and
 * one health check.
 */
export function createPrismaClient(pool: Pool): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}
