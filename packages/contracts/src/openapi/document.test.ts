import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildOpenApiDocument } from "./document.js";
import { ROUTES } from "./routes.js";

/** Committed, so API changes show in pull-request diffs (docs/04, section 7). */
const COMMITTED = new URL("../../../../docs/openapi.json", import.meta.url);

const serialised = `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;

/** Every `$ref` in a value, however deep. */
function refs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refs);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, inner]) =>
    key === "$ref" && typeof inner === "string" ? [inner] : refs(inner),
  );
}

describe("the OpenAPI document", () => {
  it("is the committed docs/openapi.json (npm run contracts:openapi updates it)", () => {
    if (process.env.UPDATE_OPENAPI === "1")
      writeFileSync(COMMITTED, serialised);
    expect(readFileSync(COMMITTED, "utf8")).toBe(serialised);
  });

  it("has one operation per route, each with its own operationId", () => {
    const document = JSON.parse(serialised) as {
      paths: Record<string, Record<string, unknown>>;
    };
    const operations = Object.values(document.paths).flatMap((methods) =>
      Object.keys(methods),
    );
    expect(operations).toHaveLength(ROUTES.length);
    const ids = ROUTES.map((route) => route.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names every path parameter the path has, and no other", () => {
    for (const route of ROUTES) {
      const inPath = [...route.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      expect(Object.keys(route.params ?? {}).sort(), route.path).toEqual(
        inPath.sort(),
      );
    }
  });

  it("refers only to components it defines", () => {
    const document = JSON.parse(serialised) as {
      components: Record<string, Record<string, unknown>>;
    };
    for (const ref of refs(document)) {
      const [, , section = "", name = ""] = ref.split("/");
      expect(document.components[section]?.[name], ref).toBeDefined();
    }
  });
});
