import type { ImageContentType } from "@opspilot/contracts";

/** How many leading bytes detectImageType needs. */
export const SIGNATURE_BYTES = 12;

const startsWith = (
  bytes: Uint8Array,
  signature: readonly number[],
  offset = 0,
) => signature.every((byte, index) => bytes[offset + index] === byte);

const ascii = (text: string) =>
  Array.from(text, (character) => character.charCodeAt(0));

/**
 * Identifies an image by its first bytes ("magic numbers"), not by the name
 * or the declared type, which the uploader controls:
 *
 * - JPEG: `FF D8 FF`
 * - PNG: `89 50 4E 47 0D 0A 1A 0A`
 * - WebP: `RIFF`, four length bytes, then `WEBP`
 *
 * @param bytes - at least the first SIGNATURE_BYTES bytes of the file
 * @returns the image type, or `undefined` for anything else
 */
export function detectImageType(
  bytes: Uint8Array,
): ImageContentType | undefined {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) {
    return "image/webp";
  }
  return undefined;
}
