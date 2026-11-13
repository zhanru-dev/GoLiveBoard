import type { NestExpressApplication } from "@nestjs/platform-express";
import { Me, ProblemDetails } from "@opspilot/contracts";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cookieHeader, setCookies } from "../testing/cookies.js";
import { createTestDatabase, type TestDatabase } from "../testing/database.js";
import { CapturingMailer, TestClock } from "../testing/fakes.js";
import { createTestApp, TEST_ORIGIN } from "../testing/test-app.js";
import { ACCESS_TOKEN_TTL_SECONDS } from "./access-token.js";
import { REFRESH_REUSE_GRACE_MS } from "./auth.service.js";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "./cookies.js";

const PASSWORD = "correct horse battery staple";

describe("authentication", () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let sql: Pool;
  const mailer = new CapturingMailer();
  const clock = new TestClock();

  beforeAll(async () => {
    database = await createTestDatabase();
    sql = new Pool({ connectionString: database.url });
    app = await createTestApp({
      env: { DATABASE_URL: database.url },
      mailer,
      clock,
    });
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await database.drop();
  });

  const http = () => request(app.getHttpServer());

  let counter = 0;
  const newEmail = () => `person${String((counter += 1))}@example.com`;

  function signUp(email: string, password = PASSWORD) {
    return http()
      .post("/api/v1/auth/sign-up")
      .set("Origin", TEST_ORIGIN)
      .send({ name: "Ada Lovelace", email, password });
  }

  function signIn(email: string, password = PASSWORD) {
    return http()
      .post("/api/v1/auth/sign-in")
      .set("Origin", TEST_ORIGIN)
      .send({ email, password });
  }

  /** Signs a new user up and in; returns the session cookies. */
  async function newSession() {
    const email = newEmail();
    await signUp(email);
    const response = await signIn(email);
    const cookies = setCookies(response);
    return {
      email,
      access: cookies.get(ACCESS_COOKIE)?.value ?? "",
      refresh: cookies.get(REFRESH_COOKIE)?.value ?? "",
    };
  }

  const me = (access: string) =>
    http()
      .get("/api/v1/me")
      .set("Cookie", cookieHeader({ [ACCESS_COOKIE]: access }));

  const refresh = (token: string) =>
    http()
      .post("/api/v1/auth/refresh")
      .set("Origin", TEST_ORIGIN)
      .set("Cookie", cookieHeader({ [REFRESH_COOKIE]: token }));

  describe("sign-up (FR-WS-1)", () => {
    it("creates a user, a workspace and an Owner membership", async () => {
      const email = newEmail();

      const response = await signUp(email);

      expect(response.status).toBe(202);
      expect(response.body).toEqual({ status: "accepted" });
      const { access } = setCookieValues(await signIn(email));
      const profile = Me.parse((await me(access)).body);
      expect(profile.activeWorkspace).toMatchObject({
        workspaceName: "Ada Lovelace's workspace",
        role: "OWNER",
      });
      expect(mailer.to(email).map((message) => message.subject)).toEqual([
        "Welcome to OpsPilot",
      ]);
    });

    it("answers a registered email exactly like a new one, and emails its owner", async () => {
      const email = newEmail();
      await signUp(email);

      const again = await signUp(email.toUpperCase());

      expect(again.status).toBe(202);
      expect(again.body).toEqual({ status: "accepted" });
      expect(again.headers["set-cookie"]).toBeUndefined();
      const users = await sql.query(
        "SELECT count(*)::int AS n FROM users WHERE email = $1",
        [email],
      );
      expect(users.rows[0]).toEqual({ n: 1 });
      expect(
        mailer.to(email.toUpperCase()).map((message) => message.subject),
      ).toEqual(["You already have an OpsPilot account"]);
    });

    it("rejects a short password with a field error", async () => {
      const response = await signUp(newEmail(), "short");

      expect(response.status).toBe(400);
      expect(ProblemDetails.parse(response.body).errors?.[0]).toMatchObject({
        path: "password",
        message: "Use at least 12 characters",
      });
    });
  });

  describe("sign-in (FR-AUTH-1)", () => {
    it("sets hardened session cookies", async () => {
      const email = newEmail();
      await signUp(email);

      const response = await signIn(email);

      expect(response.status).toBe(204);
      const cookies = setCookies(response);
      expect(cookies.get(ACCESS_COOKIE)?.attributes).toMatchObject({
        path: "/",
        httponly: "",
        secure: "",
        samesite: "Lax",
        "max-age": String(ACCESS_TOKEN_TTL_SECONDS),
      });
      expect(cookies.get(REFRESH_COOKIE)?.attributes).toMatchObject({
        path: "/api/v1/auth",
        httponly: "",
        secure: "",
        samesite: "Lax",
      });
    });

    it("fails identically for a wrong password and an unknown email", async () => {
      const email = newEmail();
      await signUp(email);

      const wrongPassword = await signIn(email, "not the right password");
      const unknownEmail = await signIn(newEmail(), "not the right password");

      for (const response of [wrongPassword, unknownEmail]) {
        expect(response.status).toBe(401);
        expect(response.headers["set-cookie"]).toBeUndefined();
      }
      const { requestId: _first, ...first } = ProblemDetails.parse(
        wrongPassword.body,
      );
      const { requestId: _second, ...second } = ProblemDetails.parse(
        unknownEmail.body,
      );
      expect(first).toEqual(second);
      expect(first.code).toBe("CREDENTIALS_INVALID");
    });

    it("refuses a disabled account", async () => {
      const email = newEmail();
      await signUp(email);
      await sql.query("UPDATE users SET disabled_at = now() WHERE email = $1", [
        email,
      ]);

      const response = await signIn(email);

      expect(ProblemDetails.parse(response.body).code).toBe(
        "CREDENTIALS_INVALID",
      );
    });
  });

  describe("access", () => {
    it("requires a session", async () => {
      const response = await http().get("/api/v1/me");

      expect(response.status).toBe(401);
      expect(ProblemDetails.parse(response.body).code).toBe("UNAUTHENTICATED");
    });

    it("rejects a tampered access token", async () => {
      const { access } = await newSession();
      const tampered = `${access.slice(0, -2)}xx`;

      expect((await me(tampered)).status).toBe(401);
    });

    it("rejects an access token after 15 minutes", async () => {
      const { access } = await newSession();

      clock.advance((ACCESS_TOKEN_TTL_SECONDS + 1) * 1000);

      expect((await me(access)).status).toBe(401);
    });

    it("applies a role change on the very next request (FR-WS-3)", async () => {
      const { access } = await newSession();
      const before = Me.parse((await me(access)).body);

      await sql.query(
        "UPDATE memberships SET role = 'ANALYST' WHERE workspace_id = $1",
        [before.activeWorkspace.workspaceId],
      );

      expect(Me.parse((await me(access)).body).activeWorkspace.role).toBe(
        "ANALYST",
      );
    });
  });

  describe("refresh (FR-AUTH-2)", () => {
    it("rotates the refresh token and issues a new access token", async () => {
      const session = await newSession();

      const response = await refresh(session.refresh);

      expect(response.status).toBe(204);
      const next = setCookieValues(response);
      expect(next.refresh).not.toBe(session.refresh);
      expect((await me(next.access)).status).toBe(200);
    });

    it("rotates once for two concurrent refreshes, and the loser leaves the winner's cookies alone", async () => {
      const session = await newSession();

      const responses = await Promise.all([
        refresh(session.refresh),
        refresh(session.refresh),
      ]);

      // Both succeed, but only one issues new cookies. The other sends no
      // Set-Cookie at all: clearing the cookies would sign out the browser
      // that just received new ones, whichever response arrives last.
      expect(responses.map((response) => response.status)).toEqual([204, 204]);
      const withCookies = responses.filter(
        (response) => setCookies(response).size > 0,
      );
      const withoutCookies = responses.filter(
        (response) => response.headers["set-cookie"] === undefined,
      );
      expect(withCookies).toHaveLength(1);
      expect(withoutCookies).toHaveLength(1);
      const next = setCookieValues(withCookies[0] as request.Response);
      expect(next.access).not.toBe("");
      expect((await me(next.access)).status).toBe(200);
      expect((await refresh(next.refresh)).status).toBe(204);
    });

    it("leaves the cookies alone for a token rotated moments ago, but issues nothing", async () => {
      const session = await newSession();
      const rotated = setCookieValues(await refresh(session.refresh));
      clock.advance(REFRESH_REUSE_GRACE_MS - 1);

      const late = await refresh(session.refresh);

      expect(late.status).toBe(204);
      expect(late.headers["set-cookie"]).toBeUndefined();
      expect((await me(rotated.access)).status).toBe(200);
    });

    it("revokes the whole session when an old refresh token comes back", async () => {
      const session = await newSession();
      const rotated = setCookieValues(await refresh(session.refresh));
      clock.advance(REFRESH_REUSE_GRACE_MS + 1);

      const replay = await refresh(session.refresh);

      expect(replay.status).toBe(401);
      expect((await me(rotated.access)).status).toBe(401);
      expect((await refresh(rotated.refresh)).status).toBe(401);
    });
  });

  describe("sign-out (FR-AUTH-3)", () => {
    it("revokes the session at once and clears the cookies", async () => {
      const session = await newSession();

      const response = await http()
        .post("/api/v1/auth/sign-out")
        .set("Origin", TEST_ORIGIN)
        .set("Cookie", cookieHeader({ [REFRESH_COOKIE]: session.refresh }));

      expect(response.status).toBe(204);
      expect(setCookies(response).get(ACCESS_COOKIE)?.value).toBe("");
      expect((await me(session.access)).status).toBe(401);
      expect((await refresh(session.refresh)).status).toBe(401);
    });
  });

  describe("cross-site request forgery", () => {
    it.each([
      ["no Origin header", undefined],
      ["another site's origin", "https://evil.example"],
    ])("refuses a state-changing request with %s", async (_case, origin) => {
      const call = http().post("/api/v1/auth/sign-in");
      const response = await (
        origin === undefined ? call : call.set("Origin", origin)
      ).send({
        email: newEmail(),
        password: PASSWORD,
      });

      expect(response.status).toBe(403);
      expect(ProblemDetails.parse(response.body).code).toBe("ORIGIN_FORBIDDEN");
    });
  });
});

function setCookieValues(response: request.Response) {
  const cookies = setCookies(response);
  return {
    access: cookies.get(ACCESS_COOKIE)?.value ?? "",
    refresh: cookies.get(REFRESH_COOKIE)?.value ?? "",
  };
}
