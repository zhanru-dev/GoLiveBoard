import { randomBytes } from "node:crypto";

import type { CookieOptions, Request, Response } from "express";

/**
 * An attendee's session (FR-AD-3): an opaque token, of which only the hash
 * is stored. `__Host-`: Secure, Path=/ and no Domain, enforced by browsers.
 * One browser holds one attendee session at a time; verifying for another
 * event replaces it.
 */
export const ATTENDEE_COOKIE = "__Host-goliveboard_attendee";

/**
 * Demo mode only: the key of this browser's demo inbox, which receives the
 * mail for the attendees it registered in the demo workspace (FR-AUTH-5).
 */
export const DEMO_INBOX_COOKIE = "__Host-goliveboard_demo_inbox";

const DEMO_INBOX_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** As the staff cookies: HttpOnly, Secure, SameSite=Lax. */
const BASE: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
};

export function setAttendeeCookie(
  response: Response,
  token: string,
  expiresAt: Date,
): void {
  response.cookie(ATTENDEE_COOKIE, token, { ...BASE, expires: expiresAt });
}

export function clearAttendeeCookie(response: Response): void {
  response.clearCookie(ATTENDEE_COOKIE, BASE);
}

function readCookie(request: Request, name: string): string | undefined {
  const cookies: unknown = request.cookies;
  if (typeof cookies !== "object" || cookies === null) {
    return undefined;
  }
  const value: unknown = (cookies as Record<string, unknown>)[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export const readAttendeeCookie = (request: Request) =>
  readCookie(request, ATTENDEE_COOKIE);

export const readDemoInboxCookie = (request: Request) =>
  readCookie(request, DEMO_INBOX_COOKIE);

/**
 * This browser's demo inbox key: the one it has, or a new one, which is then
 * set on the response.
 */
export function demoInboxKey(request: Request, response: Response): string {
  const existing = readDemoInboxCookie(request);
  if (existing !== undefined) {
    return existing;
  }
  const key = randomBytes(32).toString("base64url");
  response.cookie(DEMO_INBOX_COOKIE, key, {
    ...BASE,
    maxAge: DEMO_INBOX_TTL_MS,
  });
  return key;
}
