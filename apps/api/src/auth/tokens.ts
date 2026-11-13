import { createHash, randomBytes } from "node:crypto";

/** 256 bits: guessing a token is not a realistic attack. */
const TOKEN_BYTES = 32;

/**
 * A random secret for a link or a refresh cookie. Only its hash is stored,
 * so a copy of the database cannot be used to sign in or reset a password.
 */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * SHA-256 is right here, unlike for passwords: tokens are long and random, so
 * there is nothing to brute-force, and a fast hash lets the database look a
 * token up by its hash.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
