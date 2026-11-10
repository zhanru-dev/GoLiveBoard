import type { NextConfig } from "next";

/**
 * Sent with every page. A full Content Security Policy for scripts arrives
 * with the first pages that need one (milestone 2); `frame-ancestors` already
 * stops other sites from embedding OpsPilot to trick users into clicking.
 */
export const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  // create-next-app 16.4 defaults: components and data are dynamic unless
  // explicitly cached, and links prefetch only the static part of a page.
  cacheComponents: true,
  partialPrefetching: true,
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
