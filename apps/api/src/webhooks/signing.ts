import { createHmac, timingSafeEqual } from "node:crypto";

/** Receivers should reject older timestamps (docs/04, section 6.1). */
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

/**
 * The `OpsPilot-Signature` header: `t=<unix seconds>,v1=<hex HMAC-SHA256 of
 * "<t>.<raw body>" with the endpoint's secret>`.
 */
export function signatureHeader(
  secret: string,
  timestampSeconds: number,
  body: string,
): string {
  return `t=${String(timestampSeconds)},v1=${hmac(secret, timestampSeconds, body)}`;
}

/**
 * What a receiver does with the header: true only for a signature made with
 * this secret over this exact body, no older than the tolerance (and not
 * from the future by more than it).
 */
export function verifySignature(
  header: string,
  secret: string,
  body: string,
  nowSeconds: number,
  toleranceSeconds: number = SIGNATURE_TOLERANCE_SECONDS,
): boolean {
  const parts = new Map(
    header.split(",").map((part) => {
      const [key = "", ...value] = part.split("=");
      return [key.trim(), value.join("=")] as const;
    }),
  );
  const timestamp = Number(parts.get("t"));
  const signature = parts.get("v1") ?? "";
  if (
    !Number.isInteger(timestamp) ||
    Math.abs(nowSeconds - timestamp) > toleranceSeconds ||
    !/^[0-9a-f]{64}$/.test(signature)
  ) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(hmac(secret, timestamp, body), "hex"),
  );
}

function hmac(secret: string, timestampSeconds: number, body: string): string {
  return createHmac("sha256", secret)
    .update(`${String(timestampSeconds)}.${body}`)
    .digest("hex");
}
