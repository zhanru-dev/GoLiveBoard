/** Where to go after signing in when no `next` is given. */
export const APP_HOME = "/settings/team";

/**
 * The page to return to after signing in, from the `next` query parameter.
 * Only paths on this site are accepted, so a crafted link cannot send the
 * user to another site after they sign in (an open redirect).
 */
export function safeNext(next: string | null): string {
  if (next === null || !next.startsWith("/") || next.startsWith("//")) {
    return APP_HOME;
  }
  return next;
}
