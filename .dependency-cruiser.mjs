/**
 * Architecture rules, checked in CI (docs/05-engineering-standards.md §2).
 * Each rule says what it protects; a violation fails the build.
 * @type {import("dependency-cruiser").IConfiguration}
 */
export default {
  forbidden: [
    {
      name: "no-circular",
      comment:
        "Circular imports make load order fragile and modules hard to reason about.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "not-to-unresolvable",
      comment: "Every import must resolve to a real file or installed package.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "contracts-import-only-zod",
      comment:
        "Contracts are shared by every app and run in the browser too, so they import only each other and Zod: no Node.js built-ins, frameworks or app code.",
      severity: "error",
      from: { path: "^packages/contracts/src/", pathNot: "\\.test\\.ts$" },
      to: { pathNot: ["^packages/contracts/src/", "node_modules/zod/"] },
    },
    {
      name: "no-undeclared-dependencies",
      comment:
        "Every package a workspace imports is listed in that workspace's package.json, so it does not depend on what npm happens to hoist.",
      severity: "error",
      from: {},
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
    },
    {
      name: "no-dev-dependencies-in-production",
      comment:
        "Code that ships never imports a devDependency: production installs leave them out.",
      severity: "error",
      from: {
        path: "^(apps|packages)/[^/]+/src/",
        pathNot: "\\.test\\.ts$|/testing/",
      },
      to: { dependencyTypes: ["npm-dev"], dependencyTypesNot: ["type-only"] },
    },
    {
      name: "web-does-not-import-api",
      comment:
        "The web app talks to the API over HTTP only; shared shapes live in packages/contracts.",
      severity: "error",
      from: { path: "^apps/web" },
      to: { path: "^apps/api" },
    },
    {
      name: "api-does-not-import-web",
      severity: "error",
      from: { path: "^apps/api" },
      to: { path: "^apps/web" },
    },
    {
      name: "no-test-code-in-production",
      comment:
        "Test helpers and test files are never imported by code that ships.",
      severity: "error",
      from: { pathNot: "\\.test\\.ts$|/testing/" },
      to: { path: "\\.test\\.ts$|/testing/" },
    },
    {
      name: "domain-is-pure",
      comment:
        "Domain code holds business rules only: no framework, database or I/O, so it can be unit-tested exhaustively.",
      severity: "error",
      from: { path: "/domain/", pathNot: "\\.test\\.ts$" },
      to: {
        pathNot: ["/domain/", "^packages/contracts/", "node_modules/zod/"],
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // Build output, and next-env.d.ts, which Next.js generates.
    exclude: {
      path: "(^|/)(dist|coverage|\\.next|generated)/|next-env\\.d\\.ts$",
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["@opspilot/source", "import", "default"],
      extensions: [".ts", ".tsx", ".js", ".mjs"],
    },
  },
};
