import { defineConfig } from "vitest/config";

// One test run for the whole monorepo: each workspace is a Vitest project with
// its own settings, and coverage is collected across all of them.
export default defineConfig({
  test: {
    projects: ["packages/*"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**", "apps/*/src/**"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "**/index.ts"],
      reporter: ["text-summary", "html"],
    },
  },
});
