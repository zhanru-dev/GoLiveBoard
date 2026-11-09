import { describe, expect, it } from "vitest";
import { z } from "zod";

import { toFieldError } from "./request-validation.js";

describe("toFieldError", () => {
  it("joins nested paths with dots and keeps Zod's code", () => {
    const result = z
      .object({ schedule: z.object({ endsAt: z.iso.datetime() }) })
      .safeParse({ schedule: { endsAt: "tomorrow" } });
    const [issue] = result.error?.issues ?? [];

    expect(issue && toFieldError(issue)).toEqual({
      path: "schedule.endsAt",
      code: "invalid_format",
      message: "Invalid ISO datetime",
    });
  });

  it("accepts path segments given as objects with a key", () => {
    expect(
      toFieldError({
        message: "Required",
        path: [{ key: "tasks" }, 0, "title"],
      }),
    ).toEqual({ path: "tasks.0.title", code: "invalid", message: "Required" });
  });

  it("uses an empty path for problems with the whole value", () => {
    expect(toFieldError({ message: "Expected object" })).toEqual({
      path: "",
      code: "invalid",
      message: "Expected object",
    });
  });
});
