import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { server } from "@/testing/server";

import {
  api,
  ApiError,
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
      "opspilot:refresh-session",
      expect.any(Function),
    );
  });
});
