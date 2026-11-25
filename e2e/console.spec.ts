import { openEvent } from "./api.js";
import { expect, test } from "./fixtures.js";

/**
 * Pages load without errors in the browser console and without failed
 * requests, as Lighthouse's best-practices audit expects (docs/lighthouse.md).
 * It found a browser asking for /favicon.ico, which did not exist: a page
 * that declares no icon makes browsers guess. Headless Playwright asks for
 * no icon at all, so the icon is checked by hand.
 */
test("public pages load without console errors or failed requests", async ({
  page,
  browser,
}) => {
  const event = await openEvent((await browser.newContext()).request);
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      problems.push(`console: ${message.text()}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      problems.push(`${String(response.status())} ${response.url()}`);
    }
  });

  for (const path of ["/sign-in", `/e/${event.slug}`]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }

  expect(problems).toEqual([]);
  const link = page.locator('link[rel="icon"]');
  await expect(link).toHaveCount(1);
  const icon = await link.getAttribute("href");
  const response = await page.request.get(icon ?? "");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/");
});
