import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  SIGNATURE_TOLERANCE_SECONDS,
  signatureHeader,
  verifySignature,
} from "./signing.js";

// Generated per run: no secret-looking literal in the repository.
const secret = `whsec_${randomBytes(24).toString("hex")}`;
const body = JSON.stringify({ id: "e1", type: "event.live" });
const now = 1_795_000_000;

describe("webhook signatures (docs/04, section 6.1)", () => {
  it("signs t and the raw body, and verifies only that body with that secret", () => {
    const header = signatureHeader(secret, now, body);

    expect(header).toMatch(/^t=1795000000,v1=[0-9a-f]{64}$/);
    expect(verifySignature(header, secret, body, now)).toBe(true);
    expect(verifySignature(header, secret, `${body} `, now)).toBe(false);
    expect(verifySignature(header, `${secret}x`, body, now)).toBe(false);
  });

  it("refuses a timestamp outside the tolerance, either way", () => {
    const header = signatureHeader(secret, now, body);

    expect(
      verifySignature(header, secret, body, now + SIGNATURE_TOLERANCE_SECONDS),
    ).toBe(true);
    expect(
      verifySignature(
        header,
        secret,
        body,
        now + SIGNATURE_TOLERANCE_SECONDS + 1,
      ),
    ).toBe(false);
    expect(
      verifySignature(
        header,
        secret,
        body,
        now - SIGNATURE_TOLERANCE_SECONDS - 1,
      ),
    ).toBe(false);
  });

  it("refuses a header whose timestamp was changed", () => {
    const header = signatureHeader(secret, now, body).replace(
      `t=${String(now)}`,
      `t=${String(now + 1)}`,
    );

    expect(verifySignature(header, secret, body, now)).toBe(false);
  });

  it.each(["", "t=1795000000", "v1=abc", "t=x,v1=" + "0".repeat(64)])(
    "refuses a malformed header %j",
    (header) => {
      expect(verifySignature(header, secret, body, now)).toBe(false);
    },
  );
});
