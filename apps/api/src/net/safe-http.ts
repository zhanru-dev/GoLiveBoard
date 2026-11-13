import { lookup as dnsLookup } from "node:dns/promises";
import { request, type RequestOptions } from "node:https";
import type { IncomingMessage } from "node:http";
import { isIP, type LookupFunction } from "node:net";

import { isPublicAddress } from "./address-policy.js";

/** Longest a whole fetch may take, redirects included. */
export const FETCH_TIMEOUT_MS = 5_000;
/** HLS master and media playlists are a few kilobytes; more means a wrong URL. */
export const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
const USER_AGENT = "OpsPilot-StreamCheck/1.0";

/** Why a fetch did not produce a response. Messages are safe to show staff. */
export type SafeHttpFailure =
  | "INVALID_URL"
  | "DNS_FAILED"
  | "ADDRESS_NOT_ALLOWED"
  | "CONNECTION_FAILED"
  | "TIMEOUT"
  | "TOO_LARGE"
  | "TOO_MANY_REDIRECTS";

export class SafeHttpError extends Error {
  override readonly name = "SafeHttpError";

  constructor(
    readonly reason: SafeHttpFailure,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

/** What the client may depend on; tests replace DNS and the address rule. */
export interface SafeHttpOptions {
  /** Every address a host name resolves to. */
  readonly resolve: (hostname: string) => Promise<ResolvedAddress[]>;
  /** Whether an outbound connection may go to this address. */
  readonly isAllowedAddress: (address: string) => boolean;
  /** Extra trusted certificate authorities (tests use a self-signed one). */
  readonly ca?: string;
  /** Overrides FETCH_TIMEOUT_MS, so tests of the deadline run quickly. */
  readonly timeoutMs?: number;
}

export const SAFE_HTTP_OPTIONS = Symbol("SAFE_HTTP_OPTIONS");

export const defaultSafeHttpOptions: SafeHttpOptions = {
  resolve: async (hostname) =>
    (await dnsLookup(hostname, { all: true, order: "verbatim" })).map(
      ({ address, family }) => ({ address, family: family === 6 ? 6 : 4 }),
    ),
  isAllowedAddress: isPublicAddress,
};

export interface SafeResponse {
  readonly status: number;
  readonly body: string;
  /** The URL that answered, after redirects. */
  readonly url: string;
}

/**
 * Outbound HTTPS for URLs that customers supply (stream manifests now,
 * webhooks later). It refuses to reach internal addresses (SSRF):
 *
 * - only `https`, never credentials in the URL;
 * - the host is resolved first and **every** address must be allowed, so a
 *   name with one public and one private record is refused;
 * - the connection goes to the address that was checked (a custom `lookup`),
 *   so a second DNS answer cannot swap in a private address (DNS rebinding);
 * - redirects are followed only a few times, and each target is checked the
 *   same way;
 * - a deadline and a size cap bound what one fetch can cost.
 */
export class SafeHttpClient {
  constructor(private readonly options: SafeHttpOptions) {}

  /**
   * Checks that a URL could be fetched: https, and a host that resolves only
   * to allowed addresses. Used when the URL is saved, for a clear error.
   *
   * @throws SafeHttpError when it could not
   */
  async assertFetchable(url: string): Promise<void> {
    await this.resolveAllowed(parseHttpsUrl(url));
  }

  /** Fetches a URL with GET. @throws SafeHttpError when no response arrived */
  async get(url: string): Promise<SafeResponse> {
    const timeoutMs = this.options.timeoutMs ?? FETCH_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    let current = parseHttpsUrl(url);
    for (let redirects = 0; ; redirects += 1) {
      const address = await this.resolveAllowed(current);
      const response = await this.fetchOnce(
        current,
        address,
        deadline,
        timeoutMs,
      );
      const location = response.location;
      if (!isRedirect(response.status) || location === undefined) {
        return {
          status: response.status,
          body: response.body,
          url: current.href,
        };
      }
      if (redirects === MAX_REDIRECTS) {
        throw new SafeHttpError(
          "TOO_MANY_REDIRECTS",
          `More than ${String(MAX_REDIRECTS)} redirects`,
        );
      }
      current = parseHttpsUrl(new URL(location, current).href);
    }
  }

  private async resolveAllowed(url: URL): Promise<ResolvedAddress> {
    // URL keeps IPv6 literals in brackets: "[::1]".
    const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
    const literal = isIP(host);
    let addresses: ResolvedAddress[];
    if (literal === 0) {
      try {
        addresses = await this.options.resolve(host);
      } catch (error) {
        throw new SafeHttpError("DNS_FAILED", `Could not resolve ${host}`, {
          cause: error,
        });
      }
    } else {
      addresses = [{ address: host, family: literal === 6 ? 6 : 4 }];
    }
    const [first] = addresses;
    if (first === undefined) {
      throw new SafeHttpError("DNS_FAILED", `Could not resolve ${host}`);
    }
    if (
      !addresses.every(({ address }) => this.options.isAllowedAddress(address))
    ) {
      throw new SafeHttpError(
        "ADDRESS_NOT_ALLOWED",
        `${host} resolves to an address that is not on the public internet`,
      );
    }
    return first;
  }

  private fetchOnce(
    url: URL,
    address: ResolvedAddress,
    deadline: number,
    timeoutMs: number,
  ): Promise<{ status: number; body: string; location?: string }> {
    // The socket connects to the address checked above, whatever DNS says now.
    const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
      if (options.all === true) {
        callback(null, [address]);
      } else {
        callback(null, address.address, address.family);
      }
    };
    const options: RequestOptions = {
      method: "GET",
      lookup: pinnedLookup,
      headers: {
        accept: "application/vnd.apple.mpegurl, application/x-mpegurl, */*",
        "user-agent": USER_AGENT,
      },
      ...(this.options.ca !== undefined && { ca: this.options.ca }),
    };
    return new Promise((resolve, reject) => {
      const outgoing = request(url, options, (response) => {
        readBody(response).then(
          (body) => {
            resolve({
              status: response.statusCode ?? 0,
              body,
              ...(typeof response.headers.location === "string" && {
                location: response.headers.location,
              }),
            });
          },
          (error: unknown) => {
            outgoing.destroy();
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        );
      });
      const timer = setTimeout(
        () => {
          outgoing.destroy(
            new SafeHttpError(
              "TIMEOUT",
              `Timed out after ${String(timeoutMs / 1000)} seconds`,
            ),
          );
        },
        Math.max(0, deadline - Date.now()),
      );
      outgoing.on("close", () => {
        clearTimeout(timer);
      });
      outgoing.on("error", (error) => {
        reject(
          error instanceof SafeHttpError
            ? error
            : new SafeHttpError("CONNECTION_FAILED", connectionMessage(error), {
                cause: error,
              }),
        );
      });
      outgoing.end();
    });
  }
}

function parseHttpsUrl(value: string): URL {
  const url = URL.parse(value);
  if (url?.protocol !== "https:") {
    throw new SafeHttpError("INVALID_URL", "Only https:// URLs can be fetched");
  }
  if (url.username !== "" || url.password !== "") {
    throw new SafeHttpError(
      "INVALID_URL",
      "URLs with a user name or password are not fetched",
    );
  }
  return url;
}

function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

/** Reads the body as text, refusing to buffer more than the cap. */
function readBody(response: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    response.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) {
        response.destroy();
        reject(
          new SafeHttpError("TOO_LARGE", "The response is larger than 1 MB"),
        );
        return;
      }
      chunks.push(chunk);
    });
    response.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    response.on("error", reject);
  });
}

/** A short, safe description of a socket or TLS error. */
function connectionMessage(error: Error): string {
  const code =
    "code" in error && typeof error.code === "string" ? error.code : "";
  if (
    code.startsWith("ERR_TLS") ||
    code.includes("CERT") ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT"
  ) {
    return "The TLS certificate could not be verified";
  }
  if (code === "ECONNREFUSED") {
    return "The connection was refused";
  }
  if (code === "ECONNRESET") {
    return "The connection was reset";
  }
  return "The connection failed";
}
