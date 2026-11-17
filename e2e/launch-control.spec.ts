import type { Page } from "@playwright/test";

import { expect, SIGNED_IN_MS, test } from "./fixtures.js";

const PASSWORD = "correct horse battery staple";
const unique = () =>
  `${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;

/** A real 1×1 PNG, so storage and the API's checks see a genuine image. */
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      message.text().includes("Content Security Policy")
    ) {
      violations.push(message.text());
    }
  });
  return violations;
}

/**
 * The stream check cannot pass here: the SSRF rules refuse every address a
 * local test stream could have, so the test proves that this blocker keeps
 * the event from becoming READY. The stream check itself is covered by the
 * API's integration tests against a controllable HTTPS stream.
 */
test("a Manager prepares an event in Launch Control until only the stream blocks it", async ({
  page,
}) => {
  const violations = watchCsp(page);

  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill("Ada Lovelace");
  await page.getByLabel("Email address").fill(`launch-${unique()}@example.com`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Events" })).toBeVisible({
    timeout: SIGNED_IN_MS,
  });
  await expect(page.getByText("No events yet.")).toBeVisible();

  // Create the event; it opens in Launch Control.
  await page.getByRole("link", { name: "New event" }).click();
  await expect(page.getByRole("heading", { name: "New event" })).toBeVisible();
  // Exact: "Title" would also match the list's "Search titles" field.
  await page.getByLabel("Title", { exact: true }).fill("Autumn product launch");
  await page.getByLabel("Description").fill("Our biggest release of the year.");
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(
    page.getByRole("heading", { name: "Autumn product launch" }),
  ).toBeVisible();
  const readiness = page.getByRole("complementary", { name: "Readiness" });
  await expect(
    readiness.getByText("No access policy has been set."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Start configuring" }).click();
  await expect(page.getByRole("button", { name: "Mark ready" })).toBeVisible();

  // A critical task, completed.
  await page.getByLabel("New task").fill("Rehearse the opening");
  await page.getByLabel("Critical").check();
  await page.getByRole("button", { name: "Add task" }).click();
  const done = page.getByRole("checkbox", {
    name: "Rehearse the opening done",
  });
  // The box is controlled by the saved task, so it ticks a moment later.
  await done.click();
  await expect(done).toBeChecked();
  await expect(
    readiness.getByText("All 1 critical tasks are done."),
  ).toBeVisible();

  // Who may register.
  await page.getByLabel("Privacy notice version").fill("2026-11");
  await page.getByRole("button", { name: "Set access policy" }).click();
  await expect(
    readiness.getByText("Access policy set: anyone can register."),
  ).toBeVisible();

  // The holding slate goes from the browser straight to object storage.
  await page.getByLabel("Upload an image").setInputFiles({
    name: "slate.png",
    mimeType: "image/png",
    buffer: ONE_PIXEL_PNG,
  });
  const slate = page.getByRole("img", { name: "Current holding slate" });
  await expect(slate).toBeVisible();
  // Loaded, not just present: storage served it and the CSP allowed it.
  await expect(slate).toHaveJSProperty("naturalWidth", 1);
  await expect(
    readiness.getByText("A holding slate has been uploaded."),
  ).toBeVisible();

  // Only the stream blocks the event now, and READY is refused because of it.
  await expect(
    readiness.getByText("1 hard blocker must be resolved", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mark ready" }).click();
  const refusal = page
    .getByRole("alert")
    .filter({ hasText: "Resolve the blockers" });
  await expect(refusal).toContainText("No stream URL has been set.");

  // The event is listed with its status.
  await page.getByRole("link", { name: "All events" }).click();
  await expect(
    page.getByRole("link", { name: "Autumn product launch" }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "Configuring" })).toBeVisible();

  expect(violations).toEqual([]);
});
