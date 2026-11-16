/**
 * A URL as the audit trail may keep it (FR-RC-1: no secrets): scheme, host,
 * port and path. Credentials and the query string are dropped, since stream
 * URLs often carry access tokens there; a dropped query is marked `?…`.
 */
export function auditableUrl(url: string | null): string | null {
  if (url === null) {
    return null;
  }
  const parsed = URL.parse(url);
  if (parsed === null) {
    return "(not a URL)";
  }
  return `${parsed.origin}${parsed.pathname}${parsed.search === "" ? "" : "?…"}`;
}
