import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import {
  ERROR_REPORTING_META,
  errorReportingOrigin,
  errorReportingSettings,
  errorReportingSettingsFromPage,
  scrubEvent,
  sentryOptions,
} from "./error-reporting";

const DSN = "https://public@o1.ingest.sentry.io/2";

/** A document whose head holds the given meta content. */
function pageWith(content: string | null): Pick<Document, "querySelector"> {
  const document = new DOMParser().parseFromString(
    content === null
      ? "<head></head>"
      : `<head><meta name="${ERROR_REPORTING_META}"></head>`,
    "text/html",
  );
  if (content !== null) {
    document.querySelector("meta")?.setAttribute("content", content);
  }
  return document;
}

describe("errorReportingSettings", () => {
  it("reads the DSN, environment and release from the environment", () => {
    expect(
      errorReportingSettings({
        SENTRY_DSN: DSN,
        SENTRY_ENVIRONMENT: "demo",
        SENTRY_RELEASE: "3f2a9c1",
        NODE_ENV: "production",
      }),
    ).toEqual({ dsn: DSN, environment: "demo", release: "3f2a9c1" });
  });

  it("falls back to NODE_ENV for the environment", () => {
    expect(
      errorReportingSettings({ SENTRY_DSN: DSN, NODE_ENV: "production" }),
    ).toEqual({ dsn: DSN, environment: "production", release: undefined });
  });

  it.each([
    ["unset", {}],
    ["empty, as Compose passes an unset variable", { SENTRY_DSN: "" }],
    ["not a URL", { SENTRY_DSN: "not a dsn" }],
  ])("is off when the DSN is %s", (_case, env) => {
    expect(errorReportingSettings(env)).toBeNull();
  });
});

describe("errorReportingSettingsFromPage", () => {
  it("reads the settings the server put in the page", () => {
    const settings = { dsn: DSN, environment: "demo", release: "3f2a9c1" };

    expect(
      errorReportingSettingsFromPage(pageWith(JSON.stringify(settings))),
    ).toEqual(settings);
  });

  it.each([
    ["no tag", null],
    ["malformed JSON", "{"],
    ["an invalid DSN", JSON.stringify({ dsn: "x", environment: "demo" })],
  ])("is off when the page has %s", (_case, content) => {
    expect(errorReportingSettingsFromPage(pageWith(content))).toBeNull();
  });
});

describe("errorReportingOrigin", () => {
  it("is the DSN's origin, without the key or project", () => {
    expect(errorReportingOrigin({ dsn: DSN, environment: "production" })).toBe(
      "https://o1.ingest.sentry.io",
    );
  });

  it("is null when reporting is off", () => {
    expect(errorReportingOrigin(null)).toBeNull();
  });
});

describe("sentryOptions", () => {
  it("collects nothing personal and keeps no breadcrumbs", () => {
    const options = sentryOptions(
      { dsn: DSN, environment: "production" },
      "browser",
    );

    expect(options).toMatchObject({
      maxBreadcrumbs: 0,
      beforeSend: scrubEvent,
      initialScope: { tags: { process: "browser" } },
    });
    expect(options.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
    });
  });
});

describe("scrubEvent", () => {
  it("keeps only the method and path, dropping a token in the query or the fragment", () => {
    const event: ErrorEvent = {
      type: undefined,
      request: {
        url: "https://opspilot.example/reset-password?next=%2Fevents#token=one-time",
        headers: { Referer: "https://opspilot.example/sign-in?x=1" },
      },
    };

    expect(scrubEvent(event).request).toEqual({
      method: undefined,
      url: "https://opspilot.example/reset-password",
    });
  });

  it("drops a token in the fragment of a link that has no query", () => {
    const event: ErrorEvent = {
      type: undefined,
      request: {
        method: "GET",
        url: "https://opspilot.example/accept-invitation#token=one-time",
      },
    };

    expect(scrubEvent(event).request).toEqual({
      method: "GET",
      url: "https://opspilot.example/accept-invitation",
    });
  });

  it("drops user details and the values of local variables", () => {
    const event: ErrorEvent = {
      type: undefined,
      user: { email: "ada@example.com" },
      exception: {
        values: [
          {
            stacktrace: {
              frames: [{ function: "submit", vars: { password: "hunter2" } }],
            },
          },
        ],
      },
    };

    const scrubbed = scrubEvent(event);

    expect(scrubbed).not.toHaveProperty("user");
    expect(scrubbed.exception?.values?.[0]?.stacktrace?.frames).toEqual([
      { function: "submit" },
    ]);
  });
});
