import { type APIRequestContext, expect } from "@playwright/test";

import { target } from "./target.js";

export const PASSWORD = "correct horse battery staple";
export const unique = () =>
  `${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;

/** State-changing API calls must come from the site (CSRF protection). */
const origin = { Origin: new URL(target.baseURL).origin };

export async function call(
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
export async function openEvent(request: APIRequestContext) {
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
