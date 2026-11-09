import { Body, Controller, Get, Post } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ProblemDetails } from "@opspilot/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { DomainError } from "../shared/domain/domain-error.js";
import { createTestApp } from "../testing/test-app.js";

const CreateThing = z.object({
  name: z.string().min(3),
  schedule: z.object({ endsAt: z.iso.datetime() }),
});
type CreateThing = z.infer<typeof CreateThing>;

/** Routes that exist only in this test, to trigger each kind of error. */
@Controller("test-only")
class TestOnlyController {
  @Post("things")
  create(@Body({ schema: CreateThing }) body: CreateThing): CreateThing {
    return body;
  }

  @Get("conflict")
  conflict(): never {
    throw new DomainError("VERSION_CONFLICT", {
      detail: "Reload the event and try again.",
      extensions: { currentVersion: 7 },
    });
  }

  @Get("crash")
  crash(): never {
    throw new Error("password authentication failed for user opspilot");
  }
}

const PROBLEM_JSON = /^application\/problem\+json/;

describe("HTTP errors", () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ controllers: [TestOnlyController] });
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it("answers an unknown route with a 404 problem", async () => {
    const response = await http().get("/api/v1/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.headers["content-type"]).toMatch(PROBLEM_JSON);
    expect(ProblemDetails.parse(response.body)).toMatchObject({
      type: "/problems/not-found",
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("puts the response's request ID in the problem body", async () => {
    const response = await http().get("/api/v1/does-not-exist");

    const requestId = response.headers["x-request-id"];
    expect(requestId).toEqual(expect.any(String));
    expect(ProblemDetails.parse(response.body).requestId).toBe(requestId);
  });

  it("reuses a safe request ID from the proxy", async () => {
    const response = await http()
      .get("/api/v1/does-not-exist")
      .set("X-Request-Id", "from-proxy-123");

    expect(response.headers["x-request-id"]).toBe("from-proxy-123");
    expect(ProblemDetails.parse(response.body).requestId).toBe(
      "from-proxy-123",
    );
  });

  it("replaces an unsafe request ID", async () => {
    const response = await http()
      .get("/api/v1/does-not-exist")
      .set("X-Request-Id", "x".repeat(500));

    expect(response.headers["x-request-id"]).not.toBe("x".repeat(500));
  });

  it("lists every invalid field of a request body", async () => {
    const response = await http()
      .post("/api/v1/test-only/things")
      .send({ name: "ab", schedule: { endsAt: "tomorrow" } });

    expect(response.status).toBe(400);
    expect(response.headers["content-type"]).toMatch(PROBLEM_JSON);
    const problem = ProblemDetails.parse(response.body);
    expect(problem.code).toBe("VALIDATION_FAILED");
    expect(problem.errors?.map((error) => error.path)).toEqual([
      "name",
      "schedule.endsAt",
    ]);
  });

  it("passes a valid body to the handler", async () => {
    const thing = {
      name: "Launch",
      schedule: { endsAt: "2026-12-01T18:00:00Z" },
    };

    const response = await http().post("/api/v1/test-only/things").send(thing);

    expect(response.status).toBe(201);
    expect(response.body).toEqual(thing);
  });

  it("explains a body that is not valid JSON", async () => {
    const response = await http()
      .post("/api/v1/test-only/things")
      .set("Content-Type", "application/json")
      .send('{"name": ');

    expect(response.status).toBe(400);
    expect(ProblemDetails.parse(response.body)).toMatchObject({
      code: "VALIDATION_FAILED",
      detail: "The request body is not valid JSON.",
    });
  });

  it("refuses a body larger than the limit", async () => {
    const response = await http()
      .post("/api/v1/test-only/things")
      .send({ name: "x".repeat(200_000) });

    expect(response.status).toBe(413);
    expect(ProblemDetails.parse(response.body).code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("answers a domain error with its code, detail and extensions", async () => {
    const response = await http().get("/api/v1/test-only/conflict");

    expect(response.status).toBe(412);
    expect(ProblemDetails.parse(response.body)).toMatchObject({
      code: "VERSION_CONFLICT",
      detail: "Reload the event and try again.",
      currentVersion: 7,
    });
  });

  it("answers an unexpected error with a bare 500 that reveals nothing", async () => {
    const response = await http().get("/api/v1/test-only/crash");

    expect(response.status).toBe(500);
    const problem = ProblemDetails.parse(response.body);
    expect(Object.keys(problem).sort()).toEqual(
      ["code", "requestId", "status", "title", "type"].sort(),
    );
    expect(response.text).not.toContain("password");
  });

  it("sends security headers and hides the framework", async () => {
    const response = await http().get("/api/v1/health/live");

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers).not.toHaveProperty("x-powered-by");
  });
});
