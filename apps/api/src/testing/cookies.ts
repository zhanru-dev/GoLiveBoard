import type { Response } from "supertest";

export interface SetCookie {
  readonly name: string;
  readonly value: string;
  /** Attributes in lower case, e.g. `{ path: "/", httponly: "", secure: "" }`. */
  readonly attributes: Readonly<Record<string, string>>;
}

/**
 * The cookies a response sets. Tests send cookies back by hand: supertest's
 * cookie jar would withhold `Secure` cookies over plain HTTP.
 */
export function setCookies(response: Response): Map<string, SetCookie> {
  const header: unknown = response.headers["set-cookie"];
  const lines = Array.isArray(header) ? header.map(String) : [];
  const cookies = new Map<string, SetCookie>();
  for (const line of lines) {
    const [pair = "", ...rest] = line.split(";").map((part) => part.trim());
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator);
    const attributes = Object.fromEntries(
      rest.map((attribute) => {
        const [key = "", value = ""] = attribute.split("=");
        return [key.toLowerCase(), value];
      }),
    );
    cookies.set(name, { name, value: pair.slice(separator + 1), attributes });
  }
  return cookies;
}

/** A `Cookie` request header from name–value pairs. */
export function cookieHeader(values: Readonly<Record<string, string>>): string {
  return Object.entries(values)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}
