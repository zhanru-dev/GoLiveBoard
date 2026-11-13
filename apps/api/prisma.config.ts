import { existsSync } from "node:fs";

import { defineConfig } from "prisma/config";

// The Prisma CLI does not read .env files itself (Prisma 7). Load the
// repository's .env when there is one; variables already set win.
const envFile = new URL("../../.env", import.meta.url);
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // Commands that do not touch the database (`prisma generate`) work without it.
    url: process.env.DATABASE_URL ?? "",
  },
});
