import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against production builds, through the Caddy proxy on
 * port 3300, exactly as a browser uses OpsPilot. Before running:
 * `npm run services:up`, `npm run db:deploy` and `npm run build`.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3300",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
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
