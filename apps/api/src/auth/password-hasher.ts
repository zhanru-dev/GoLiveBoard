import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id with the parameters OWASP recommends (19 MiB of memory, two
 * passes): slow enough to make guessing stolen hashes expensive, fast enough
 * (tens of milliseconds) for a sign-in.
 */
const ARGON2_OPTIONS = {
  algorithm: 2, // Argon2id
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  return verify(passwordHash, password);
}

/**
 * Verified against when the email address is unknown, so a sign-in for an
 * account that does not exist takes as long as one with a wrong password and
 * response timing does not reveal which accounts exist.
 */
let dummyHash: Promise<string> | undefined;

export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword("not-a-real-password-just-for-timing");
  await verifyPassword(await dummyHash, password);
  return false;
}
