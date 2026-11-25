import { defineConfig, devices } from "@playwright/test";

import { E2E_TARGET, target } from "./e2e/target.js";

/**
 * Browser tests, through the proxy exactly as a browser uses OpsPilot.
 *
 * - `npm run test:e2e`: against production builds on this machine. Before
 *   running: `npm run services:up`, `npm run db:deploy` and `npm run build`.
 * - `npm run test:e2e:stack`: against the production images over HTTPS.
 *   Before running: `npm run stack:up`.
 * - `E2E_TARGET=deployed DEPLOYED_URL=https://… npx playwright test`: the
 *   smoke tests only, against a deployed environment (the deploy pipeline).
 */
const deployed = E2E_TARGET === "deployed";

export default defineConfig({
  testDir: "./e2e",
  // A deployed environment runs its smoke tests and nothing else: the other
  // tests create data, and reset rate limits through the stack's Valkey.
  testMatch: deployed ? ["deployed.spec.ts"] : undefined,
  globalSetup: deployed ? undefined : "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: target.baseURL,
    // The stack's certificate comes from Caddy's local authority, which the
    // test browser does not trust; the smoke tests check the certificate
    // against that authority themselves.
    // DEPLOYED_INSECURE=1 lets the deployed smoke tests be tried against the
    // local stack, whose authority is not trusted; never set in the pipeline.
    ignoreHTTPSErrors:
      E2E_TARGET === "stack" || process.env.DEPLOYED_INSECURE === "1",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // The stack runs its own servers.
  webServer:
    E2E_TARGET === "stack" || deployed
      ? []
      : [
          {
            command: "npm run start -w @opspilot/api",
            url: "http://127.0.0.1:4301/api/v1/health/ready",
            reuseExistingServer: !process.env.CI,
            stdout: "ignore",
          },
          {
            command: "npm run start -w @opspilot/web",
            url: "http://127.0.0.1:3301",
            reuseExistingServer: !process.env.CI,
            stdout: "ignore",
          },
        ],
});
