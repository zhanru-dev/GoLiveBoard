import { errors, jwtVerify, SignJWT } from "jose";

/** Short, so a stolen token is useful only briefly (FR-AUTH-2). */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

const ISSUER = "opspilot";
const AUDIENCE = "opspilot-api";
const ALGORITHM = "HS256";

export interface AccessTokenKeys {
  readonly current: string;
  /** Accepted, never used for signing: set while rotating the key. */
  readonly previous?: string | undefined;
}

const encoder = new TextEncoder();

/**
 * Signs an access token that names the session and nothing else. Roles and
 * memberships are never put in the token: every request reloads them, so a
 * change applies at once (FR-WS-3).
 */
export function signAccessToken(
  sessionId: string,
  keys: AccessTokenKeys,
  now: Date,
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT()
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(sessionId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ACCESS_TOKEN_TTL_SECONDS)
    .sign(encoder.encode(keys.current));
}

async function verifyWith(
  token: string,
  key: string,
  now: Date,
): Promise<string | undefined> {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(key), {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE,
      currentDate: now,
    });
    return payload.sub;
  } catch (error) {
    // Expected failures (expired, forged, malformed) mean "not signed in";
    // anything else is a bug and must surface.
    if (error instanceof errors.JOSEError) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Returns the session ID from a valid token, or `undefined` for a missing,
 * expired, malformed or forged one.
 */
export async function verifyAccessToken(
  token: string,
  keys: AccessTokenKeys,
  now: Date,
): Promise<string | undefined> {
  const sessionId = await verifyWith(token, keys.current, now);
  if (sessionId !== undefined || keys.previous === undefined) {
    return sessionId;
  }
  return verifyWith(token, keys.previous, now);
}
