import type { NestExpressApplication } from "@nestjs/platform-express";
import { ProblemDetails } from "@opspilot/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ApiClient,
  tokenFromEmail,
  uniqueEmail,
} from "../testing/api-client.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import {
  CapturingMailer,
  PausingPasswordHasher,
  TestClock,
} from "../testing/fakes.js";
import { createTestApp } from "../testing/test-app.js";
import { PASSWORD_RESET_TTL_MS } from "./password-reset.service.js";

const NEW_PASSWORD = "a brand new passphrase";

describe("password reset (FR-AUTH-4)", () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let api: ApiClient;
  const mailer = new CapturingMailer();
  const clock = new TestClock();
  const passwords = new PausingPasswordHasher();

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({
      env: { DATABASE_URL: database.url },
      mailer,
      clock,
      passwordHasher: passwords,
    });
    api = new ApiClient(app);
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  const requestReset = (email: string) =>
    api.post("/auth/password-reset/request", { email });
  const confirm = (token: string, password = NEW_PASSWORD) =>
    api.post("/auth/password-reset/confirm", { token, password });

  async function resetToken(email: string): Promise<string> {
    await requestReset(email);
    const [message] = mailer.to(email).slice(-1);
    return tokenFromEmail(message?.text ?? "");
  }

  it("answers the same for an unknown address and sends nothing", async () => {
    const owner = await api.newOwner();
    const unknown = uniqueEmail("nobody");

    const known = await requestReset(owner.email);
    const missing = await requestReset(unknown);

    expect([known.status, missing.status]).toEqual([202, 202]);
    expect(known.body).toEqual(missing.body);
    expect(mailer.to(unknown)).toEqual([]);
  });

  it("sets the new password and signs the user out everywhere", async () => {
    const session = await api.newOwner();
    const token = await resetToken(session.email);

    expect((await confirm(token)).status).toBe(204);

    expect((await api.get(session, "/me")).status).toBe(401);
    expect((await api.signIn(session.email)).status).toBe(401);
    expect((await api.signIn(session.email, NEW_PASSWORD)).status).toBe(204);
  });

  it("ends a sign-in that checked the old password while the reset happened", async () => {
    const session = await api.newOwner();
    const token = await resetToken(session.email);

    // The sign-in checks the old password, then stops before its session
    // exists; the reset completes in that gap.
    const pause = passwords.pauseNextVerify();
    const signingIn = Promise.resolve(api.signIn(session.email));
    await pause.reached;
    expect((await confirm(token)).status).toBe(204);
    pause.release();
    const signIn = await signingIn;

    expect(signIn.status).toBe(401);
    expect(ProblemDetails.parse(signIn.body).code).toBe("CREDENTIALS_INVALID");
    expect(signIn.headers["set-cookie"]).toBeUndefined();
    const [sessions] = await database.query<{ active: number }>(
      `SELECT count(*)::int AS active FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE users.email = $1 AND sessions.revoked_at IS NULL`,
      [session.email],
    );
    expect(sessions?.active).toBe(0);
  });

  it("works only once", async () => {
    const owner = await api.newOwner();
    const token = await resetToken(owner.email);
    await confirm(token);

    const again = await confirm(token, "yet another passphrase");

    expect(ProblemDetails.parse(again.body).code).toBe("TOKEN_INVALID");
  });

  it("expires after 30 minutes", async () => {
    const owner = await api.newOwner();
    const token = await resetToken(owner.email);
    clock.advance(PASSWORD_RESET_TTL_MS + 1);

    expect(ProblemDetails.parse((await confirm(token)).body).code).toBe(
      "TOKEN_INVALID",
    );
  });

  it("invalidates earlier links once one is used", async () => {
    const owner = await api.newOwner();
    const older = await resetToken(owner.email);
    const newer = await resetToken(owner.email);
    await confirm(newer);

    expect(ProblemDetails.parse((await confirm(older)).body).code).toBe(
      "TOKEN_INVALID",
    );
  });
});
