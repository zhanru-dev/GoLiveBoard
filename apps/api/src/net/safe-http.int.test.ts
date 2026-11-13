import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TestStream } from "../testing/test-stream.js";
import { isPublicAddress } from "./address-policy.js";
import {
  SafeHttpClient,
  SafeHttpError,
  type SafeHttpFailure,
} from "./safe-http.js";

async function failureOf(work: Promise<unknown>): Promise<SafeHttpFailure> {
  try {
    await work;
  } catch (error) {
    if (error instanceof SafeHttpError) {
      return error.reason;
    }
    throw error;
  }
  throw new Error("Expected the fetch to fail");
}

describe("SafeHttpClient (SSRF protection)", () => {
  let stream: TestStream;
  let client: SafeHttpClient;

  beforeAll(async () => {
    stream = await TestStream.start();
    client = new SafeHttpClient(stream.clientOptions());
  });

  afterAll(async () => {
    await stream.stop();
  });

  it("fetches a manifest from an allowed host", async () => {
    stream.behaviour = "OK";

    const response = await client.get(stream.url());

    expect(response.status).toBe(200);
    expect(response.body.startsWith("#EXTM3U")).toBe(true);
  });

  it("refuses loopback under the production rule, before connecting", async () => {
    const strict = new SafeHttpClient(
      stream.clientOptions({ isAllowedAddress: isPublicAddress }),
    );
    const before = stream.requests;

    expect(await failureOf(strict.get(stream.url()))).toBe(
      "ADDRESS_NOT_ALLOWED",
    );
    expect(stream.requests).toBe(before);
  });

  it.each([
    ["a private address", "private.test"],
    ["the cloud metadata address", "metadata.test"],
    ["a name with one private address among public ones", "mixed.test"],
  ])("refuses a host that resolves to %s", async (_label, host) => {
    expect(await failureOf(client.get(`https://${host}/index.m3u8`))).toBe(
      "ADDRESS_NOT_ALLOWED",
    );
  });

  it.each([
    ["a private IPv4 literal", "https://10.0.0.1/index.m3u8"],
    ["a loopback IPv6 literal", "https://[::1]/index.m3u8"],
    ["the metadata address", "https://169.254.169.254/latest/meta-data/"],
  ])("refuses %s", async (_label, url) => {
    const strict = new SafeHttpClient(
      stream.clientOptions({ isAllowedAddress: isPublicAddress }),
    );
    expect(await failureOf(strict.get(url))).toBe("ADDRESS_NOT_ALLOWED");
  });

  it.each([
    ["http", "http://stream.test/index.m3u8"],
    ["credentials", "https://user:pw@stream.test/index.m3u8"],
    ["garbage", "not a url"],
  ])("refuses a URL with %s", async (_label, url) => {
    expect(await failureOf(client.get(url))).toBe("INVALID_URL");
  });

  it("reports a host that does not resolve", async () => {
    expect(await failureOf(client.get("https://nowhere.test/x.m3u8"))).toBe(
      "DNS_FAILED",
    );
  });

  it("follows a redirect to an allowed host", async () => {
    stream.behaviour = "OK";
    const target = encodeURIComponent(stream.url());

    const response = await client.get(stream.url(`/redirect?to=${target}`));

    expect(response.status).toBe(200);
    expect(response.url).toBe(stream.url());
  });

  it("checks every redirect target: a redirect to the metadata address is refused", async () => {
    const target = encodeURIComponent(
      "https://169.254.169.254/latest/meta-data/",
    );

    expect(
      await failureOf(client.get(stream.url(`/redirect?to=${target}`))),
    ).toBe("ADDRESS_NOT_ALLOWED");
  });

  it("refuses a redirect to plain http", async () => {
    const target = encodeURIComponent("http://stream.test/index.m3u8");

    expect(
      await failureOf(client.get(stream.url(`/redirect?to=${target}`))),
    ).toBe("INVALID_URL");
  });

  it("stops after three redirects", async () => {
    let url = stream.url();
    for (let hop = 0; hop < 4; hop += 1) {
      url = stream.url(`/redirect?to=${encodeURIComponent(url)}`);
    }

    expect(await failureOf(client.get(url))).toBe("TOO_MANY_REDIRECTS");
  });

  it("gives up at the deadline", async () => {
    stream.behaviour = "HANG";

    expect(await failureOf(client.get(stream.url()))).toBe("TIMEOUT");
    stream.behaviour = "OK";
  });

  it("counts a slow DNS answer against the deadline, and cancels it", async () => {
    let aborted = false;
    const hanging = new SafeHttpClient(
      stream.clientOptions({
        timeoutMs: 100,
        resolve: (_hostname, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              aborted = true;
              reject(new Error("cancelled"));
            });
          }),
      }),
    );

    const started = performance.now();
    expect(await failureOf(hanging.get(stream.url()))).toBe("TIMEOUT");
    expect(await failureOf(hanging.assertFetchable(stream.url()))).toBe(
      "TIMEOUT",
    );
    // Both gave up at their deadline, not when DNS finally answered.
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(aborted).toBe(true);
  });

  it("refuses to buffer more than 1 MB", async () => {
    stream.behaviour = "HUGE";

    expect(await failureOf(client.get(stream.url()))).toBe("TOO_LARGE");
    stream.behaviour = "OK";
  });

  it("refuses a certificate it does not trust", async () => {
    const { ca: _ca, ...withoutCa } = stream.clientOptions();
    const untrusting = new SafeHttpClient(withoutCa);

    expect(await failureOf(untrusting.get(stream.url()))).toBe(
      "CONNECTION_FAILED",
    );
  });
});
