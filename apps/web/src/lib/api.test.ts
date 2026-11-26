import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { server } from "@/testing/server";

import {
  api,
  ApiError,
  apiText,
  refreshSession,
  SignedOutError,
  WorkspaceChangedError,
} from "./api";

const WORKSPACE_ID = "0195f0a0-0000-7000-8000-0000000000aa";

function problem(status: number, code: string) {
  return HttpResponse.json(
    { type: "about:blank", title: code, status, code, requestId: "req-1" },
    { status },
  );
}

describe("api", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "locks");
  });

  it("starts a trace with each call (ADR-0011)", async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get("*/api/v1/events/e1", ({ request }) => {
        seen.push(request.headers.get("traceparent"));
        return HttpResponse.json({});
      }),
    );

    await api("/events/e1");
    await api("/events/e1");

    expect(seen[0]).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(seen[1]).not.toBe(seen[0]);
  });

  it("sends the version a change is based on and the idempotency key", async () => {
    let headers: Headers | undefined;
    server.use(
      http.patch("*/api/v1/events/e1", ({ request }) => {
        headers = request.headers;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await api("/events/e1", {
      method: "PATCH",
      body: {},
      ifMatch: 3,
      idempotencyKey: "0195f0a0-0000-7000-8000-0000000000ff",
    });

    expect(headers?.get("if-match")).toBe('"3"');
    expect(headers?.get("idempotency-key")).toBe(
      "0195f0a0-0000-7000-8000-0000000000ff",
    );
  });

  it("names the workspace the page shows, so the API can refuse another", async () => {
    let header: string | null = null;
    server.use(
      http.get("*/api/v1/workspace/members", ({ request }) => {
        header = request.headers.get("x-workspace-id");
        return HttpResponse.json([]);
      }),
    );

    await api("/workspace/members", {
      schema: z.array(z.unknown()),
      workspaceId: WORKSPACE_ID,
    });

    expect(header).toBe(WORKSPACE_ID);
  });

  it("reports a workspace switched elsewhere as WorkspaceChangedError", async () => {
    server.use(
      http.get("*/api/v1/workspace/members", () =>
        problem(409, "WORKSPACE_CHANGED"),
      ),
    );

    await expect(
      api("/workspace/members", { workspaceId: WORKSPACE_ID }),
    ).rejects.toBeInstanceOf(WorkspaceChangedError);
  });

  it("reports other failures as ApiError with the problem details", async () => {
    server.use(http.get("*/api/v1/workspace", () => problem(403, "FORBIDDEN")));

    const error: unknown = await api("/workspace").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).problem.code).toBe("FORBIDDEN");
  });

  it("refreshes once for several requests that find the session expired", async () => {
    let refreshes = 0;
    let signedIn = false;
    server.use(
      http.post("*/api/v1/auth/refresh", () => {
        refreshes += 1;
        signedIn = true;
        return new HttpResponse(null, { status: 204 });
      }),
      http.get("*/api/v1/workspace", () =>
        signedIn ? HttpResponse.json({}) : problem(401, "UNAUTHENTICATED"),
      ),
    );

    await Promise.all([
      api("/workspace", { schema: z.object({}) }),
      api("/workspace", { schema: z.object({}) }),
      api("/workspace", { schema: z.object({}) }),
    ]);

    expect(refreshes).toBe(1);
  });

  it("reads a text answer the same way, refreshing an expired session", async () => {
    let signedIn = false;
    server.use(
      http.post("*/api/v1/auth/refresh", () => {
        signedIn = true;
        return new HttpResponse(null, { status: 204 });
      }),
      http.get("*/api/v1/report.csv", () =>
        signedIn
          ? new HttpResponse("metric,value\r\n", {
              headers: { "content-type": "text/csv" },
            })
          : problem(401, "UNAUTHENTICATED"),
      ),
      http.get("*/api/v1/missing.csv", () =>
        problem(409, "REPORT_NOT_AVAILABLE"),
      ),
    );

    expect(await apiText("/report.csv")).toBe("metric,value\r\n");
    await expect(apiText("/missing.csv")).rejects.toBeInstanceOf(ApiError);
  });

  it("gives up with SignedOutError when the refresh fails", async () => {
    server.use(
      http.post("*/api/v1/auth/refresh", () => problem(401, "UNAUTHENTICATED")),
      http.get("*/api/v1/workspace", () => problem(401, "UNAUTHENTICATED")),
    );

    await expect(api("/workspace")).rejects.toBeInstanceOf(SignedOutError);
  });

  it("refreshes while holding a Web Lock, so other tabs wait for the new cookies", async () => {
    const request = vi.fn((_name: string, callback: () => Promise<boolean>) =>
      callback(),
    );
    Object.defineProperty(navigator, "locks", {
      value: { request },
      configurable: true,
    });
    server.use(
      http.post(
        "*/api/v1/auth/refresh",
        () => new HttpResponse(null, { status: 204 }),
      ),
    );

    await expect(refreshSession()).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith(
      "goliveboard:refresh-session",
      expect.any(Function),
    );
  });
});
