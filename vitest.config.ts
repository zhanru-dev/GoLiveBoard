import { defineConfig } from "vitest/config";

const api = "./apps/api/vitest.config.ts";

// One test run for the whole monorepo. Each workspace is a Vitest project;
// projects ending in "-int" are integration tests, run by `npm run test:int`.
export default defineConfig({
  test: {
    projects: [
      "packages/*",
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
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**", "apps/*/src/**"],
      exclude: ["**/*.test.ts", "**/index.ts", "**/testing/**"],
      reporter: ["text-summary", "html"],
    },
  },
});
