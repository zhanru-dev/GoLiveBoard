import { readFile } from "node:fs/promises";

import { call, openEvent } from "./api.js";
import { expect, test } from "./fixtures.js";
import { E2E_TARGET } from "./target.js";

/**
 * Milestone 7 in a browser: the operations room's server-sent events
 * through the proxy (which must pass them on at once, not buffer or
 * compress them), the audit trail, the integrations screen and the report.
 */
test("the operations room follows a status change within seconds, through the proxy", async ({
  page,
}) => {
  const event = await openEvent(page.request);
  await page.goto(`/events/${event.id}`);
  await page
    .getByRole("navigation", { name: "Event pages" })
    .getByRole("link", { name: "Operations room" })
    .click();

  await expect(
    page.getByRole("heading", { name: `Operations room: ${event.title}` }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Live");
  await expect(page.getByText("Configuring", { exact: true })).toBeVisible();

  // Changed elsewhere: the stream brings it, no reload.
  await call(page.request, "post", `/events/${event.id}/transitions`, {
    to: "CANCELLED",
  });

  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByText("Configuring → Cancelled")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Live");
});

test("the audit trail shows an event's actions from its Launch Control", async ({
  page,
}) => {
  const event = await openEvent(page.request);
  await page.goto(`/events/${event.id}`);

  await page
    .getByRole("navigation", { name: "Event pages" })
    .getByRole("link", { name: "Audit trail" })
    .click();

  await expect(
    page.getByRole("heading", { name: "Audit trail" }),
  ).toBeVisible();
  await expect(page.getByText("For one event only.")).toBeVisible();
  // Newest first: openEvent created it, set its policy, then moved it.
  await expect(
    page.getByRole("cell", { name: /^(event|access_policy)\./ }),
  ).toHaveText([
    "event.transitioned",
    "access_policy.updated",
    "event.created",
  ]);
  await expect(
    page.getByRole("cell", { name: "status: DRAFT → CONFIGURING" }),
  ).toBeVisible();
});

test("an Owner's integrations screen refuses a receiver on a private address", async ({
  page,
}) => {
  await openEvent(page.request);
  await page.goto("/events");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Integrations" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Integrations" }),
  ).toBeVisible();
  await expect(page.getByText("No endpoints yet.")).toBeVisible();

  await page.getByLabel("Receiver URL").fill("https://10.0.0.7/hooks");
  await page.getByLabel(/An event completes/).check();
  await page.getByRole("button", { name: "Add endpoint" }).click();

  await expect(page.getByText(/public internet/)).toBeVisible();
  await expect(page.getByText("No endpoints yet.")).toBeVisible();
});

test("a demo visitor reads the completed event's report and downloads it", async ({
  page,
}) => {
  test.skip(E2E_TARGET !== "stack", "The demo runs in the stack");
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Try the demo" }).click();
  await page.getByRole("link", { name: "Customer conference" }).click();
  await page
    .getByRole("navigation", { name: "Event pages" })
    .getByRole("link", { name: "Report" })
    .click();

  await expect(
    page.getByRole("heading", { name: "Report: Customer conference" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "Viewers per minute, with incidents shaded",
    }),
  ).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(
    /^report-customer-conference-.+\.csv$/,
  );
  const csv = await readFile(await file.path(), "utf8");
  expect(csv.split("\r\n").slice(0, 2)).toEqual([
    "metric,value",
    "event,Customer conference",
  ]);
});
