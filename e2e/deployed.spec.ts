import { expect, test } from "@playwright/test";

import { E2E_TARGET } from "./target.js";

/**
 * Smoke tests of a deployed environment (docs/06, section 4): the deploy
 * pipeline runs them against the public URL before it keeps a release, and
 * deploys the previous one again when any fails. They read what any
 * visitor can, and change nothing but a demo session.
 *
 * SMOKE_FORCE_FAILURE=1 makes them fail on purpose: the drill that proves a
 * failing smoke test rolls the release back (M10's exit criteria).
 */
test.skip(E2E_TARGET !== "deployed", "Runs against a deployed environment");

test("is not asked to fail (the rollback drill)", () => {
  expect(
    process.env.SMOKE_FORCE_FAILURE ?? "",
    "SMOKE_FORCE_FAILURE=1 fails the smoke tests on purpose",
  ).not.toBe("1");
});

test("the API is ready: database and Valkey answer", async ({ request }) => {
  const response = await request.get("/api/v1/health/ready");

  expect(response.status()).toBe(200);
});

test("pages are served over HTTPS with the security headers", async ({
  page,
}) => {
  const response = await page.goto("/sign-in");

  expect(response?.status()).toBe(200);
  expect(new URL(page.url()).protocol).toBe("https:");
  const headers = response?.headers() ?? {};
  expect(headers["strict-transport-security"]).toContain("max-age=");
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("plain HTTP redirects to HTTPS", async ({ request, baseURL }) => {
  // The same host on port 80, unless DEPLOYED_HTTP_URL says otherwise (the
  // local stack's HTTP port, when these tests are tried there).
  const http = new URL(process.env.DEPLOYED_HTTP_URL ?? baseURL ?? "");
  http.protocol = "http:";
  const response = await request.get(new URL("/sign-in", http).toString(), {
    maxRedirects: 0,
  });

  expect([301, 308]).toContain(response.status());
  expect(response.headers().location).toMatch(/^https:\/\//);
});

test("refuses the methods no page or API uses", async ({ request }) => {
  const response = await request.fetch("/sign-in", { method: "TRACE" });

  expect(response.status()).toBe(405);
});

test("a visitor can try the demo, when it is on", async ({ page }) => {
  await page.goto("/sign-in");
  const demo = page.getByRole("button", { name: "Try the demo" });
  test.skip((await demo.count()) === 0, "Demo mode is off here");

  await demo.click();

  await expect(page.getByRole("heading", { name: "Events" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Autumn product launch")).toBeVisible();
});
