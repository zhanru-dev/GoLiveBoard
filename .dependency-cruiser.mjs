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
      name: "contracts-are-portable",
      comment:
        "Contracts run in the browser and on the server, so they may not use Node.js built-ins.",
      severity: "error",
      from: { path: "^packages/contracts/src" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "contracts-depend-only-on-zod",
      comment:
        "Contracts stay small and safe to share: Zod is their only runtime dependency.",
      severity: "error",
      from: { path: "^packages/contracts/src" },
      to: { dependencyTypes: ["npm"], pathNot: "node_modules/zod/" },
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
    exclude: { path: "(^|/)(dist|coverage|\\.next)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["@opspilot/source", "import", "default"],
      extensions: [".ts", ".tsx", ".js", ".mjs"],
    },
  },
};
