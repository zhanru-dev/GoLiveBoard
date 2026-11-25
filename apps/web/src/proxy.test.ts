import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { proxy } from "./proxy";

function directives(path = "/events"): Map<string, string> {
  const policy =
    proxy(new NextRequest(`http://localhost:3300${path}`)).headers.get(
      "Content-Security-Policy",
    ) ?? "";
  return new Map(
    policy.split("; ").map((directive) => {
      const [name = "", ...values] = directive.split(" ");
      return [name, values.join(" ")];
    }),
  );
}

describe("proxy (Content Security Policy)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lets the page upload to and show images from object storage", () => {
    vi.stubEnv("S3_PUBLIC_ENDPOINT", "https://assets.example.com/bucket");

    const policy = directives();

    expect(policy.get("connect-src")).toContain("https://assets.example.com");
    expect(policy.get("img-src")).toContain("https://assets.example.com");
    expect(policy.get("connect-src")).not.toContain("/bucket");
  });

  it.each([undefined, "not a url"])(
    "allows only the page's own origin when the storage endpoint is %j",
    (endpoint) => {
      if (endpoint !== undefined) {
        vi.stubEnv("S3_PUBLIC_ENDPOINT", endpoint);
      }

      expect(directives().get("connect-src")).toBe("'self'");
    },
  );

  it("lets the page report errors to Sentry when it is configured", () => {
    vi.stubEnv("SENTRY_DSN", "https://public@o1.ingest.sentry.io/2");

    expect(directives().get("connect-src")).toBe(
      "'self' https://o1.ingest.sentry.io",
    );
  });

  it.each(["", "not a dsn"])(
    "allows no reporting origin when the DSN is %j",
    (dsn) => {
      vi.stubEnv("SENTRY_DSN", dsn);

      expect(directives().get("connect-src")).toBe("'self'");
    },
  );

  it("gives every response a fresh script nonce", () => {
    const first = directives().get("script-src");
    const second = directives().get("script-src");

    expect(first).toMatch(/'nonce-[^']+'/);
    expect(first).not.toBe(second);
  });

  it("lets only the watch page play a stream from another origin", () => {
    const watch = directives("/e/product-launch-k3x9/watch");
    const page = directives("/e/product-launch-k3x9");

    expect(watch.get("connect-src")).toBe("'self' https:");
    expect(watch.get("media-src")).toBe("'self' blob: https:");
    expect(page.get("connect-src")).toBe("'self'");
    expect(page.get("media-src")).toBe("'self'");
    expect(directives("/e/x/watch/more").get("media-src")).toBe("'self'");
  });
});
