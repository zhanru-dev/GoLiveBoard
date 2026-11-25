import type { CookieOptions, Request, Response } from "express";

import { API_PREFIX } from "../http/api-prefix.js";
import { ACCESS_TOKEN_TTL_SECONDS } from "./access-token.js";

/** Seven days, renewed by every refresh (FR-AUTH-2). */
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Cookie name prefixes are enforced by browsers: `__Host-` requires Secure,
 * Path=/ and no Domain, so no subdomain can set or overwrite the cookie;
 * `__Secure-` requires Secure.
 */
export const ACCESS_COOKIE = "__Host-opspilot_access";
export const REFRESH_COOKIE = "__Secure-opspilot_refresh";

/** The refresh token is sent only to the endpoints that need it. */
const REFRESH_COOKIE_PATH = `/${API_PREFIX}/auth`;

/**
 * HttpOnly: page scripts cannot read the tokens, so an XSS bug cannot steal
 * them. SameSite=Lax: other sites cannot make the browser send them with a
 * cross-site POST. Secure: never sent over plain HTTP (browsers treat
 * localhost as secure, so local development works).
 */
const BASE: CookieOptions = { httpOnly: true, secure: true, sameSite: "lax" };

export interface SessionTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
}

export function setSessionCookies(
  response: Response,
  tokens: SessionTokens,
): void {
  response.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...BASE,
    path: "/",
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
  response.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...BASE,
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
}

export function clearSessionCookies(response: Response): void {
  response.clearCookie(ACCESS_COOKIE, { ...BASE, path: "/" });
  response.clearCookie(REFRESH_COOKIE, { ...BASE, path: REFRESH_COOKIE_PATH });
}

function readCookie(request: Request, name: string): string | undefined {
  // Parsed by cookie-parser; typed loosely, so narrow before use.
  const cookies: unknown = request.cookies;
  if (typeof cookies !== "object" || cookies === null) {
    return undefined;
  }
  const value: unknown = (cookies as Record<string, unknown>)[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export const readAccessCookie = (request: Request) =>
  readCookie(request, ACCESS_COOKIE);
export const readRefreshCookie = (request: Request) =>
  readCookie(request, REFRESH_COOKIE);
