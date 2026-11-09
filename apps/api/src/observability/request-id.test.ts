import { describe, expect, it } from "vitest";

import { resolveRequestId } from "./request-id.js";

const generate = () => "generated";

describe("resolveRequestId", () => {
  it.each(["01JD3W9Y6K0X2M7P8Q4R5S6T7V", "a1b2-c3d4", "trace.id_1"])(
    "keeps the safe incoming ID %j",
    (incoming) => {
      expect(resolveRequestId(incoming, generate)).toBe(incoming);
    },
  );

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["containing a newline", "abc\ninjected"],
    ["containing spaces", "abc def"],
    ["longer than 128 characters", "a".repeat(129)],
    ["sent twice", ["one", "two"]],
  ])("generates a new ID when the incoming one is %s", (_case, incoming) => {
    expect(resolveRequestId(incoming, generate)).toBe("generated");
  });

  it("generates UUIDs by default", () => {
    expect(resolveRequestId(undefined)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
