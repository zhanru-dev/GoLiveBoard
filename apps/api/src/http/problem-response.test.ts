import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from "@nestjs/common";
import { ProblemDetails } from "@opspilot/contracts";
import { describe, expect, it } from "vitest";

import { DomainError } from "../shared/domain/domain-error.js";
import { toProblemResponse } from "./problem-response.js";
import { RequestValidationError } from "./request-validation.js";

const REQUEST_ID = "req-1";

describe("toProblemResponse", () => {
  it("maps a domain error to its code, title and status", () => {
    const response = toProblemResponse(
      new DomainError("VERSION_CONFLICT", { detail: "Reload and try again." }),
      REQUEST_ID,
    );

    expect(response).toEqual({
      status: 412,
      unexpected: false,
      body: {
        type: "/problems/version-conflict",
        title: "The resource has changed since you loaded it",
        status: 412,
        code: "VERSION_CONFLICT",
        detail: "Reload and try again.",
        requestId: REQUEST_ID,
      },
    });
  });

  it("adds a domain error's extension members", () => {
    const { body } = toProblemResponse(
      new DomainError("FORBIDDEN", { extensions: { requiredRole: "OWNER" } }),
      REQUEST_ID,
    );

    expect(body).toMatchObject({ code: "FORBIDDEN", requiredRole: "OWNER" });
  });

  it("reports a domain error's field errors like a validation failure", () => {
    const errors = [
      { path: "endsAt", code: "custom", message: "End must be after start." },
    ];
    const { status, body } = toProblemResponse(
      new DomainError("VALIDATION_FAILED", { errors }),
      REQUEST_ID,
    );

    expect(status).toBe(400);
    expect(body).toMatchObject({ code: "VALIDATION_FAILED", errors });
  });

  it("never lets extension members replace standard members", () => {
    const { body } = toProblemResponse(
      new DomainError("FORBIDDEN", {
        extensions: { status: 200, code: "OK", requestId: "forged" },
      }),
      REQUEST_ID,
    );

    expect(body).toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      requestId: REQUEST_ID,
    });
  });

  it("drops extension members named like optional standard members", () => {
    const { body } = toProblemResponse(
      new DomainError("FORBIDDEN", {
        extensions: {
          detail: 123,
          errors: "not-a-list",
          instance: "/x",
          ok: 1,
        },
      }),
      REQUEST_ID,
    );

    expect(body).not.toHaveProperty("detail");
    expect(body).not.toHaveProperty("errors");
    expect(body).not.toHaveProperty("instance");
    expect(body).toHaveProperty("ok", 1);
    expect(ProblemDetails.safeParse(body).success).toBe(true);
  });

  it("lists field errors for a validation failure", () => {
    const fieldErrors = [
      { path: "name", code: "too_small", message: "Too short" },
    ];

    const { status, body } = toProblemResponse(
      new RequestValidationError(fieldErrors),
      REQUEST_ID,
    );

    expect(status).toBe(400);
    expect(body).toMatchObject({
      code: "VALIDATION_FAILED",
      errors: fieldErrors,
    });
  });

  it("maps the framework's 404 for unknown routes", () => {
    const { status, body } = toProblemResponse(
      new NotFoundException("Cannot GET /nope"),
      REQUEST_ID,
    );

    expect(status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
    expect(body).not.toHaveProperty("detail");
  });

  it("maps a framework 400 to a validation failure", () => {
    expect(
      toProblemResponse(new BadRequestException(), REQUEST_ID).body.code,
    ).toBe("VALIDATION_FAILED");
  });

  // NestJS wraps body-parser errors in an HttpException, keeping the original
  // as `cause`; these tests build them the same way.
  it("explains a malformed JSON body", () => {
    const parseError = Object.assign(new SyntaxError("Unexpected token"), {
      type: "entity.parse.failed",
    });
    const wrapped = new BadRequestException(parseError.message, {
      cause: parseError,
    });

    expect(toProblemResponse(wrapped, REQUEST_ID).body).toMatchObject({
      code: "VALIDATION_FAILED",
      detail: "The request body is not valid JSON.",
    });
  });

  it("maps a body that is too large", () => {
    const tooLarge = new HttpException("request entity too large", 413);

    expect(toProblemResponse(tooLarge, REQUEST_ID)).toMatchObject({
      status: 413,
      body: { code: "PAYLOAD_TOO_LARGE" },
    });
  });

  it("maps an unsupported character set or encoding to 415", () => {
    const unsupported = new HttpException('unsupported charset "LATIN1"', 415);

    expect(toProblemResponse(unsupported, REQUEST_ID)).toMatchObject({
      status: 415,
      body: { code: "UNSUPPORTED_MEDIA_TYPE" },
    });
  });

  it("does not trust a status on errors that are not HTTP exceptions", () => {
    const upstream = Object.assign(new Error("Upstream said 404"), {
      status: 404,
    });

    expect(toProblemResponse(upstream, REQUEST_ID).status).toBe(500);
  });

  it("treats a framework status without a code of its own as unexpected", () => {
    expect(
      toProblemResponse(new ConflictException(), REQUEST_ID),
    ).toMatchObject({ status: 500, unexpected: true });
  });

  it("hides the message of unexpected errors", () => {
    const response = toProblemResponse(
      new Error("password authentication failed for user opspilot"),
      REQUEST_ID,
    );

    expect(response.unexpected).toBe(true);
    expect(response.body).toEqual({
      type: "/problems/internal-error",
      title: "Something went wrong on our side",
      status: 500,
      code: "INTERNAL_ERROR",
      requestId: REQUEST_ID,
    });
  });

  it.each([
    new DomainError("NOT_FOUND"),
    new RequestValidationError([]),
    new NotFoundException(),
    new Error("boom"),
    "a thrown string",
    undefined,
  ])("always produces a valid problem body (%#)", (error) => {
    const { body } = toProblemResponse(error, REQUEST_ID);

    expect(ProblemDetails.safeParse(body).success).toBe(true);
  });
});
