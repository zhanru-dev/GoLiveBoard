import type { NextConfig } from "next";

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
  // `next dev` writes an AGENTS.md when it detects an AI coding agent. A file
  // that appears for some developers and not others makes `git status` differ
  // from machine to machine, so the project opts out.
  agentRules: false,
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
