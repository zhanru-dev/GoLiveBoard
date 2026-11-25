import type { NestExpressApplication } from "@nestjs/platform-express";
import { AccessPolicy, type EventDetail } from "@opspilot/contracts";
import request from "supertest";

import { ATTENDEE_COOKIE } from "../attendees/attendee-cookies.js";
import type { ApiClient, TestSession } from "./api-client.js";
import { setCookies } from "./cookies.js";
import { createEvent, LAUNCH } from "./events.js";
import { TEST_ORIGIN } from "./test-app.js";

export const NOTICE = "2026-11";

export interface PolicyBody {
  readonly mode: "PUBLIC" | "EMAIL_DOMAIN" | "INVITE_ONLY";
  readonly allowedDomains?: readonly string[];
}

/**
 * An event in CONFIGURING with the given access policy: public and open for
 * registration. Fails the test if any step fails.
 */
export async function openEvent(
  api: ApiClient,
  owner: TestSession,
  policy: PolicyBody = { mode: "PUBLIC" },
  body: object = LAUNCH,
): Promise<EventDetail> {
  const event = await createEvent(api, owner, body);
  const put = await api.send(
    owner,
    "put",
    `/events/${event.id}/access-policy`,
    {
      mode: policy.mode,
      allowedDomains: policy.allowedDomains ?? [],
      privacyNoticeVersion: NOTICE,
    },
  );
  if (put.status !== 200) {
    throw new Error(`Setting the policy failed: ${put.text}`);
  }
  AccessPolicy.parse(put.body);
  const moved = await api.send(
    owner,
    "post",
    `/events/${event.id}/transitions`,
    {
      to: "CONFIGURING",
    },
  );
  if (moved.status !== 200) {
    throw new Error(`Opening the event failed: ${moved.text}`);
  }
  return event;
}

/** A registration body; override what the test is about. */
export const registration = (email: string, overrides: object = {}) => ({
  name: "Ada Lovelace",
  email,
  privacyNoticeVersion: NOTICE,
  consent: true,
  remindersOptIn: true,
  ...overrides,
});

/** Public requests from one client address, with optional cookies. */
export class PublicClient {
  constructor(
    private readonly app: NestExpressApplication,
    readonly address: string,
    private readonly cookies: Record<string, string> = {},
  ) {}

  /** A cookie this client sends, e.g. the attendee session. */
  cookie(name: string): string | undefined {
    return this.cookies[name];
  }

  /** The same address with these cookies too. */
  with(cookies: Record<string, string>): PublicClient {
    return new PublicClient(this.app, this.address, {
      ...this.cookies,
      ...cookies,
    });
  }

  private cookieHeader(): string {
    return Object.entries(this.cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  get(path: string) {
    return request(this.app.getHttpServer())
      .get(`/api/v1${path}`)
      .set("X-Forwarded-For", this.address)
      .set("Cookie", this.cookieHeader());
  }

  post(path: string, body?: object) {
    const call = request(this.app.getHttpServer())
      .post(`/api/v1${path}`)
      .set("Origin", TEST_ORIGIN)
      .set("X-Forwarded-For", this.address)
      .set("Cookie", this.cookieHeader());
    return body === undefined ? call : call.send(body);
  }

  put(path: string) {
    return request(this.app.getHttpServer())
      .put(`/api/v1${path}`)
      .set("Origin", TEST_ORIGIN)
      .set("X-Forwarded-For", this.address)
      .set("Cookie", this.cookieHeader());
  }

  delete(path: string) {
    return request(this.app.getHttpServer())
      .delete(`/api/v1${path}`)
      .set("Origin", TEST_ORIGIN)
      .set("X-Forwarded-For", this.address)
      .set("Cookie", this.cookieHeader());
  }

  register(slug: string, body: object) {
    return this.post(`/public/events/${slug}/registrations`, body);
  }

  /**
   * Uses a verification token; on success returns a client that carries the
   * attendee session cookie.
   */
  async verify(token: string) {
    const response = await this.post("/public/attendee-verifications", {
      token,
    });
    const session = setCookies(response).get(ATTENDEE_COOKIE)?.value;
    return {
      response,
      attendee:
        session === undefined
          ? undefined
          : this.with({ [ATTENDEE_COOKIE]: session }),
    };
  }
}
