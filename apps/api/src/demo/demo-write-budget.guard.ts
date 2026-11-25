import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";

import type { RequestWithActor } from "../auth/actor.js";
import { RATE_LIMITS, RateLimiter } from "../rate-limit/rate-limiter.js";
import { isDemoWorkspace } from "./demo-workspace.js";

/** Methods that only read; everything else changes state. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Anyone can sign in to the demo, so how much its visitors can write in a
 * day is bounded (FR-AUTH-5): every change to the demo workspace counts
 * against a budget per address and one for the whole workspace, which ends
 * the growth of runbooks, audit entries and the like between two resets.
 * Runs after SessionGuard, which has loaded the actor; other workspaces and
 * reads pass straight through.
 */
@Injectable()
export class DemoWriteBudgetGuard implements CanActivate {
  constructor(private readonly rateLimiter: RateLimiter) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithActor>();
    const { actor } = request;
    if (
      actor === undefined ||
      SAFE_METHODS.has(request.method) ||
      !isDemoWorkspace(actor.workspaceId)
    ) {
      return true;
    }
    await this.rateLimiter.consumeOrThrow(
      RATE_LIMITS.demoWritesPerIp,
      request.ip ?? "unknown",
    );
    await this.rateLimiter.consumeOrThrow(
      RATE_LIMITS.demoWritesPerWorkspace,
      actor.workspaceId,
    );
    return true;
  }
}
