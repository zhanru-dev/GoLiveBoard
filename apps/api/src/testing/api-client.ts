import type { NestExpressApplication } from "@nestjs/platform-express";
import { Me } from "@goliveboard/contracts";
import request from "supertest";

import { ACCESS_COOKIE, REFRESH_COOKIE } from "../auth/cookies.js";
import { TEST_ORIGIN } from "./config.js";
import { cookieHeader, setCookies } from "./cookies.js";

export const TEST_PASSWORD = "correct horse battery staple";

export interface TestSession {
  readonly email: string;
  readonly access: string;
  readonly refresh: string;
}

let counter = 0;

/** A fresh, unique email address for one test. */
export function uniqueEmail(label = "person"): string {
  counter += 1;
  return `${label}-${String(counter)}-${String(Date.now())}@example.com`;
}

/**
 * Talks to a test app the way the web app does: JSON, the app's Origin on
 * state-changing requests, and session cookies sent back by hand.
 */
export class ApiClient {
  constructor(
    private readonly app: NestExpressApplication,
    /**
     * Client address announced through X-Forwarded-For, as Caddy does; only
     * honoured when the app runs with TRUST_PROXY_HOPS=1.
     */
    private readonly clientIp?: string,
  ) {}

  private http() {
    const agent = request(this.app.getHttpServer());
    if (this.clientIp === undefined) {
      return agent;
    }
    const ip = this.clientIp;
    // supertest has no default headers, so wrap each method.
    const withIp = <T extends { set(name: string, value: string): T }>(
      call: T,
    ) => call.set("X-Forwarded-For", ip);
    return {
      get: (path: string) => withIp(agent.get(path)),
      post: (path: string) => withIp(agent.post(path)),
      put: (path: string) => withIp(agent.put(path)),
      patch: (path: string) => withIp(agent.patch(path)),
      delete: (path: string) => withIp(agent.delete(path)),
    };
  }

  signUp(
    email: string,
    password = TEST_PASSWORD,
    name = "Ada Lovelace",
    inviteCode?: string,
  ) {
    return this.http()
      .post("/api/v1/auth/sign-up")
      .set("Origin", TEST_ORIGIN)
      .send({ name, email, password, inviteCode });
  }

  signIn(email: string, password = TEST_PASSWORD) {
    return this.http()
      .post("/api/v1/auth/sign-in")
      .set("Origin", TEST_ORIGIN)
      .send({ email, password });
  }

  /** Signs in and returns the session cookies; fails the test if sign-in fails. */
  async session(email: string, password = TEST_PASSWORD): Promise<TestSession> {
    const response = await this.signIn(email, password);
    if (response.status !== 204) {
      throw new Error(
        `Sign-in failed with ${String(response.status)}: ${response.text}`,
      );
    }
    const cookies = setCookies(response);
    return {
      email,
      access: cookies.get(ACCESS_COOKIE)?.value ?? "",
      refresh: cookies.get(REFRESH_COOKIE)?.value ?? "",
    };
  }

  /** A new user who owns a new workspace, signed in. */
  async newOwner(label = "owner"): Promise<TestSession> {
    const email = uniqueEmail(label);
    await this.signUp(email);
    return this.session(email);
  }

  get(session: TestSession, path: string) {
    return this.http()
      .get(`/api/v1${path}`)
      .set("Cookie", this.cookie(session));
  }

  send(
    session: TestSession,
    method: "post" | "put" | "patch" | "delete",
    path: string,
    body?: object,
  ) {
    const call = this.http()
      [method](`/api/v1${path}`)
      .set("Origin", TEST_ORIGIN)
      .set("Cookie", this.cookie(session));
    return body === undefined ? call : call.send(body);
  }

  /** Public endpoint with a JSON body (no session). */
  post(path: string, body: object) {
    return this.http()
      .post(`/api/v1${path}`)
      .set("Origin", TEST_ORIGIN)
      .send(body);
  }

  async me(session: TestSession): Promise<Me> {
    return Me.parse((await this.get(session, "/me")).body);
  }

  private cookie(session: TestSession): string {
    return cookieHeader({ [ACCESS_COOKIE]: session.access });
  }
}

/** The token from a link in an email (`…#token=abc`). */
export function tokenFromEmail(text: string): string {
  const match = /#token=([A-Za-z0-9_-]+)/.exec(text);
  if (match?.[1] === undefined) {
    throw new Error(`No token link in email:\n${text}`);
  }
  return match[1];
}
