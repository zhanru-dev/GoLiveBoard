import { defineProject } from "vitest/config";

// Resolve workspace packages to their TypeScript source, so tests never need a
// build of @goliveboard/contracts first.
const conditions = ["@goliveboard/source", "node", "development|production"];

export default defineProject({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    environment: "node",
  },
});
