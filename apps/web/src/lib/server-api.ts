import "server-only";

import { AttendeeMe, Me, PublicEvent, WatchInfo } from "@opspilot/contracts";
import { cookies } from "next/headers";

/**
 * The web server talks to the API directly over the internal network, not
 * through the public proxy, forwarding the user's cookies.
 */
const API_INTERNAL_URL =
  process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4301";

/** The signed-in user, or null when the access token is missing or expired. */
export async function getMe(): Promise<Me | null> {
  const cookieHeader = (await cookies()).toString();
  if (cookieHeader === "") {
    return null;
  }
  const response = await fetch(`${API_INTERNAL_URL}/api/v1/me`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`GET /me failed with ${String(response.status)}`);
  }
  return Me.parse(await response.json());
}

/**
 * An event's public page data, or null when there is no public event with
 * that slug (a draft, an archived event or a mistyped link look the same).
 * The public page needs no session, so no cookies are forwarded.
 */
export async function getPublicEvent(
  slug: string,
): Promise<PublicEvent | null> {
  const response = await fetch(
    `${API_INTERNAL_URL}/api/v1/public/events/${encodeURIComponent(slug)}`,
    { cache: "no-store" },
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `GET /public/events failed with ${String(response.status)}`,
    );
  }
  return PublicEvent.parse(await response.json());
}

/**
 * The attendee this browser is signed in as for this event, or null: no
 * attendee session, a session for another event, or no longer admitted.
 */
export async function getAttendeeMe(slug: string): Promise<AttendeeMe | null> {
  const cookieHeader = (await cookies()).toString();
  if (cookieHeader === "") {
    return null;
  }
  const response = await fetch(
    `${API_INTERNAL_URL}/api/v1/public/events/${encodeURIComponent(slug)}/me`,
    { headers: { cookie: cookieHeader }, cache: "no-store" },
  );
  if ([401, 403, 404].includes(response.status)) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `GET /public/events/me failed with ${String(response.status)}`,
    );
  }
  return AttendeeMe.parse(await response.json());
}

/**
 * What the watch page shows, or null when this browser is not signed in as
 * an attendee the event admits.
 */
export async function getWatchInfo(slug: string): Promise<WatchInfo | null> {
  const cookieHeader = (await cookies()).toString();
  if (cookieHeader === "") {
    return null;
  }
  const response = await fetch(
    `${API_INTERNAL_URL}/api/v1/public/events/${encodeURIComponent(slug)}/watch`,
    { headers: { cookie: cookieHeader }, cache: "no-store" },
  );
  if ([401, 403, 404].includes(response.status)) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `GET /public/events/watch failed with ${String(response.status)}`,
    );
  }
  return WatchInfo.parse(await response.json());
}
