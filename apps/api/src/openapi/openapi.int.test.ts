import type { NestExpressApplication } from "@nestjs/platform-express";
import { buildOpenApiDocument } from "@goliveboard/contracts/openapi";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { createTestApp } from "../testing/test-app.js";

describe("GET /api/v1/openapi.json", () => {
  let app: NestExpressApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("serves the generated document without a session", async () => {
    app = await createTestApp();
    const response = await request(app.getHttpServer()).get(
      "/api/v1/openapi.json",
    );

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^application\/json/);
    expect(response.headers["cache-control"]).toBe("public, max-age=300");
    expect(response.body).toEqual(buildOpenApiDocument());
  });
});
