/** Where to go after signing in when no `next` is given. */
export const APP_HOME = "/settings/team";

/** Any origin works here: it only gives relative paths something to resolve against. */
const BASE = new URL("https://opspilot.invalid");

/** Backslashes and control characters: browsers repair them into other URLs. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const UNSAFE_CHARACTERS = /[\\\u0000-\u001f\u007f]/;

/**
 * The page to return to after signing in, from the `next` query parameter.
 * Only paths on this site are accepted, so a crafted link cannot send the
 * user to another site after they sign in (an open redirect).
 *
 * Checking the prefix alone is not enough: browsers read `/\evil.example`
 * as `//evil.example`, and they drop tabs and line breaks, so `/\t/evil`
 * becomes `//evil`. The value is therefore resolved the way a browser would
 * and must stay on the same origin; anything containing characters that
 * browsers rewrite is refused outright.
 */
export function safeNext(next: string | null): string {
  if (
    next === null ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    UNSAFE_CHARACTERS.test(next)
  ) {
    return APP_HOME;
  }
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return APP_HOME;
  }
  if (url.origin !== BASE.origin) {
    return APP_HOME;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
