import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Invite codes for sign-up (FR-WS-1). The deployment keeps only their
 * SHA-256 digests, each with a label naming who it was given to, so a code
 * can be withdrawn on its own and the log says which one was used. The
 * codes themselves are random and long, so a digest cannot be reversed.
 */
export interface SignUpCodeDigest {
  readonly label: string;
  readonly sha256: Buffer;
}

const ENTRY = /^([a-z0-9][a-z0-9-]{0,39}):([0-9a-f]{64})$/;

/**
 * Reads `label:hex digest` entries, separated by commas. Labels are short,
 * lower-case and unique.
 *
 * @throws Error naming the first entry that does not fit
 */
export function parseSignUpCodes(value: string): SignUpCodeDigest[] {
  const digests: SignUpCodeDigest[] = [];
  for (const raw of value.split(",")) {
    const entry = raw.trim();
    const match = ENTRY.exec(entry);
    if (match === null) {
      throw new Error(
        `"${entry.slice(0, 40)}" is not label:sha256 (a lower-case label, a colon and 64 hex digits)`,
      );
    }
    const [, label = "", hex = ""] = match;
    if (digests.some((digest) => digest.label === label)) {
      throw new Error(`The label "${label}" is used twice`);
    }
    digests.push({ label, sha256: Buffer.from(hex, "hex") });
  }
  return digests;
}

/** The digest stored for `code`: what the runbook asks you to compute. */
export function digestSignUpCode(code: string): Buffer {
  return createHash("sha256").update(code.trim(), "utf8").digest();
}

/**
 * The label of the code that matches, if any. Every digest is compared, in
 * constant time, so the response time says nothing about which came close.
 */
export function matchSignUpCode(
  digests: readonly SignUpCodeDigest[],
  code: string,
): string | undefined {
  const candidate = digestSignUpCode(code);
  let found: string | undefined;
  for (const digest of digests) {
    if (timingSafeEqual(digest.sha256, candidate) && found === undefined) {
      found = digest.label;
    }
  }
  return found;
}
