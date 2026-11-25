import { call, openEvent, unique } from "./api.js";
import { expect, test } from "./fixtures.js";
import { latestEmailTo, linkIn } from "./mailpit.js";

test("an attendee registers, confirms by email and is let in, until a Manager revokes them (FR-AD-1 to FR-AD-4)", async ({
  page,
  browser,
}) => {
  const event = await openEvent(page.request);
  const attendee = await browser.newContext();
  const visitor = await attendee.newPage();

  // The public page, rendered on the server, with link-preview metadata.
  await visitor.goto(`/e/${event.slug}`);
  await expect(
    visitor.getByRole("heading", { level: 1, name: event.title }),
  ).toBeVisible();
  await expect(visitor.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    event.title,
  );

  const email = `attendee-${unique()}@example.com`;
  await visitor.getByLabel("Name").fill("Grace Hopper");
  await visitor.getByLabel("Email address").fill(email);
  await visitor.getByText("Privacy notice (version 2026-11)").click();
  await expect(
    visitor.getByText(/deleted or anonymised 90 days/),
  ).toBeVisible();
  await visitor.getByLabel(/agree to it/).check();
  await visitor.getByRole("button", { name: "Register" }).click();
  await expect(visitor.getByRole("status")).toContainText("Check your inbox");

  // The link in the email confirms the address and signs the attendee in.
  await visitor.goto(linkIn(await latestEmailTo(email)));
  await expect(visitor).toHaveURL(new RegExp(`/e/${event.slug}$`));
  await expect(visitor.getByRole("status")).toContainText(
    "You are registered as Grace Hopper",
  );

  // Staff see them, and revoking them applies to their very next request.
  const listed = await page.request.get(`/api/v1/events/${event.id}/attendees`);
  const { items } = (await listed.json()) as {
    items: { id: string; email: string; status: string }[];
  };
  expect(items).toEqual([
    expect.objectContaining({ email, status: "VERIFIED" }),
  ]);
  await call(
    page.request,
    "post",
    `/events/${event.id}/attendees/${items[0]?.id ?? ""}/revoke`,
    {},
  );
  await visitor.reload();
  await expect(visitor.getByText("You are registered as")).toHaveCount(0);
  await expect(visitor.getByRole("button", { name: "Register" })).toBeVisible();
  await attendee.close();
});

test("the public page of an event that does not exist is a 404", async ({
  page,
}) => {
  const response = await page.goto(`/e/no-such-event-${unique()}`);

  expect(response?.status()).toBe(404);
});
