import "server-only";

import { Me } from "@opspilot/contracts";
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
