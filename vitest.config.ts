import { defineConfig } from "vitest/config";

const api = "./apps/api/vitest.config.ts";

// One test run for the whole monorepo. Each workspace is a Vitest project;
// projects ending in "-int" are integration tests, run by `npm run test:int`.
export default defineConfig({
  test: {
    projects: [
      "packages/*",
      "apps/web",
      {
        extends: api,
        test: {
          name: "api",
          root: "./apps/api",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.int.test.ts"],
        },
      },
      {
        extends: api,
        test: {
          name: "api-int",
          root: "./apps/api",
          include: ["src/**/*.int.test.ts"],
          // One PostgreSQL server with a migrated template database for all
          // integration test files (each copies it into a database of its own).
          globalSetup: ["./src/testing/global-setup.ts"],
          // Starting containers takes seconds, and minutes when an image is
          // downloaded for the first time.
          hookTimeout: 180_000,
          // Every file starts API instances (the real-time tests several)
          // against the same PostgreSQL, Valkey and Docker. With a worker
          // per core, a 16-core machine ran at a load of 100+ and timed out
          // tests at random; half the cores keeps the suite steady.
          maxWorkers: "50%",
        },
      },
    ],
    coverage: {
      provider: "v8",
      // Patterns are matched per project (relative to each project's root),
      // so they must not name the workspace folder: "packages/*/src/**"
      // would match nothing.
      include: ["**/src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.d.ts",
        "**/index.ts",
        "**/testing/**",
        "**/generated/**",
      ],
      reporter: ["text-summary", "html"],
      // docs/05 section 6: domain rules keep at least 90% line and branch
      // coverage; elsewhere coverage is reported, not gated.
      thresholds: {
        "**/domain/**": { lines: 90, branches: 90 },
      },
    },
  },
});
