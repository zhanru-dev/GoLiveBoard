import { defineProject } from "vitest/config";

// Resolve workspace packages to their TypeScript source, so tests never need a
// build of @opspilot/contracts first.
const conditions = [
  "@opspilot/source",
  "module",
  "node",
  "development|production",
];

export default defineProject({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    environment: "node",
  },
});
