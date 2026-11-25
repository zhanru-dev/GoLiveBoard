import { createHash } from "node:crypto";

/** JSON with object keys sorted, so `{a,b}` and `{b,a}` hash the same. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const members = Object.entries(value)
      .filter(([, member]) => member !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(
        ([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`,
      );
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * SHA-256 of a request body, used to tell a genuine retry (same key, same
 * body) from a mistake (same key, different body). The body is the one the
 * schema returned, so formatting and key order do not matter.
 */
export function hashRequestBody(body: unknown): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}
