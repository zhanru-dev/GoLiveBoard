import { randomInt } from "node:crypto";

/** Lowercase letters and digits without look-alikes (l, o, 0, 1). */
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
/** 32^10 ≈ 10^15 values: collisions are negligible and slugs are not guessable. */
const SUFFIX_LENGTH = 10;

/** The random part of an event slug, from a cryptographic source. */
export function randomSlugSuffix(): string {
  return Array.from(
    { length: SUFFIX_LENGTH },
    () => ALPHABET[randomInt(ALPHABET.length)],
  ).join("");
}
