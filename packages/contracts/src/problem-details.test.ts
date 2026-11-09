import { describe, expect, it } from "vitest";

import { ProblemDetails } from "./problem-details.js";

const validationProblem = {
  type: "/problems/validation-failed",
  title: "The request is not valid",
  status: 400,
  code: "VALIDATION_FAILED",
  requestId: "01JD3W9Y6K0X2M7P8Q4R5S6T7V",
  errors: [
    { path: "endsAt", code: "too_small", message: "End must be after start." },
  ],
};

describe("ProblemDetails", () => {
  it("accepts a validation problem with field errors", () => {
    expect(ProblemDetails.parse(validationProblem)).toEqual(validationProblem);
  });

  it("keeps extension members, as RFC 9457 allows", () => {
    const withExtension = {
      ...validationProblem,
      blockers: [{ criterion: "STREAM_REACHABLE" }],
    };

    expect(ProblemDetails.parse(withExtension)).toHaveProperty("blockers");
  });

  it("rejects a body without a code, so clients can always switch on it", () => {
    const { code: _code, ...withoutCode } = validationProblem;

    expect(ProblemDetails.safeParse(withoutCode).success).toBe(false);
  });

  it.each([200, 302, 600, 400.5])("rejects status %s", (status) => {
    expect(
      ProblemDetails.safeParse({ ...validationProblem, status }).success,
    ).toBe(false);
  });

  it("rejects a malformed field error", () => {
    const malformed = { ...validationProblem, errors: [{ path: "endsAt" }] };

    expect(ProblemDetails.safeParse(malformed).success).toBe(false);
  });
});
