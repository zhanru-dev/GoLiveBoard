import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

// The repository's .env holds settings shared with the API, such as the
// storage endpoint the Content Security Policy must allow. Variables that
// are already set (CI, production) win.
const envFile = new URL("../../.env", import.meta.url);
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

/**
 * Sent with every page. The Content Security Policy is set per request in
 * src/proxy.ts, because it carries a fresh nonce each time.
 */
export const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  // The header only advertises the framework to attackers.
  poweredByHeader: false,
  // The production image runs the standalone server, which carries only the
  // files the build traced as used. Tracing starts at the repository root so
  // the workspace packages are included.
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  // `next dev` writes an AGENTS.md when it detects an AI coding agent. A file
  // that appears for some developers and not others makes `git status` differ
  // from machine to machine, so the project opts out.
  agentRules: false,
  // The web server's OpenTelemetry SDK (src/lib/server-telemetry.ts) loads
  // from node_modules at run time rather than being bundled: it carries
  // exporters and transports the server never uses.
  serverExternalPackages: [
    "@opentelemetry/sdk-node",
    "@opentelemetry/exporter-trace-otlp-http",
    "@opentelemetry/instrumentation-undici",
  ],
  headers: () =>
    Promise.resolve([{ source: "/:path*", headers: SECURITY_HEADERS }]),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
