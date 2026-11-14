import { type APIRequestContext, expect, test } from "@playwright/test";

import { latestEmailTo, linkIn } from "./mailpit.js";
import { target } from "./target.js";

const PASSWORD = "correct horse battery staple";
const unique = () =>
  `${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;

/** State-changing API calls must come from the site (CSRF protection). */
const origin = { Origin: new URL(target.baseURL).origin };

async function call(
  request: APIRequestContext,
  method: "post" | "put",
  path: string,
  data: object,
) {
  const response = await request[method](`/api/v1${path}`, {
    data,
    headers: origin,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response;
}

/** An Owner with an event open for registration, made through the API. */
async function openEvent(request: APIRequestContext) {
  const email = `owner-${unique()}@example.com`;
  await call(request, "post", "/auth/sign-up", {
    name: "Ada Lovelace",
    email,
    password: PASSWORD,
  });
  await call(request, "post", "/auth/sign-in", { email, password: PASSWORD });
  const created = await call(request, "post", "/events", {
    title: `Admission day ${unique()}`,
    description: "An event to register for.",
    startsAt: "2027-03-01T18:00:00Z",
    endsAt: "2027-03-01T19:00:00Z",
    timeZone: "Europe/London",
  });
  const event = (await created.json()) as {
    id: string;
    slug: string;
    title: string;
  };
  await call(request, "put", `/events/${event.id}/access-policy`, {
    mode: "PUBLIC",
    allowedDomains: [],
    privacyNoticeVersion: "2026-11",
  });
  await call(request, "post", `/events/${event.id}/transitions`, {
    to: "CONFIGURING",
  });
  return event;
}

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
