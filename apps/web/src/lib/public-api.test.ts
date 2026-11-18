import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/testing/server";

import { postPublic } from "./public-api";

describe("postPublic", () => {
  it("starts a trace with each call, with a body or without (ADR-0011)", async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.post("*/api/v1/public/anything", ({ request }) => {
        seen.push(request.headers.get("traceparent"));
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await postPublic("/public/anything", { a: 1 });
    await postPublic("/public/anything");

    expect(seen).toHaveLength(2);
    for (const header of seen) {
      expect(header).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    }
  });
});
