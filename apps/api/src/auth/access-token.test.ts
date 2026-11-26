import { describe, expect, it } from "vitest";

import {
  ACCESS_TOKEN_TTL_SECONDS,
  signAccessToken,
  verifyAccessToken,
} from "./access-token.js";

const KEY = "current-signing-key-that-is-long-enough";
const OLD_KEY = "previous-signing-key-that-is-long-enough";
const NOW = new Date("2026-11-13T09:00:00Z");
const secondsLater = (seconds: number) =>
  new Date(NOW.getTime() + seconds * 1000);

describe("access tokens", () => {
  it("round-trips the session ID", async () => {
    const token = await signAccessToken("session-1", { current: KEY }, NOW);

    await expect(verifyAccessToken(token, { current: KEY }, NOW)).resolves.toBe(
      "session-1",
    );
  });

  it("expires after 15 minutes", async () => {
    const token = await signAccessToken("session-1", { current: KEY }, NOW);

    await expect(
      verifyAccessToken(
        token,
        { current: KEY },
        secondsLater(ACCESS_TOKEN_TTL_SECONDS - 1),
      ),
    ).resolves.toBe("session-1");
    await expect(
      verifyAccessToken(
        token,
        { current: KEY },
        secondsLater(ACCESS_TOKEN_TTL_SECONDS + 1),
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects a token signed with another key", async () => {
    const forged = await signAccessToken(
      "session-1",
      { current: "x".repeat(40) },
      NOW,
    );

    await expect(
      verifyAccessToken(forged, { current: KEY }, NOW),
    ).resolves.toBeUndefined();
  });

  it("rejects malformed input", async () => {
    await expect(
      verifyAccessToken("not.a.token", { current: KEY }, NOW),
    ).resolves.toBeUndefined();
  });

  it("keeps tokens signed with the previous key valid during a rotation", async () => {
    const issuedBeforeRotation = await signAccessToken(
      "session-1",
      { current: OLD_KEY },
      NOW,
    );

    await expect(
      verifyAccessToken(
        issuedBeforeRotation,
        { current: KEY, previous: OLD_KEY },
        NOW,
      ),
    ).resolves.toBe("session-1");
  });

  it("rejects an unsigned token (alg: none)", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString(
      "base64url",
    );
    const payload = Buffer.from(
      JSON.stringify({
        sub: "session-1",
        iss: "goliveboard",
        aud: "goliveboard-api",
      }),
    ).toString("base64url");

    await expect(
      verifyAccessToken(`${header}.${payload}.`, { current: KEY }, NOW),
    ).resolves.toBeUndefined();
  });
});
