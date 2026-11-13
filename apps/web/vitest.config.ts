import react from "@vitejs/plugin-react";
import { defineProject } from "vitest/config";

// Resolve @opspilot/contracts to its TypeScript source, so tests need no build.
const conditions = [
  "@opspilot/source",
  "module",
  "browser",
  "development|production",
];

export default defineProject({
  plugins: [react()],
  resolve: { conditions, tsconfigPaths: true },
  test: {
    name: "web",
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/testing/setup.ts"],
  },
});
