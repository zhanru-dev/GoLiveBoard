import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { Actor } from "../auth/actor.js";
import { RATE_LIMITS, type RateLimiter } from "../rate-limit/rate-limiter.js";
import { DEMO_WORKSPACE } from "./demo-accounts.js";
import { DemoWriteBudgetGuard } from "./demo-write-budget.guard.js";

function contextFor(method: string, actor: Partial<Actor> | undefined) {
  const request = { method, ip: "198.51.100.7", actor };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function guardWith(consumeOrThrow = vi.fn(() => Promise.resolve())) {
  const guard = new DemoWriteBudgetGuard({
    consumeOrThrow,
  } as unknown as RateLimiter);
  return { guard, consumeOrThrow };
}

describe("DemoWriteBudgetGuard", () => {
  it("counts a change to the demo workspace per address and for the workspace", async () => {
    const { guard, consumeOrThrow } = guardWith();

    await expect(
      guard.canActivate(
        contextFor("PATCH", { workspaceId: DEMO_WORKSPACE.id }),
      ),
    ).resolves.toBe(true);

    expect(consumeOrThrow.mock.calls).toEqual([
      [RATE_LIMITS.demoWritesPerIp, "198.51.100.7"],
      [RATE_LIMITS.demoWritesPerWorkspace, DEMO_WORKSPACE.id],
    ]);
  });

  it("refuses rather than skips both limits when they cannot be counted", () => {
    // They bound what the demo stores, so a Valkey outage must not lift them.
    expect(RATE_LIMITS.demoWritesPerIp.failClosed).toBe(true);
    expect(RATE_LIMITS.demoWritesPerWorkspace.failClosed).toBe(true);
  });

  it("refuses once the budget is spent", async () => {
    const { guard } = guardWith(
      vi.fn(() => Promise.reject(new Error("RATE_LIMITED"))),
    );

    await expect(
      guard.canActivate(contextFor("POST", { workspaceId: DEMO_WORKSPACE.id })),
    ).rejects.toThrow("RATE_LIMITED");
  });

  it.each([
    ["a read of the demo", "GET", { workspaceId: DEMO_WORKSPACE.id }],
    [
      "a change to another workspace",
      "POST",
      { workspaceId: "0193f2a4-0000-7b2a-9d1f-3e5c7a9b1d2f" },
    ],
    ["a request without a session", "POST", undefined],
  ])("lets %s through without counting it", async (_label, method, actor) => {
    const { guard, consumeOrThrow } = guardWith();

    await expect(guard.canActivate(contextFor(method, actor))).resolves.toBe(
      true,
    );
    expect(consumeOrThrow).not.toHaveBeenCalled();
  });
});
